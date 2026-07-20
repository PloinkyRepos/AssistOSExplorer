export const SCRIPTA_KEY = "scripta";
export const SCRIPTA_REACTION_LIKE = "like";
export const SCRIPTA_REACTION_DISLIKE = "dislike";

export function cloneJson(value) {
    return JSON.parse(JSON.stringify(value ?? null));
}

export function createScriptaVariantId() {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.randomUUID) {
        return `variant-${cryptoApi.randomUUID()}`;
    }
    return `variant-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeScriptaReactionType(value) {
    const type = String(value || "").trim().toLowerCase();
    if (!type) return "";
    if (type !== SCRIPTA_REACTION_LIKE && type !== SCRIPTA_REACTION_DISLIKE) {
        throw new Error(`Unsupported SCRIPTA reaction type "${type}".`);
    }
    return type;
}

export function normalizeScriptaPluginState(paragraph) {
    if (!paragraph.metadata || typeof paragraph.metadata !== "object") {
        paragraph.metadata = {};
    }
    if (!paragraph.pluginState || typeof paragraph.pluginState !== "object" || Array.isArray(paragraph.pluginState)) {
        paragraph.pluginState = paragraph.metadata.pluginState && typeof paragraph.metadata.pluginState === "object"
            ? paragraph.metadata.pluginState
            : {};
    }
    paragraph.metadata.pluginState = paragraph.pluginState;
    return paragraph.pluginState;
}

export function normalizeScriptaReaction(userHash, reaction) {
    const data = reaction && typeof reaction === "object" ? reaction : {};
    const type = normalizeScriptaReactionType(data.type);
    if (!type) return null;
    return {
        type,
        userHash: String(data.userHash || userHash || ""),
        userLabel: String(data.userLabel || userHash || ""),
        reactedAt: String(data.reactedAt || new Date().toISOString()),
    };
}

export function normalizeScriptaReactionsByVariant(raw = {}) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw)
        .filter(([variantId, reactions]) => variantId && reactions && typeof reactions === "object")
        .map(([variantId, reactions]) => {
            const normalized = {};
            if (!Array.isArray(reactions)) {
                for (const [userHash, reaction] of Object.entries(reactions)) {
                    const value = normalizeScriptaReaction(userHash, reaction);
                    if (userHash && value) normalized[userHash] = value;
                }
            }
            return [String(variantId), normalized];
        }));
}

export function normalizeScriptaState(paragraph) {
    const pluginState = normalizeScriptaPluginState(paragraph);
    const raw = pluginState[SCRIPTA_KEY] && typeof pluginState[SCRIPTA_KEY] === "object"
        ? cloneJson(pluginState[SCRIPTA_KEY])
        : {};
    const variants = Array.isArray(raw.variants)
        ? raw.variants.filter((variant) => variant && typeof variant === "object")
        : [];
    const state = {
        activeVariantId: typeof raw.activeVariantId === "string" ? raw.activeVariantId : "",
        variants: variants.map((variant) => ({
            id: String(variant.id || createScriptaVariantId()),
            text: String(variant.text ?? ""),
            createdBy: String(variant.createdBy || ""),
            createdAt: String(variant.createdAt || new Date().toISOString()),
            updatedAt: String(variant.updatedAt || variant.createdAt || new Date().toISOString()),
        })),
        reactionsByVariant: normalizeScriptaReactionsByVariant(raw.reactionsByVariant),
    };
    if (!state.variants.some((variant) => variant.id === state.activeVariantId)) {
        state.activeVariantId = "";
    }
    pluginState[SCRIPTA_KEY] = state;
    paragraph.metadata.pluginState = pluginState;
    return state;
}

export function ensureScriptaInitialVariant(paragraph, { createdBy = "", now = new Date().toISOString() } = {}) {
    const state = normalizeScriptaState(paragraph);
    if (!state.variants.length) {
        const owner = String(createdBy || "").trim();
        if (!owner) throw new Error("SCRIPTA variant creation requires an owner.");
        const variant = {
            id: createScriptaVariantId(),
            text: String(paragraph.text || ""),
            createdBy: owner,
            createdAt: String(now),
            updatedAt: String(now),
        };
        state.variants.push(variant);
        state.activeVariantId = variant.id;
    }
    updateScriptaActiveVariant(paragraph, state);
    return state;
}

export function getScriptaReactionStats(state, variantId) {
    const reactions = state?.reactionsByVariant?.[variantId] || {};
    const values = Object.values(reactions).filter((reaction) => reaction && typeof reaction === "object");
    const likes = values.filter((reaction) => reaction.type === SCRIPTA_REACTION_LIKE).length;
    const dislikes = values.filter((reaction) => reaction.type === SCRIPTA_REACTION_DISLIKE).length;
    return { likes, dislikes, total: likes + dislikes, score: likes - dislikes };
}

export function getScriptaTotalReactions(state) {
    return (state?.variants || []).reduce(
        (total, variant) => total + getScriptaReactionStats(state, variant.id).total,
        0,
    );
}

export function getScriptaWinningVariant(state) {
    if (!state?.variants?.length) return null;
    return state.variants
        .map((variant, index) => ({ variant, index, stats: getScriptaReactionStats(state, variant.id) }))
        .sort((left, right) => {
            if (right.stats.score !== left.stats.score) return right.stats.score - left.stats.score;
            if (right.stats.likes !== left.stats.likes) return right.stats.likes - left.stats.likes;
            if (left.stats.dislikes !== right.stats.dislikes) return left.stats.dislikes - right.stats.dislikes;
            const createdDelta = Date.parse(left.variant.createdAt || "") - Date.parse(right.variant.createdAt || "");
            if (Number.isFinite(createdDelta) && createdDelta !== 0) return createdDelta;
            return left.index - right.index;
        })[0]?.variant || state.variants[0];
}

export function getScriptaVariantOrdinal(state, variantId) {
    return (state?.variants || []).findIndex((variant) => variant.id === variantId) + 1;
}

export function getScriptaViewerVote(state, userHash) {
    for (const [variantId, reactions] of Object.entries(state?.reactionsByVariant || {})) {
        const reaction = reactions?.[userHash];
        if (reaction) return { variantId, type: reaction.type };
    }
    return null;
}

export function setScriptaReaction(state, variantId, userHash, userLabel, nextType) {
    const targetVariantId = String(variantId || "").trim();
    const participantHash = String(userHash || "").trim();
    if (!state?.variants?.some((variant) => variant.id === targetVariantId)) {
        throw new Error("SCRIPTA variant was not found.");
    }
    if (!participantHash) throw new Error("SCRIPTA voting requires a participant identity.");
    const normalizedType = normalizeScriptaReactionType(nextType);
    const currentType = state.reactionsByVariant?.[targetVariantId]?.[participantHash]?.type || "";
    for (const reactions of Object.values(state.reactionsByVariant || {})) {
        if (reactions && typeof reactions === "object") delete reactions[participantHash];
    }
    if (!normalizedType || currentType === normalizedType) return "";
    if (!state.reactionsByVariant[targetVariantId]) state.reactionsByVariant[targetVariantId] = {};
    state.reactionsByVariant[targetVariantId][participantHash] = {
        type: normalizedType,
        userHash: participantHash,
        userLabel: String(userLabel || participantHash),
        reactedAt: new Date().toISOString(),
    };
    return normalizedType;
}

export function updateScriptaActiveVariant(paragraph, state = normalizeScriptaState(paragraph)) {
    const winner = getScriptaWinningVariant(state);
    state.activeVariantId = winner?.id || "";
    if (winner) paragraph.text = winner.text;
    return winner;
}

export function isScriptaVariantOwner(variant, actorHash = "") {
    const owner = String(variant?.createdBy || "").trim();
    const actor = String(actorHash || "").trim();
    return Boolean(owner && actor && owner === actor);
}

export function assertScriptaVariantOwner(variant, actorHash = "") {
    if (isScriptaVariantOwner(variant, actorHash)) return;
    const error = new Error("Only the participant who added this SCRIPTA variant can modify it.");
    error.code = "scripta_variant_forbidden";
    throw error;
}

export function addScriptaVariant(paragraph, text, { createdBy = "", now = new Date().toISOString() } = {}) {
    const value = String(text ?? "").trim();
    if (!value) throw new Error("SCRIPTA alternative text is required.");
    const owner = String(createdBy || "").trim();
    if (!owner) throw new Error("SCRIPTA variant creation requires an owner.");
    const state = ensureScriptaInitialVariant(paragraph, { createdBy, now });
    const variant = {
        id: createScriptaVariantId(),
        text: value,
        createdBy: owner,
        createdAt: String(now),
        updatedAt: String(now),
    };
    state.variants.push(variant);
    updateScriptaActiveVariant(paragraph, state);
    return variant;
}

export function deleteScriptaVariant(paragraph, variantId, { deletedBy = "" } = {}) {
    const state = ensureScriptaInitialVariant(paragraph, { createdBy: deletedBy });
    const targetId = String(variantId || "").trim();
    const index = state.variants.findIndex((variant) => variant.id === targetId);
    if (index < 0) throw new Error("SCRIPTA variant was not found.");
    assertScriptaVariantOwner(state.variants[index], deletedBy);
    if (state.variants.length === 1) {
        throw new Error("A SCRIPTA paragraph must keep at least one variant.");
    }
    const [removed] = state.variants.splice(index, 1);
    delete state.reactionsByVariant[removed.id];
    updateScriptaActiveVariant(paragraph, state);
    return removed;
}

export function applyScriptaVote(paragraph, { variantId, userHash, userLabel = "", type = "" } = {}) {
    const state = ensureScriptaInitialVariant(paragraph, { createdBy: userHash });
    const reaction = setScriptaReaction(state, variantId, userHash, userLabel, type);
    const winner = updateScriptaActiveVariant(paragraph, state);
    return { reaction, winner, state };
}

export function getScriptaStatus(paragraph) {
    if (!paragraph) return null;
    const pluginState = paragraph.pluginState || paragraph.metadata?.pluginState;
    const state = pluginState?.[SCRIPTA_KEY];
    if (!state || !Array.isArray(state.variants) || !state.variants.length) return null;
    const activeVariant = state.variants.find((variant) => variant.id === state.activeVariantId)
        || getScriptaWinningVariant(state);
    const activeStats = activeVariant ? getScriptaReactionStats(state, activeVariant.id) : { score: 0, total: 0 };
    return {
        variants: state.variants.length,
        score: activeStats.score,
        activeScore: activeStats.score,
        activeTotal: activeStats.total,
        totalReactions: getScriptaTotalReactions(state),
        activeVariantId: activeVariant?.id || "",
    };
}
