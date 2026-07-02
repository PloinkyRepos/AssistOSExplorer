import {
    callAgentTool,
    ensureSuccess,
    parseToolResult
} from "/explorer/services/infrastructure/explorerApi.js";

const PANELS = new Set(["users", "auth", "provider", "credits", "audit"]);
const CREDIT_PAGE_SIZE = 100;
const AUDIT_PAGE_SIZE = 50;
const SECRET_KEYS = new Set(["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]);
const SETTING_KEYS = [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PUBLISHABLE_KEY",
    "STRIPE_PRICE_CREDITS",
    "STRIPE_PRICE_SUBSCRIPTION",
    "USERPERSISTO_CREDITS_PER_UNIT"
];

async function callUserPersistoTool(name, args = {}) {
    const raw = await callAgentTool("userPersistoAgent", name, args, { raw: true });
    ensureSuccess(raw);
    const parsed = parseToolResult(raw) || {};
    if (parsed?.ok === false || parsed?.error) {
        throw new Error(parsed.error || `${name} failed.`);
    }
    return parsed;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function settingValue(settings, key) {
    return String(settings?.[key] || "");
}

function userRoles(user = {}) {
    if (Array.isArray(user.roles) && user.roles.length) {
        return user.roles.map((role) => String(role || "").trim()).filter(Boolean);
    }
    const role = String(user.role || "").trim();
    return role ? [role] : [];
}

function primaryRole(user = {}) {
    const roles = userRoles(user);
    return roles.find((role) => ["admin", "user", "selfRegistered"].includes(role)) || roles[0] || "user";
}

function listFromPayload(payload = {}, key) {
    if (Array.isArray(payload?.[key])) return payload[key];
    if (Array.isArray(payload?.objects)) return payload.objects;
    if (Array.isArray(payload?.entries)) return payload.entries;
    return [];
}

function totalFromPayload(payload = {}, fallback = 0) {
    return Number.isFinite(payload.filteredCount)
        ? payload.filteredCount
        : Number.isFinite(payload.totalCount)
            ? payload.totalCount
            : fallback;
}

function formatTimestamp(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value || "");
    return date.toLocaleString();
}

function userLabel(user = {}) {
    const email = String(user.email || "").trim();
    const displayName = String(user.displayName || "").trim();
    const id = String(user.id || "").trim();
    return displayName && email
        ? `${displayName} <${email}>`
        : email || displayName || id || "Unknown user";
}

export class UserpersistoSettings {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.state = {
            activePanel: "users",
            status: "",
            statusType: "",
            settings: {},
            users: [],
            authProfile: null,
            creditUsers: [],
            creditSearchResults: [],
            selectedCreditUserId: "",
            creditBalance: null,
            creditLedger: [],
            creditLedgerTotalCount: 0,
            auditEvents: [],
            auditTotalCount: 0,
            auditStart: 0
        };
        this.settingsRequestId = 0;
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.cacheElements();
        this.bindEvents();
        this.syncPanelFromAttributes();
        this.renderPanels();
        void this.loadSettings();
        if (this.state.activePanel === "users") void this.refreshUsers();
        if (this.state.activePanel === "auth") void this.refreshAuthProfile();
        if (this.state.activePanel === "credits") void this.searchCreditUsers();
        if (this.state.activePanel === "audit") void this.refreshAuditEvents();
    }

    cacheElements() {
        this.statusEl = this.element.querySelector("#userpersistoStatus");
        this.panelTabs = Array.from(this.element.querySelectorAll("[data-panel]"));
        this.usersListEl = this.element.querySelector("#usersList");
        this.userSearchInput = this.element.querySelector("#userSearchInput");
        this.createUserEmailInput = this.element.querySelector("#createUserEmail");
        this.createUserDisplayNameInput = this.element.querySelector("#createUserDisplayName");
        this.createUserPasswordInput = this.element.querySelector("#createUserPassword");
        this.createUserRoleInput = this.element.querySelector("#createUserRole");
        this.authProfileEl = this.element.querySelector("#authProfileSummary");
        this.creditUserSearchInput = this.element.querySelector("#creditUserSearchInput");
        this.creditUserResultsEl = this.element.querySelector("#creditUserResults");
        this.selectedCreditUserEl = this.element.querySelector("#selectedCreditUser");
        this.creditBalanceEl = this.element.querySelector("#creditBalance");
        this.creditLedgerEl = this.element.querySelector("#creditLedger");
        this.grantCreditAmountInput = this.element.querySelector("#grantCreditAmount");
        this.grantCreditReasonInput = this.element.querySelector("#grantCreditReason");
        this.refundCreditAmountInput = this.element.querySelector("#refundCreditAmount");
        this.refundCreditReasonInput = this.element.querySelector("#refundCreditReason");
        this.auditActorInput = this.element.querySelector("#auditActorFilter");
        this.auditEventsEl = this.element.querySelector("#auditEvents");
        this.auditPageMetaEl = this.element.querySelector("#auditPageMeta");
        this.auditPreviousButton = this.element.querySelector("#auditPreviousButton");
        this.auditNextButton = this.element.querySelector("#auditNextButton");
        this.inputs = {
            STRIPE_SECRET_KEY: this.element.querySelector("#stripeSecretKey"),
            STRIPE_WEBHOOK_SECRET: this.element.querySelector("#stripeWebhookSecret"),
            STRIPE_PUBLISHABLE_KEY: this.element.querySelector("#stripePublishableKey"),
            STRIPE_PRICE_CREDITS: this.element.querySelector("#stripePriceCredits"),
            STRIPE_PRICE_SUBSCRIPTION: this.element.querySelector("#stripePriceSubscription"),
            USERPERSISTO_CREDITS_PER_UNIT: this.element.querySelector("#creditsPerUnit")
        };
        for (const key of SECRET_KEYS) {
            const input = this.inputs[key];
            if (!input) continue;
            input.value = "";
            input.placeholder = "Leave unchanged";
            input.autocomplete = "off";
        }
    }

    bindEvents() {
        if (this.element.dataset.userpersistoBound === "true") return;
        this.element.dataset.userpersistoBound = "true";
        this.userSearchInput?.addEventListener("input", () => this.renderUsers());
        this.creditUserSearchInput?.addEventListener("input", () => this.renderCreditUserResults());
        this.element.addEventListener("userpersisto-panel-change", (event) => {
            this.switchPanel(null, event.detail?.panel);
        });
    }

    syncPanelFromAttributes() {
        const panel = this.element.getAttribute("data-active-panel") || this.element.getAttribute("data-initial-panel");
        if (PANELS.has(panel)) {
            this.state.activePanel = panel;
        }
    }

    async callTool(name, args = {}) {
        return callUserPersistoTool(name, args);
    }

    setStatus(message, type = "") {
        this.state.status = message || "";
        this.state.statusType = type || "";
        if (this.statusEl) {
            this.statusEl.textContent = this.state.status;
            this.statusEl.classList.toggle("error", this.state.statusType === "error");
        }
    }

    switchPanel(_target, panel) {
        this.state.activePanel = PANELS.has(panel) ? panel : "users";
        this.renderPanels();
        if (this.state.activePanel === "users") void this.refreshUsers();
        if (this.state.activePanel === "auth") void this.refreshAuthProfile();
        if (this.state.activePanel === "credits") void this.searchCreditUsers();
        if (this.state.activePanel === "audit") void this.refreshAuditEvents();
    }

    renderPanels() {
        this.panelTabs?.forEach((tab) => {
            const isActive = tab.dataset.panel === this.state.activePanel;
            tab.classList.toggle("active", isActive);
            tab.setAttribute("aria-selected", isActive ? "true" : "false");
        });
        this.element.querySelectorAll("[data-section]").forEach((section) => {
            section.classList.toggle("hidden", section.dataset.section !== this.state.activePanel);
        });
    }

    applySettings(payload = {}) {
        const settings = payload.settings && typeof payload.settings === "object" ? payload.settings : payload;
        this.state.settings = settings || {};
        for (const key of SETTING_KEYS) {
            const value = settingValue(this.state.settings, key);
            const mask = this.element.querySelector(`[data-mask-for="${key}"]`);
            if (mask) {
                mask.textContent = value ? `Current: ${value}` : "Not configured";
            }
            const input = this.inputs[key];
            if (!input) continue;
            if (SECRET_KEYS.has(key)) {
                input.value = "";
                input.placeholder = "Leave unchanged";
            } else {
                input.value = value;
            }
        }
    }

    async loadSettings() {
        const requestId = ++this.settingsRequestId;
        try {
            const payload = await this.callTool("userpersisto_config_get");
            if (requestId !== this.settingsRequestId) return;
            this.applySettings(payload);
            this.setStatus("");
        } catch (error) {
            if (requestId !== this.settingsRequestId) return;
            this.setStatus(error?.message || "Failed to load settings.", "error");
        }
    }

    collectSettingsPatch() {
        const patch = {};
        for (const [key, input] of Object.entries(this.inputs || {})) {
            const value = String(input?.value || "").trim();
            if (!value) continue;
            patch[key] = value;
        }
        return patch;
    }

    async saveProviderSettings() {
        const patch = this.collectSettingsPatch();
        if (!Object.keys(patch).length) {
            this.setStatus("Enter at least one setting to save.");
            return;
        }
        const requestId = ++this.settingsRequestId;
        try {
            const payload = await this.callTool("userpersisto_config_set", patch);
            if (requestId !== this.settingsRequestId) return;
            this.applySettings(payload);
            this.setStatus("UserPersisto settings saved.");
        } catch (error) {
            if (requestId !== this.settingsRequestId) return;
            this.setStatus(error?.message || "Failed to save settings.", "error");
        }
    }

    async removeSecret(_target, key) {
        const settingKey = String(key || "").trim();
        if (!SECRET_KEYS.has(settingKey)) return;
        const requestId = ++this.settingsRequestId;
        try {
            const payload = await this.callTool("userpersisto_config_set", { remove: [settingKey] });
            if (requestId !== this.settingsRequestId) return;
            this.applySettings(payload);
            this.setStatus("Secret removed.");
        } catch (error) {
            if (requestId !== this.settingsRequestId) return;
            this.setStatus(error?.message || "Failed to remove secret.", "error");
        }
    }

    async refreshAuthProfile() {
        try {
            const profile = await this.callTool("userpersisto_profile_get");
            this.state.authProfile = profile;
            this.renderAuthProfile();
            this.setStatus("");
        } catch (error) {
            this.state.authProfile = null;
            this.renderAuthProfile();
            this.setStatus(error?.message || "Failed to load profile.", "error");
        }
    }

    renderAuthProfile() {
        if (!this.authProfileEl) return;
        const profile = this.state.authProfile;
        if (!profile?.user) {
            this.authProfileEl.innerHTML = '<div class="userpersisto-result">No authenticated UserPersisto profile loaded.</div>';
            return;
        }
        const roles = Array.isArray(profile.roles) ? profile.roles : [];
        const capabilities = Array.isArray(profile.capabilities) ? profile.capabilities : [];
        this.authProfileEl.innerHTML = `
            <div class="userpersisto-row">
                <div>
                    <div class="userpersisto-row-title">${escapeHtml(profile.user.email || profile.user.id)}</div>
                    <div class="userpersisto-row-meta">Roles: ${escapeHtml(roles.join(", ") || "none")}</div>
                    <div class="userpersisto-row-meta">Capabilities: ${escapeHtml(capabilities.join(", ") || "none")}</div>
                </div>
            </div>
        `;
    }

    async refreshUsers() {
        try {
            const payload = await this.callTool("userpersisto_user_list", {
                start: 0,
                pageSize: 100
            });
            this.state.users = Array.isArray(payload.users)
                ? payload.users
                : Array.isArray(payload.objects)
                    ? payload.objects
                    : [];
            this.renderUsers();
            this.setStatus(`${this.state.users.length} user${this.state.users.length === 1 ? "" : "s"} loaded.`);
        } catch (error) {
            this.setStatus(error?.message || "Failed to load users.", "error");
        }
    }

    filteredUsers() {
        const query = String(this.userSearchInput?.value || "").trim().toLowerCase();
        if (!query) return this.state.users;
        return this.state.users.filter((user) => {
            const haystack = [
                user.id,
                user.email,
                user.displayName,
                user.status,
                ...userRoles(user)
            ].join(" ").toLowerCase();
            return haystack.includes(query);
        });
    }

    async createUser() {
        try {
            const role = this.createUserRoleInput?.value || "user";
            await this.callTool("userpersisto_user_create", {
                email: this.createUserEmailInput?.value || "",
                displayName: this.createUserDisplayNameInput?.value || "",
                password: this.createUserPasswordInput?.value || "",
                roles: [role]
            });
            [this.createUserEmailInput, this.createUserDisplayNameInput, this.createUserPasswordInput].forEach((input) => {
                if (input) input.value = "";
            });
            if (this.userSearchInput) {
                this.userSearchInput.value = "";
            }
            await this.refreshUsers();
            this.setStatus("User created.");
        } catch (error) {
            this.setStatus(error?.message || "Failed to create user.", "error");
        }
    }

    renderUsers() {
        if (!this.usersListEl) return;
        const users = this.filteredUsers();
        if (!users.length) {
            this.usersListEl.innerHTML = '<div class="userpersisto-result">No users found.</div>';
            return;
        }
        this.usersListEl.innerHTML = users.map((user) => {
            const roles = userRoles(user);
            const selectedRole = primaryRole(user);
            return `
                <div class="userpersisto-row">
                    <div>
                        <div class="userpersisto-row-title">${escapeHtml(user.email || user.id)}</div>
                        <div class="userpersisto-row-meta">${escapeHtml(user.displayName || "No display name")} · Roles: ${escapeHtml(roles.join(", ") || "unknown")} · Status: ${escapeHtml(user.status || "unknown")}</div>
                        <div class="userpersisto-access">${roles.includes("selfRegistered") && !roles.includes("user") && !roles.includes("admin") ? "Self-registered app only" : "Explorer access depends on explorer.access capability"}</div>
                    </div>
                    <div class="userpersisto-row-controls">
                        <select class="form-input" data-user-role="${escapeHtml(user.id)}" data-local-action="changeUserRole ${escapeHtml(user.id)}">
                            ${["admin", "user", "selfRegistered"].map((role) => `<option value="${role}" ${role === selectedRole ? "selected" : ""}>${role}</option>`).join("")}
                        </select>
                    </div>
                </div>
            `;
        }).join("");
        this.usersListEl.querySelectorAll("[data-user-role]").forEach((select) => {
            select.addEventListener("change", () => this.changeUserRole(select, select.dataset.userRole));
        });
    }

    async changeUserRole(target, userId) {
        const role = target?.value;
        if (!userId || !role) return;
        try {
            await this.callTool("userpersisto_user_roles_update", { userId, roles: [role] });
            await this.refreshUsers();
            this.setStatus("User role updated.");
        } catch (error) {
            this.setStatus(error?.message || "Failed to update role.", "error");
        }
    }

    filterCreditUsers() {
        const query = String(this.creditUserSearchInput?.value || "").trim().toLowerCase();
        if (!query) return this.state.creditUsers;
        return this.state.creditUsers.filter((user) => {
            const haystack = [
                user.id,
                user.email,
                user.displayName,
                user.status,
                ...userRoles(user)
            ].join(" ").toLowerCase();
            return haystack.includes(query);
        });
    }

    selectedCreditUser() {
        const userId = String(this.state.selectedCreditUserId || "").trim();
        if (!userId) return null;
        return [...this.state.creditUsers, ...this.state.users].find((user) => user.id === userId) || { id: userId };
    }

    async searchCreditUsers() {
        try {
            const payload = await this.callTool("userpersisto_user_list", {
                start: 0,
                pageSize: CREDIT_PAGE_SIZE
            });
            this.state.creditUsers = listFromPayload(payload, "users");
            this.renderCreditUserResults();
            this.renderSelectedCreditUser();
            this.setStatus(`${this.state.creditUsers.length} user${this.state.creditUsers.length === 1 ? "" : "s"} available for credit management.`);
        } catch (error) {
            this.state.creditUsers = [];
            this.renderCreditUserResults();
            this.setStatus(error?.message || "Failed to search users.", "error");
        }
    }

    renderCreditUserResults() {
        if (!this.creditUserResultsEl) return;
        const users = this.filterCreditUsers();
        this.state.creditSearchResults = users;
        if (!users.length) {
            this.creditUserResultsEl.innerHTML = '<div class="userpersisto-result">No matching users found.</div>';
            return;
        }
        this.creditUserResultsEl.innerHTML = users.map((user) => {
            const selected = user.id === this.state.selectedCreditUserId;
            return `
                <button type="button" class="userpersisto-user-pick ${selected ? "active" : ""}" data-local-action="selectCreditUser ${escapeHtml(user.id)}">
                    <span>${escapeHtml(userLabel(user))}</span>
                    <small>${escapeHtml(user.id || "")}</small>
                </button>
            `;
        }).join("");
    }

    async selectCreditUser(_target, userId) {
        const normalized = String(userId || "").trim();
        if (!normalized) return;
        this.state.selectedCreditUserId = normalized;
        this.renderCreditUserResults();
        this.renderSelectedCreditUser();
        await this.refreshCredits();
    }

    renderSelectedCreditUser() {
        if (!this.selectedCreditUserEl) return;
        const user = this.selectedCreditUser();
        if (!user) {
            this.selectedCreditUserEl.innerHTML = '<div class="userpersisto-result">Select a user to inspect credits.</div>';
            return;
        }
        this.selectedCreditUserEl.innerHTML = `
            <div class="userpersisto-row-title">${escapeHtml(userLabel(user))}</div>
            <div class="userpersisto-row-meta">${escapeHtml(user.id || "")}</div>
        `;
    }

    renderCreditBalance() {
        if (!this.creditBalanceEl) return;
        const balance = this.state.creditBalance;
        if (!this.state.selectedCreditUserId) {
            this.creditBalanceEl.innerHTML = '<div class="userpersisto-result">No credit account selected.</div>';
            return;
        }
        if (!balance) {
            this.creditBalanceEl.innerHTML = '<div class="userpersisto-result">Credit balance has not been loaded.</div>';
            return;
        }
        this.creditBalanceEl.innerHTML = `
            <div class="userpersisto-balance-item">
                <span>Available</span>
                <strong>${escapeHtml(balance.balance ?? 0)}</strong>
            </div>
            <div class="userpersisto-balance-item">
                <span>Reserved</span>
                <strong>${escapeHtml(balance.reservedBalance ?? 0)}</strong>
            </div>
        `;
    }

    renderCreditLedger() {
        if (!this.creditLedgerEl) return;
        const rows = Array.isArray(this.state.creditLedger) ? this.state.creditLedger : [];
        if (!this.state.selectedCreditUserId) {
            this.creditLedgerEl.innerHTML = '<div class="userpersisto-result">Select a user to load ledger entries.</div>';
            return;
        }
        if (!rows.length) {
            this.creditLedgerEl.innerHTML = '<div class="userpersisto-result">No ledger entries found.</div>';
            return;
        }
        this.creditLedgerEl.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Created</th>
                        <th>Type</th>
                        <th>Amount</th>
                        <th>Reason</th>
                        <th>Reference</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((entry) => `
                        <tr>
                            <td>${escapeHtml(formatTimestamp(entry.createdAt))}</td>
                            <td>${escapeHtml(entry.type || "")}</td>
                            <td>${escapeHtml(entry.amount ?? "")}</td>
                            <td>${escapeHtml(entry.reason || "")}</td>
                            <td>${escapeHtml(entry.referenceId || "")}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        `;
    }

    async refreshCredits() {
        const userId = String(this.state.selectedCreditUserId || "").trim();
        if (!userId) {
            this.setStatus("Select a user before loading credits.");
            this.renderCreditBalance();
            this.renderCreditLedger();
            return;
        }
        try {
            const [balance, ledger] = await Promise.all([
                this.callTool("userpersisto_credits_balance", { userId }),
                this.callTool("userpersisto_credits_ledger", {
                    userId,
                    start: 0,
                    pageSize: CREDIT_PAGE_SIZE
                })
            ]);
            this.state.creditBalance = balance;
            this.state.creditLedger = listFromPayload(ledger, "entries");
            this.state.creditLedgerTotalCount = totalFromPayload(ledger, this.state.creditLedger.length);
            this.renderCreditBalance();
            this.renderCreditLedger();
            this.setStatus(`Credit account loaded (${this.state.creditLedgerTotalCount} ledger entr${this.state.creditLedgerTotalCount === 1 ? "y" : "ies"}).`);
        } catch (error) {
            this.state.creditBalance = null;
            this.state.creditLedger = [];
            this.renderCreditBalance();
            this.renderCreditLedger();
            this.setStatus(error?.message || "Failed to load credits.", "error");
        }
    }

    async grantCredits() {
        await this.adjustCredits("grant");
    }

    async refundCredits() {
        await this.adjustCredits("refund");
    }

    async adjustCredits(kind) {
        const userId = String(this.state.selectedCreditUserId || "").trim();
        if (!userId) {
            this.setStatus("Select a user before adjusting credits.");
            return;
        }
        const amountInput = kind === "grant" ? this.grantCreditAmountInput : this.refundCreditAmountInput;
        const reasonInput = kind === "grant" ? this.grantCreditReasonInput : this.refundCreditReasonInput;
        const amount = Number.parseInt(String(amountInput?.value || ""), 10);
        const reason = String(reasonInput?.value || "").trim();
        if (!Number.isInteger(amount) || amount <= 0) {
            this.setStatus("Credit amount must be a positive whole number.", "error");
            return;
        }
        const tool = kind === "grant" ? "userpersisto_credits_grant" : "userpersisto_credits_refund";
        try {
            await this.callTool(tool, { userId, amount, reason });
            if (amountInput) amountInput.value = "";
            if (reasonInput) reasonInput.value = "";
            await this.refreshCredits();
            this.setStatus(kind === "grant" ? "Credits granted." : "Credits refunded.");
        } catch (error) {
            this.setStatus(error?.message || "Failed to adjust credits.", "error");
        }
    }

    async refreshAuditEvents() {
        this.state.auditStart = 0;
        await this.loadAuditEvents();
    }

    async previousAuditPage() {
        this.state.auditStart = Math.max(0, this.state.auditStart - AUDIT_PAGE_SIZE);
        await this.loadAuditEvents();
    }

    async nextAuditPage() {
        this.state.auditStart += AUDIT_PAGE_SIZE;
        await this.loadAuditEvents();
    }

    async loadAuditEvents() {
        const actorId = String(this.auditActorInput?.value || "").trim();
        const args = {
            start: this.state.auditStart,
            pageSize: AUDIT_PAGE_SIZE
        };
        if (actorId) args.actorId = actorId;
        try {
            const payload = await this.callTool("userpersisto_audit_events_list", args);
            this.state.auditEvents = listFromPayload(payload, "objects");
            this.state.auditTotalCount = totalFromPayload(payload, this.state.auditEvents.length);
            this.renderAuditEvents();
            this.setStatus(`${this.state.auditEvents.length} audit event${this.state.auditEvents.length === 1 ? "" : "s"} loaded.`);
        } catch (error) {
            this.state.auditEvents = [];
            this.renderAuditEvents();
            this.setStatus(error?.message || "Failed to load audit events.", "error");
        }
    }

    renderAuditEvents() {
        const rows = Array.isArray(this.state.auditEvents) ? this.state.auditEvents : [];
        if (this.auditPageMetaEl) {
            const start = rows.length ? this.state.auditStart + 1 : 0;
            const end = this.state.auditStart + rows.length;
            this.auditPageMetaEl.textContent = `${start}-${end} of ${this.state.auditTotalCount}`;
        }
        if (this.auditPreviousButton) {
            this.auditPreviousButton.disabled = this.state.auditStart <= 0;
        }
        if (this.auditNextButton) {
            this.auditNextButton.disabled = this.state.auditStart + AUDIT_PAGE_SIZE >= this.state.auditTotalCount;
        }
        if (!this.auditEventsEl) return;
        if (!rows.length) {
            this.auditEventsEl.innerHTML = '<div class="userpersisto-result">No audit events found.</div>';
            return;
        }
        this.auditEventsEl.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Timestamp</th>
                        <th>Actor</th>
                        <th>Action</th>
                        <th>Target</th>
                        <th>Reason</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((event) => `
                        <tr>
                            <td>${escapeHtml(formatTimestamp(event.timestamp))}</td>
                            <td>${escapeHtml(event.actorId || "")}</td>
                            <td>${escapeHtml(event.action || "")}</td>
                            <td>${escapeHtml(event.target || "")}</td>
                            <td>${escapeHtml(event.reason || "")}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        `;
    }

    closeModal() {
        assistOS.UI.closeModal(this.element, null);
    }
}
