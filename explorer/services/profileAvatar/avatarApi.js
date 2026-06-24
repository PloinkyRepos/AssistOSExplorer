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
const PROFILE_AVATAR_STORAGE_KEY = 'assistOS.profileAvatar.settings';
let axiFaceLoadPromise = null;
let axiFaceModule = null;
let axiFacePacksPromise = null;
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

function getAxiFaceAssetBaseUrl() {
    return `/services/${encodeURIComponent(getCurrentAgentName())}/axi-face`;
}

function getAssistOSUser() {
    const source = typeof window !== 'undefined' ? window.assistOS : globalThis.assistOS;
    const user = source?.user && typeof source.user === 'object' ? source.user : {};
    const id = String(user.id || user.userId || user.email || user.username || 'current-user').trim() || 'current-user';
    const username = String(user.username || user.name || user.email || id).trim();
    const roles = Array.isArray(user.roles) ? user.roles.map((role) => String(role || '').trim()).filter(Boolean) : [];
    return {
        id,
        username,
        roles,
        canManageAgents: roles.includes('admin') || username === 'admin' || id === 'local:admin'
    };
}

function getLocalStorage() {
    try {
        return typeof window !== 'undefined' ? window.localStorage : null;
    } catch (_) {
        return null;
    }
}

function readLocalProfileAvatar() {
    const storage = getLocalStorage();
    if (!storage?.getItem) return null;
    try {
        const parsed = JSON.parse(storage.getItem(PROFILE_AVATAR_STORAGE_KEY) || 'null');
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
        return null;
    }
}

function writeLocalProfileAvatar(payload) {
    const storage = getLocalStorage();
    if (!storage?.setItem) return;
    storage.setItem(PROFILE_AVATAR_STORAGE_KEY, JSON.stringify(payload));
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
    if (customElements.get('axi-face') && axiFaceModule) return;
    if (!axiFaceLoadPromise) {
        axiFaceLoadPromise = import(`${getAxiFaceModuleUrl()}?cacheBust=${Date.now()}`).catch((error) => {
            axiFaceLoadPromise = null;
            throw error;
        });
    }
    axiFaceModule = await axiFaceLoadPromise;
}

function normalizeAxiFaceStringList(values = []) {
    if (Array.isArray(values)) {
        return values.map((value) => String(value || '').trim()).filter(Boolean);
    }
    if (values && typeof values === 'object') {
        return Object.keys(values).map((value) => String(value || '').trim()).filter(Boolean);
    }
    return [];
}

function normalizeAxiFacePackList(packs = []) {
    if (!Array.isArray(packs)) return [];
    const base = getAxiFaceAssetBaseUrl();
    return packs
        .map((pack) => {
            if (!pack || typeof pack !== 'object') return null;
            const id = String(pack.id || '').trim();
            if (!id) return null;
            const manifestSrc = String(pack.manifestSrc || pack.packSrc || pack.src || '').trim()
                || `${base}/packs/${encodeURIComponent(id)}/manifest.json`;
            const resolvedManifestSrc = manifestSrc.startsWith('/axi-face/')
                ? `${base}${manifestSrc.slice('/axi-face'.length)}`
                : manifestSrc;
            return {
                id,
                label: String(pack.label || pack.name || id).trim(),
                type: String(pack.type || '').trim(),
                defaultEmotion: String(pack.defaultEmotion || '').trim(),
                emotions: Array.isArray(pack.emotions) ? pack.emotions.map((item) => String(item || '').trim()).filter(Boolean) : [],
                manifestSrc: resolvedManifestSrc
            };
        })
        .filter(Boolean);
}

export async function loadAxiFaceGeneratedFaceStyles() {
    await ensureAxiFaceLoaded();
    return normalizeAxiFaceStringList(axiFaceModule?.GENERATED_FACE_STYLES);
}

export async function loadAxiFaceGeneratedFacePalettes() {
    await ensureAxiFaceLoaded();
    return normalizeAxiFaceStringList(axiFaceModule?.listGeneratedFacePalettes?.() || axiFaceModule?.DEFAULT_GENERATED_FACE_PALETTES);
}

export async function loadAxiFacePacks() {
    if (!axiFacePacksPromise) {
        axiFacePacksPromise = fetch(`${getAxiFaceAssetBaseUrl()}/packs/index.json`, {
            credentials: 'include',
            headers: { Accept: 'application/json' }
        })
            .then(async (response) => {
                const payload = await response.json().catch(() => ({}));
                if (!response.ok || payload.ok === false) {
                    throw new Error(payload.error || `AxiFace pack index request failed (${response.status}).`);
                }
                return normalizeAxiFacePackList(payload.packs);
            })
            .catch((error) => {
                axiFacePacksPromise = null;
                throw error;
            });
    }
    return axiFacePacksPromise;
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
    currentUserCache.promise = Promise.resolve().then(() => {
        const user = getAssistOSUser();
        const stored = readLocalProfileAvatar();
        currentUserCache.value = normalizeProfileAvatarPayload({
            ok: true,
            user,
            enabled: stored?.enabled !== false,
            config: stored?.config,
            fallbackLetter: user.username || user.id,
            source: { kind: 'localStorage' }
        });
        return currentUserCache.value;
    }).finally(() => {
        currentUserCache.promise = null;
    });
    return currentUserCache.promise;
}

export async function saveCurrentProfileAvatar({ enabled = true, config } = {}) {
    const user = getAssistOSUser();
    const normalizedConfig = normalizeAvatarConfig(config, `profile:${user.id}`);
    writeLocalProfileAvatar({
        enabled: enabled !== false,
        config: normalizedConfig,
        updatedAt: new Date().toISOString()
    });
    const avatar = normalizeProfileAvatarPayload({
        ok: true,
        user,
        enabled: enabled !== false,
        config: normalizedConfig,
        fallbackLetter: user.username || user.id,
        source: { kind: 'localStorage' }
    });
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
