import {
    ensureAxiFaceLoaded,
    getCurrentProfileAvatar,
    invalidateProfileAvatarCache
} from './avatarApi.js';
import { getFallbackLetter } from './avatarConfig.js';

export function createParticipantProfileAvatarController({
    getParticipantDisplayName = (participant) => String(participant?.identity || 'Participant'),
    getParticipantAvatarUserId = (participant) => (participant?.kind === 'local' ? 'me' : ''),
    loadAxiFace = ensureAxiFaceLoaded
} = {}) {
    const requestTokens = new Map();

    const applyFallback = (view, participant = null) => {
        const label = getParticipantDisplayName(participant) || view?.name || view?.id || '';
        view.avatarEnabled = false;
        view.avatarConfig = null;
        view.avatarFallbackLetter = getFallbackLetter(label);
        view.avatarResolved = true;
    };

    const getProjectedAvatar = (participant = null) => {
        const projected = participant?.profileAvatar && typeof participant.profileAvatar === 'object'
            ? participant.profileAvatar
            : null;
        if (!projected) return null;
        return {
            enabled: projected.enabled !== false,
            config: projected.config && typeof projected.config === 'object' ? projected.config : null,
            fallbackLetter: projected.fallbackLetter || ''
        };
    };

    const refresh = async (view, participant = null, apply = () => {}) => {
        if (!view?.id) return;
        const token = Symbol(view.id);
        requestTokens.set(view.id, token);
        const userId = String(getParticipantAvatarUserId(participant) || view.avatarUserId || '').trim();
        view.avatarUserId = userId;
        if (!userId) {
            applyFallback(view, participant);
            apply(view);
            return;
        }
        try {
            const projectedAvatar = userId === 'me' ? null : getProjectedAvatar(participant);
            const avatar = projectedAvatar || (userId === 'me'
                ? await getCurrentProfileAvatar()
                : null);
            if (!avatar) {
                if (userId !== 'me' && view.avatarConfig) {
                    view.avatarEnabled = true;
                    view.avatarResolved = true;
                    apply(view);
                    return;
                }
                applyFallback(view, participant);
                apply(view);
                return;
            }
            if (requestTokens.get(view.id) !== token) return;
            view.avatarEnabled = avatar.enabled !== false;
            view.avatarConfig = view.avatarEnabled ? avatar.config : null;
            view.avatarFallbackLetter = avatar.fallbackLetter || getFallbackLetter(getParticipantDisplayName(participant) || view.name || view.id);
            view.avatarResolved = true;
            apply(view);
            if (view.avatarEnabled && view.avatarConfig) {
                await loadAxiFace().catch(() => {});
            }
            if (requestTokens.get(view.id) !== token) return;
        } catch (_) {
            if (requestTokens.get(view.id) !== token) return;
            applyFallback(view, participant);
            apply(view);
            return;
        }
        apply(view);
    };

    const bindUpdates = (getViews, apply = () => {}) => {
        const refreshMatchingViews = (userId = '') => {
            const normalizedUserId = String(userId || '').trim();
            invalidateProfileAvatarCache(normalizedUserId);
            for (const view of getViews?.() || []) {
                if (normalizedUserId && String(view?.avatarUserId || '').trim() !== normalizedUserId) {
                    continue;
                }
                refresh(view, null, apply);
            }
        };
        const handler = (event) => {
            refreshMatchingViews(event?.detail?.userId || '');
        };
        window.addEventListener('assistOS:avatar-settings-updated', handler);
        return () => window.removeEventListener('assistOS:avatar-settings-updated', handler);
    };

    return {
        applyFallback,
        bindUpdates,
        refresh,
        refreshUser(userId, getViews, apply = () => {}) {
            const normalizedUserId = String(userId || '').trim();
            if (!normalizedUserId) return;
            invalidateProfileAvatarCache(normalizedUserId);
            for (const view of getViews?.() || []) {
                if (String(view?.avatarUserId || '').trim() === normalizedUserId) {
                    refresh(view, null, apply);
                }
            }
        }
    };
}
