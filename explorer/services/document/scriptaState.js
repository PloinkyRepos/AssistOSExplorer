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
    const type = String(value || "").trim();
    return type === SCRIPTA_REACTION_DISLIKE ? SCRIPTA_REACTION_DISLIKE : SCRIPTA_REACTION_LIKE;
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
    return {
        type: normalizeScriptaReactionType(data.type),
        userHash: String(data.userHash || userHash || ""),
        userLabel: String(data.userLabel || userHash || ""),
        reactedAt: String(data.reactedAt || new Date().toISOString())
    };
}

export function normalizeScriptaReactionsByVariant(raw = {}) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {};
    }
    return Object.fromEntries(Object.entries(raw)
        .filter(([variantId, reactions]) => variantId && reactions && typeof reactions === "object")
        .map(([variantId, reactions]) => {
            const normalized = {};
            if (!Array.isArray(reactions)) {
                for (const [userHash, reaction] of Object.entries(reactions)) {
                    if (userHash && reaction && typeof reaction === "object") {
                        normalized[userHash] = normalizeScriptaReaction(userHash, reaction);
                    }
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
    const variants = Array.isArray(raw.variants) ? raw.variants.filter((variant) => variant && typeof variant === "object") : [];
    const state = {
        activeVariantId: typeof raw.activeVariantId === "string" ? raw.activeVariantId : "",
        variants: variants.map((variant) => ({
            id: String(variant.id || createScriptaVariantId()),
            text: String(variant.text ?? ""),
            createdBy: String(variant.createdBy || ""),
            createdAt: String(variant.createdAt || new Date().toISOString()),
            updatedAt: String(variant.updatedAt || variant.createdAt || new Date().toISOString())
        })),
        reactionsByVariant: normalizeScriptaReactionsByVariant(raw.reactionsByVariant)
    };
    pluginState[SCRIPTA_KEY] = state;
    paragraph.metadata.pluginState = pluginState;
    return state;
}

export function getScriptaReactionStats(state, variantId) {
    const reactions = state?.reactionsByVariant?.[variantId] || {};
    const values = Object.values(reactions).filter((reaction) => reaction && typeof reaction === "object");
    const likes = values.filter((reaction) => reaction.type === SCRIPTA_REACTION_LIKE).length;
    const dislikes = values.filter((reaction) => reaction.type === SCRIPTA_REACTION_DISLIKE).length;
    return {
        likes,
        dislikes,
        total: likes + dislikes,
        score: likes - dislikes
    };
}

export function getScriptaTotalReactions(state) {
    return state.variants.reduce((total, variant) => total + getScriptaReactionStats(state, variant.id).total, 0);
}

export function getScriptaWinningVariant(state) {
    if (!state?.variants?.length) {
        return null;
    }
    return state.variants
        .map((variant, index) => ({ variant, index, stats: getScriptaReactionStats(state, variant.id) }))
        .sort((left, right) => {
            if (right.stats.score !== left.stats.score) {
                return right.stats.score - left.stats.score;
            }
            if (right.stats.likes !== left.stats.likes) {
                return right.stats.likes - left.stats.likes;
            }
            if (left.stats.dislikes !== right.stats.dislikes) {
                return left.stats.dislikes - right.stats.dislikes;
            }
            const createdDelta = Date.parse(left.variant.createdAt || "") - Date.parse(right.variant.createdAt || "");
            if (Number.isFinite(createdDelta) && createdDelta !== 0) {
                return createdDelta;
            }
            return left.index - right.index;
        })[0]?.variant || state.variants[0];
}

export function getScriptaVariantOrdinal(state, variantId) {
    return state.variants.findIndex((variant) => variant.id === variantId) + 1;
}

export function setScriptaReaction(state, variantId, userHash, userLabel, nextType) {
    if (!state.reactionsByVariant[variantId] || typeof state.reactionsByVariant[variantId] !== "object") {
        state.reactionsByVariant[variantId] = {};
    }
    const normalizedType = normalizeScriptaReactionType(nextType);
    const current = state.reactionsByVariant[variantId][userHash];
    Object.entries(state.reactionsByVariant).forEach(([currentVariantId, reactions]) => {
        if (currentVariantId !== variantId && reactions && typeof reactions === "object") {
            delete reactions[userHash];
        }
    });
    if (current?.type === normalizedType) {
        delete state.reactionsByVariant[variantId][userHash];
        return "";
    }
    state.reactionsByVariant[variantId][userHash] = {
        type: normalizedType,
        userHash,
        userLabel,
        reactedAt: new Date().toISOString()
    };
    return normalizedType;
}

export function getScriptaStatus(paragraph) {
    if (!paragraph) {
        return null;
    }
    const pluginState = paragraph.pluginState || paragraph.metadata?.pluginState;
    const state = pluginState?.[SCRIPTA_KEY];
    if (!state || typeof state !== "object" || !Array.isArray(state.variants) || !state.variants.length) {
        return null;
    }
    const activeVariant = state.variants.find((variant) => variant.id === state.activeVariantId)
        || getScriptaWinningVariant(state);
    const activeStats = activeVariant ? getScriptaReactionStats(state, activeVariant.id) : { score: 0, total: 0 };
    return {
        variants: state.variants.length,
        score: activeStats.score,
        activeScore: activeStats.score,
        activeTotal: activeStats.total,
        totalReactions: getScriptaTotalReactions(state),
        activeVariantId: activeVariant?.id || ""
    };
}
