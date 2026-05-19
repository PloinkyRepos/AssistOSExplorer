import {
    getFallbackLetter,
    normalizeAvatarConfig
} from './avatarConfig.js';

const currentUserCache = {
    value: null,
    promise: null
};

const AVATAR_SETTINGS_EVENT = 'assistOS:avatar-settings-updated';
const AVATAR_SETTINGS_CHANNEL = 'assistOS.avatar-settings';
const AVATAR_SETTINGS_STORAGE_KEY = 'assistOS.avatar-settings.updated';
let axiFaceLoadPromise = null;
let updateListenerInstalled = false;
let avatarBroadcastChannel = null;

function dispatchAvatarSettingsEvent(detail = {}) {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(AVATAR_SETTINGS_EVENT, { detail }));
}

function broadcastAvatarSettingsUpdate(detail = {}) {
    if (typeof window === 'undefined') return;
    const message = {
        ...detail,
        sentAt: new Date().toISOString()
    };
    try {
        if (!avatarBroadcastChannel && typeof BroadcastChannel === 'function') {
            avatarBroadcastChannel = new BroadcastChannel(AVATAR_SETTINGS_CHANNEL);
        }
        avatarBroadcastChannel?.postMessage(message);
    } catch (_) {
        // BroadcastChannel is optional; localStorage below covers older contexts.
    }
    try {
        window.localStorage?.setItem(AVATAR_SETTINGS_STORAGE_KEY, JSON.stringify(message));
    } catch (_) {
        // Storage events are best-effort cross-tab notifications.
    }
}

function getCurrentAgentName() {
    try {
        const parts = new URL(import.meta.url, window.location.href).pathname.split('/').filter(Boolean);
        return parts[0] || 'explorer';
    } catch (_) {
        return 'explorer';
    }
}

function getAxiFaceModuleUrl() {
    return `/services/${encodeURIComponent(getCurrentAgentName())}/axi-face/src/axi-face.mjs`;
}

async function fetchAvatarJson(path, options = {}) {
    const response = await fetch(`/services/explorer/avatar-settings/${path}`, {
        credentials: 'include',
        headers: {
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {})
        },
        ...options
    });
    const parsed = await response.json().catch(() => ({}));
    if (!response.ok || parsed.ok === false) {
        throw new Error(parsed.error || `Avatar settings request failed (${response.status}).`);
    }
    return parsed;
}

function installUpdateListener() {
    if (updateListenerInstalled || typeof window === 'undefined') return;
    window.addEventListener(AVATAR_SETTINGS_EVENT, (event) => {
        const type = String(event?.detail?.type || '').trim();
        if (!type || type === 'profile') {
            invalidateProfileAvatarCache();
        }
    });
    try {
        if (typeof BroadcastChannel === 'function') {
            avatarBroadcastChannel = avatarBroadcastChannel || new BroadcastChannel(AVATAR_SETTINGS_CHANNEL);
            avatarBroadcastChannel.addEventListener('message', (event) => {
                if (event?.data && typeof event.data === 'object') {
                    dispatchAvatarSettingsEvent(event.data);
                }
            });
        }
    } catch (_) {
        // Ignore optional cross-tab channel failures.
    }
    window.addEventListener('storage', (event) => {
        if (event.key !== AVATAR_SETTINGS_STORAGE_KEY || !event.newValue) return;
        try {
            const detail = JSON.parse(event.newValue);
            if (detail && typeof detail === 'object') {
                dispatchAvatarSettingsEvent(detail);
            }
        } catch (_) {
            // Ignore malformed storage notifications.
        }
    });
    updateListenerInstalled = true;
}

export async function ensureAxiFaceLoaded() {
    if (customElements.get('axi-face')) return;
    if (!axiFaceLoadPromise) {
        axiFaceLoadPromise = import(`${getAxiFaceModuleUrl()}?cacheBust=${Date.now()}`).catch((error) => {
            axiFaceLoadPromise = null;
            throw error;
        });
    }
    await axiFaceLoadPromise;
}

function normalizeProfileAvatarPayload(payload = {}) {
    const avatar = payload.avatar && typeof payload.avatar === 'object'
        ? payload.avatar
        : {
            enabled: payload.enabled,
            config: payload.profileAvatar || payload.config,
            fallbackLetter: payload.fallbackLetter,
            source: payload.source
        };
    const userId = payload.user?.id || 'current-user';
    const fallbackId = `profile:${userId}`;
    return {
        ok: payload.ok !== false,
        user: payload.user || null,
        enabled: avatar.enabled !== false,
        config: normalizeAvatarConfig(avatar.config, fallbackId),
        fallbackLetter: getFallbackLetter(avatar.fallbackLetter || payload.user?.username || userId),
        source: avatar.source && typeof avatar.source === 'object' ? avatar.source : { kind: 'fallback' }
    };
}

export async function getCurrentProfileAvatar({ force = false } = {}) {
    installUpdateListener();
    if (!force && currentUserCache.value) {
        return currentUserCache.value;
    }
    if (!force && currentUserCache.promise) {
        return currentUserCache.promise;
    }
    currentUserCache.promise = fetchAvatarJson('me')
        .then((payload) => {
            currentUserCache.value = normalizeProfileAvatarPayload(payload);
            return currentUserCache.value;
        })
        .finally(() => {
            currentUserCache.promise = null;
        });
    return currentUserCache.promise;
}

export async function saveCurrentProfileAvatar({ enabled = true, config } = {}) {
    const payload = await fetchAvatarJson('me', {
        method: 'PATCH',
        body: JSON.stringify({ enabled, config })
    });
    const avatar = normalizeProfileAvatarPayload(payload);
    currentUserCache.value = avatar;
    currentUserCache.promise = null;
    const userId = avatar.user?.id || '';
    const detail = {
        type: 'profile',
        userId,
        enabled: avatar.enabled,
        config: avatar.config,
        source: avatar.source
    };
    dispatchAvatarSettingsEvent(detail);
    broadcastAvatarSettingsUpdate(detail);
    return avatar;
}

export function invalidateProfileAvatarCache() {
    currentUserCache.value = null;
    currentUserCache.promise = null;
}
