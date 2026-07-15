import {
    createScriptaVariantId as createVariantId,
    getScriptaReactionStats as getReactionStats,
    getScriptaVariantOrdinal as getVariantOrdinal,
    getScriptaWinningVariant as getWinningVariant,
    normalizeScriptaReactionType as normalizeReactionType,
    normalizeScriptaState,
    setScriptaReaction as setReaction,
    SCRIPTA_REACTION_DISLIKE as REACTION_DISLIKE,
    SCRIPTA_REACTION_LIKE as REACTION_LIKE
} from "../../../explorer/services/document/scriptaState.js";

function decodeContext(element) {
    try {
        return JSON.parse(decodeURIComponent(element.getAttribute("data-context") || "{}"));
    } catch (error) {
        console.error("Invalid SCRIPTA context", error);
        return {};
    }
}

function escapeHtml(value = "") {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function sanitizeText(value = "") {
    if (assistOS?.UI?.sanitize) {
        return assistOS.UI.sanitize(String(value ?? ""));
    }
    return String(value ?? "");
}

function displayText(value = "") {
    if (assistOS?.UI?.unsanitize) {
        return assistOS.UI.unsanitize(String(value ?? ""));
    }
    return String(value ?? "");
}

async function sha256Hex(value) {
    const input = String(value || "");
    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.subtle && typeof TextEncoder !== "undefined") {
        const bytes = new TextEncoder().encode(input);
        const digest = await cryptoApi.subtle.digest("SHA-256", bytes);
        return Array.from(new Uint8Array(digest))
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
    }
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}

function getAuthenticatedUser() {
    const user = assistOS?.user || {};
    const key = String(user.id || user.userId || user.sub || user.email || user.username || user.name || "").trim();
    const label = String(user.name || user.username || user.email || key || "").trim();
    return { key, label };
}

function reactionIcon(type) {
    if (type === REACTION_DISLIKE) {
        return `
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M10 15v4.4c0 .9.7 1.6 1.6 1.6.6 0 1.1-.3 1.4-.8l3.5-5.2H20a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-3.2c-.6 0-1.1.2-1.5.6L14 5H5.8a2 2 0 0 0-2 1.7l-1 6A2 2 0 0 0 4.8 15H10Z"></path>
            </svg>
        `;
    }
    return `
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14 9V4.6c0-.9-.7-1.6-1.6-1.6-.6 0-1.1.3-1.4.8L7.5 9H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3.2c.6 0 1.1-.2 1.5-.6L10 19h8.2a2 2 0 0 0 2-1.7l1-6A2 2 0 0 0 19.2 9H14Z"></path>
        </svg>
    `;
}

export class ScriptaVariants {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.context = decodeContext(element);
        this.hostElement = document.querySelector(this.context.hostSelector || "");
        this.paragraphPresenter = this.hostElement?.webSkelPresenter || null;
        this.documentPresenter = this.hostElement?.closest("document-view-page")?.webSkelPresenter
            || document.querySelector("document-view-page")?.webSkelPresenter
            || null;
        this.document = this.documentPresenter?._document || null;
        this.chapter = this.document?.chapters?.find((chapter) => chapter.id === this.context.chapterId) || null;
        this.paragraph = this.chapter?.paragraphs?.find((paragraph) => paragraph.id === this.context.paragraphId) || null;
        this.userHash = "";
        this.userLabel = "";
        this.disabledReason = "";
        this.activeTabVariantId = "";
        this.showVoters = false;
        this.invalidate();
    }

    async beforeRender() {
        this.disabledReason = "";
        if (!this.paragraph) {
            this.disabledReason = "Paragraph context is not available.";
        }
        if (!this.disabledReason && !this.hostElement) {
            this.disabledReason = "Paragraph host is not available.";
        }
        const authUser = getAuthenticatedUser();
        if (!this.disabledReason && !authUser.key) {
            this.disabledReason = "Authentication is required for SCRIPTA voting.";
        }
        if (!this.disabledReason && this.hostElement?.closest("[data-virtual-provider='dpu']")) {
            this.disabledReason = "SCRIPTA is not available for DPU files.";
        }

        if (!this.userHash && !this.disabledReason) {
            this.userHash = `user-${(await sha256Hex(authUser.key)).slice(0, 24)}`;
            this.userLabel = authUser.label || this.userHash;
        }
        if (this.paragraph) {
            this.ensureInitialState();
        }
        this.prepareTemplateData();
    }

    afterRender() {
        this.syncTabsViewport();
    }

    ensureInitialState() {
        const state = normalizeScriptaState(this.paragraph);
        if (state.variants.length > 0) {
            const winner = getWinningVariant(state);
            let changed = false;
            if (winner && state.activeVariantId !== winner.id) {
                state.activeVariantId = winner.id;
                changed = true;
            }
            if (winner && this.paragraph.text !== winner.text) {
                this.paragraph.text = winner.text;
                changed = true;
            }
            if (!this.activeTabVariantId || !state.variants.some((variant) => variant.id === this.activeTabVariantId)) {
                this.activeTabVariantId = state.activeVariantId || state.variants[0]?.id || "";
            }
            return changed;
        }
        const now = new Date().toISOString();
        const initialVariant = {
            id: createVariantId(),
            text: String(this.paragraph.text || ""),
            createdBy: this.userHash || "",
            createdAt: now,
            updatedAt: now
        };
        state.variants.push(initialVariant);
        state.activeVariantId = initialVariant.id;
        this.activeTabVariantId = initialVariant.id;
        return true;
    }

    prepareTemplateData() {
        const state = this.paragraph ? normalizeScriptaState(this.paragraph) : { variants: [], reactionsByVariant: {}, activeVariantId: "" };
        const activeVariant = state.variants.find((variant) => variant.id === state.activeVariantId) || getWinningVariant(state);
        if (!this.activeTabVariantId || !state.variants.some((variant) => variant.id === this.activeTabVariantId)) {
            this.activeTabVariantId = activeVariant?.id || state.variants[0]?.id || "";
        }
        const selectedVariant = state.variants.find((variant) => variant.id === this.activeTabVariantId) || activeVariant || state.variants[0] || null;
        const isDisabled = Boolean(this.disabledReason);
        this.paragraphExcerpt = escapeHtml(displayText(this.paragraph?.text || "").replace(/\s+/g, " ").trim().slice(0, 140));
        this.disabledNotice = isDisabled
            ? `<div class="scripta-disabled-notice">${escapeHtml(this.disabledReason)}</div>`
            : "";
        this.proposalDisabled = isDisabled ? "disabled" : "";
        this.tabsHtml = state.variants.length
            ? state.variants.map((variant) => this.renderTab(state, variant)).join("")
            : "";
        this.tabPanelHtml = selectedVariant
            ? this.renderVariantPanel(state, selectedVariant, isDisabled)
            : `<div class="scripta-disabled-notice">No variants available.</div>`;
    }

    renderTab(state, variant) {
        const ordinal = getVariantOrdinal(state, variant.id);
        const stats = getReactionStats(state, variant.id);
        const isSelected = variant.id === this.activeTabVariantId;
        const isActive = variant.id === state.activeVariantId;
        return `
            <button type="button"
                    class="scripta-tab ${isSelected ? "is-selected" : ""} ${isActive ? "is-active" : ""}"
                    data-local-action="selectVariantTab ${variant.id}"
                    role="tab"
                    aria-selected="${isSelected ? "true" : "false"}">
                <span class="scripta-tab-title">Variant ${ordinal}</span>
                ${isActive ? `<span class="scripta-tab-active">Active</span>` : ""}
                <span class="scripta-tab-score">${stats.score}/${stats.total}</span>
                <span class="scripta-tab-reactions">
                    <span>${reactionIcon(REACTION_LIKE)}${stats.likes}</span>
                    <span>${reactionIcon(REACTION_DISLIKE)}${stats.dislikes}</span>
                </span>
            </button>
        `;
    }

    renderVariantPanel(state, variant, isDisabled) {
        const stats = getReactionStats(state, variant.id);
        const reactions = state.reactionsByVariant?.[variant.id] || {};
        const userReaction = reactions[this.userHash]?.type || "";
        const votersClass = this.showVoters ? "" : "hidden";
        const isActive = variant.id === state.activeVariantId;
        return `
            <section class="scripta-variant-panel" data-variant-id="${escapeHtml(variant.id)}">
                <div class="scripta-panel-header">
                    <div>
                                    <div class="scripta-reaction-actions">
                    ${this.renderReactionButton(variant.id, REACTION_LIKE, stats.likes, userReaction, isDisabled)}
                    ${this.renderReactionButton(variant.id, REACTION_DISLIKE, stats.dislikes, userReaction, isDisabled)}
                </div>
                    </div>
                    <label class="scripta-voters-toggle">
                        <input type="checkbox" data-local-action="toggleVoters" ${this.showVoters ? "checked" : ""}>
                        <span>Show voters</span>
                    </label>
                </div>
                <div class="scripta-voters ${votersClass}" data-role="voters">
                    ${this.renderVoters(reactions)}
                </div>
                <div class="scripta-variant-text">${escapeHtml(displayText(variant.text))}</div>

         
            </section>
        `;
    }

    renderReactionButton(variantId, type, count, userReaction, isDisabled) {
        const activeClass = userReaction === type ? "is-active" : "";
        const label = type === REACTION_LIKE ? "Like" : "Dislike";
        return `
            <button type="button"
                    class="scripta-reaction-button ${activeClass}"
                    data-local-action="reactVariant ${variantId} ${type}"
                    ${isDisabled ? "disabled" : ""}
                    aria-label="${label}">
                ${reactionIcon(type)}
                <span>${label}</span>
                <strong>${count}</strong>
            </button>
        `;
    }

    renderVoters(reactions) {
        const values = Object.values(reactions || {});
        const likes = values.filter((reaction) => reaction.type === REACTION_LIKE);
        const dislikes = values.filter((reaction) => reaction.type === REACTION_DISLIKE);
        return `
            <div class="scripta-voter-group">
                <div class="scripta-voter-heading">${reactionIcon(REACTION_LIKE)} Likes</div>
                ${this.renderVoterList(likes)}
            </div>
            <div class="scripta-voter-group">
                <div class="scripta-voter-heading">${reactionIcon(REACTION_DISLIKE)} Dislikes</div>
                ${this.renderVoterList(dislikes)}
            </div>
        `;
    }

    renderVoterList(reactions) {
        if (!reactions.length) {
            return `<div class="scripta-voter-empty">No voters</div>`;
        }
        return `
            <ul class="scripta-voter-list">
                ${reactions.map((reaction) => `<li>${escapeHtml(reaction.userLabel || reaction.userHash || "Unknown user")}</li>`).join("")}
            </ul>
        `;
    }

    closeModal() {
        assistOS.UI.closeModal(this.element);
    }

    refreshRenderedState() {
        this.prepareTemplateData();
        const tabList = this.element.querySelector("[data-role='variantTabs']");
        if (tabList) {
            tabList.innerHTML = this.tabsHtml;
        }
        const tabPanel = this.element.querySelector("[data-role='variantPanel']");
        if (tabPanel) {
            tabPanel.innerHTML = this.tabPanelHtml;
        }
        this.syncTabsViewport();
    }

    selectVariantTab(_target, variantId) {
        const state = normalizeScriptaState(this.paragraph);
        if (!state.variants.some((variant) => variant.id === variantId)) {
            return;
        }
        this.activeTabVariantId = variantId;
        this.refreshRenderedState();
    }

    scrollVariantTabs(_target, direction) {
        const state = normalizeScriptaState(this.paragraph);
        const currentIndex = state.variants.findIndex((variant) => variant.id === this.activeTabVariantId);
        const nextIndex = direction === "previous"
            ? Math.max(0, currentIndex - 1)
            : Math.min(state.variants.length - 1, currentIndex + 1);
        const nextVariant = state.variants[nextIndex];
        if (nextVariant && nextVariant.id !== this.activeTabVariantId) {
            this.activeTabVariantId = nextVariant.id;
            this.refreshRenderedState();
            return;
        }

        const viewport = this.element.querySelector("[data-role='variantTabsViewport']");
        if (!viewport) {
            return;
        }
        const amount = Math.max(160, Math.floor(viewport.clientWidth * 0.82));
        viewport.scrollTo({
            left: viewport.scrollLeft + (direction === "previous" ? -amount : amount),
            behavior: "smooth"
        });
    }

    syncTabsViewport(behavior = "smooth") {
        requestAnimationFrame(() => {
            const selectedTab = this.element.querySelector(".scripta-tab.is-selected");
            selectedTab?.scrollIntoView({
                behavior,
                block: "nearest",
                inline: "nearest"
            });
        });
    }

    toggleVoters(target) {
        this.showVoters = Boolean(target?.checked);
        this.refreshRenderedState();
    }

    setProposalPanelOpen(open) {
        const panel = this.element.querySelector("[data-role='proposalPanel']");
        const toggle = this.element.querySelector(".scripta-add-variant-toggle");
        if (!panel) {
            return;
        }
        panel.classList.toggle("hidden", !open);
        toggle?.setAttribute("aria-expanded", open ? "true" : "false");
        if (open) {
            requestAnimationFrame(() => panel.querySelector("[data-role='proposalInput']")?.focus());
        }
    }

    toggleProposalPanel() {
        if (this.disabledReason) {
            assistOS.showToast?.(this.disabledReason, "warning");
            return;
        }
        const panel = this.element.querySelector("[data-role='proposalPanel']");
        this.setProposalPanelOpen(panel?.classList.contains("hidden"));
    }

    cancelVariantProposal() {
        const input = this.element.querySelector("[data-role='proposalInput']");
        if (input) {
            input.value = "";
        }
        this.setProposalPanelOpen(false);
    }

    async addVariant() {
        if (this.disabledReason) {
            assistOS.showToast?.(this.disabledReason, "warning");
            return;
        }
        const input = this.element.querySelector("[data-role='proposalInput']");
        const text = sanitizeText(input?.value || "").trim();
        if (!text) {
            assistOS.showToast?.("Variant text is required.", "warning");
            return;
        }
        const state = normalizeScriptaState(this.paragraph);
        const now = new Date().toISOString();
        const variant = {
            id: createVariantId(),
            text,
            createdBy: this.userHash,
            createdAt: now,
            updatedAt: now
        };
        state.variants.push(variant);
        setReaction(state, variant.id, this.userHash, this.userLabel, REACTION_LIKE);
        this.activeTabVariantId = variant.id;
        await this.persistState();
        input.value = "";
        this.setProposalPanelOpen(false);
        this.refreshRenderedState();
        assistOS.showToast?.("Variant added.", "success");
    }

    async reactVariant(_target, variantId, type) {
        if (this.disabledReason) {
            assistOS.showToast?.(this.disabledReason, "warning");
            return;
        }
        const state = normalizeScriptaState(this.paragraph);
        if (!state.variants.some((variant) => variant.id === variantId)) {
            assistOS.showToast?.("Variant not found.", "error");
            return;
        }
        setReaction(state, variantId, this.userHash, this.userLabel, normalizeReactionType(type));
        this.activeTabVariantId = variantId;
        this.refreshRenderedState();
        await this.persistState();
        this.refreshRenderedState();
    }

    async persistState() {
        const state = normalizeScriptaState(this.paragraph);
        const winner = getWinningVariant(state);
        if (winner) {
            state.activeVariantId = winner.id;
            this.paragraph.text = winner.text;
        }
        this.paragraph.metadata.pluginState = this.paragraph.pluginState;
        if (typeof this.documentPresenter?.updateParagraphModel !== "function") {
            throw new Error("Document presenter cannot persist SCRIPTA state.");
        }
        await this.documentPresenter.updateParagraphModel(this.chapter.id, this.paragraph.id, {
            text: this.paragraph.text,
            commands: this.paragraph.commands,
            comments: this.paragraph.comments,
            metadata: this.paragraph.metadata
        });
        if (this.paragraphPresenter) {
            this.paragraphPresenter.paragraph = this.paragraph;
            const paragraphText = this.paragraphPresenter.element.querySelector(".paragraph-text");
            if (paragraphText) {
                paragraphText.innerHTML = this.paragraph.text;
                paragraphText.value = displayText(this.paragraph.text);
                paragraphText.style.height = "auto";
                paragraphText.style.height = `${paragraphText.scrollHeight}px`;
            }
            this.paragraphPresenter.renderScriptaStatus?.();
        }
    }
}
