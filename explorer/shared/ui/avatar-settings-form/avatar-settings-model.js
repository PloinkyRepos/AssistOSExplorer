export const AVATAR_SOURCE_MODES = Object.freeze({
    GENERATED: 'generated',
    PACK: 'pack',
    SVG: 'svg'
});

export const AVATAR_COMMON_OPTIONS = Object.freeze({
    assetMode: Object.freeze(['img', 'inline']),
    emotion: Object.freeze(['neutral', 'idle', 'listening', 'thinking', 'speaking', 'happy', 'amused', 'confused', 'concerned', 'alert', 'sleepy']),
    thoughtMode: Object.freeze(['none', 'bubble', 'caption', 'ticker', 'inside']),
    mode: Object.freeze(['static', 'controlled', 'event-driven', 'autonomous']),
    shape: Object.freeze(['circle', 'square', 'rounded', 'none']),
    theme: Object.freeze(['auto', 'light', 'dark']),
    complexity: Object.freeze(['', 'low', 'medium', 'high'])
});

export const DEFAULT_AVATAR_PALETTES = Object.freeze(['default', 'warm', 'mono', 'terminal', 'emoji']);

export function normalizeAvatarSourceMode(value = '') {
    const raw = String(value || '').trim();
    return Object.values(AVATAR_SOURCE_MODES).includes(raw)
        ? raw
        : '';
}

export function deriveAvatarSourceMode(config = {}) {
    const source = config && typeof config === 'object' ? config : {};
    const explicit = normalizeAvatarSourceMode(source.sourceMode || source['source-mode']);
    if (explicit) return explicit;
    if (String(source.src || '').trim()) return AVATAR_SOURCE_MODES.SVG;
    if (String(source.packSrc || source['pack-src'] || '').trim()) return AVATAR_SOURCE_MODES.PACK;
    if (source.generated === false) return AVATAR_SOURCE_MODES.PACK;
    return AVATAR_SOURCE_MODES.GENERATED;
}

export function formatAvatarOptionLabel(value = '') {
    const text = String(value || '').trim();
    if (!text) return 'Default';
    return text
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
        .join(' ');
}

export function normalizeAvatarPackList(packs = [], assetBaseUrl = '') {
    if (!Array.isArray(packs)) return [];
    const base = String(assetBaseUrl || '').replace(/\/+$/g, '');
    return packs
        .map((entry) => {
            if (!entry || typeof entry !== 'object') return null;
            const id = String(entry.id || '').trim();
            const manifestSrc = String(entry.manifestSrc || entry.packSrc || entry.src || '').trim()
                || (id && base ? `${base}/packs/${encodeURIComponent(id)}/manifest.json` : '');
            if (!id || !manifestSrc) return null;
            return {
                id,
                label: String(entry.label || entry.name || formatAvatarOptionLabel(id)).trim(),
                manifestSrc,
                defaultEmotion: String(entry.defaultEmotion || '').trim(),
                type: String(entry.type || '').trim()
            };
        })
        .filter(Boolean);
}

export function normalizeGeneratedStyleList(styles = []) {
    if (!Array.isArray(styles)) return [];
    return styles
        .map((style) => String(style || '').trim())
        .filter(Boolean);
}

export function normalizeGeneratedPaletteList(palettes = []) {
    if (Array.isArray(palettes)) {
        return palettes.map((palette) => String(palette || '').trim()).filter(Boolean);
    }
    if (palettes && typeof palettes === 'object') {
        return Object.keys(palettes).map((palette) => String(palette || '').trim()).filter(Boolean);
    }
    return [...DEFAULT_AVATAR_PALETTES];
}

export function getDefaultAvatarPackSrc(packs = []) {
    const first = normalizeAvatarPackList(packs)[0];
    return first?.manifestSrc || '';
}

export function normalizeAvatarForSourceMode(config = {}, sourceMode = deriveAvatarSourceMode(config), options = {}) {
    const mode = Object.values(AVATAR_SOURCE_MODES).includes(sourceMode)
        ? sourceMode
        : deriveAvatarSourceMode(config);
    const source = config && typeof config === 'object' ? { ...config } : {};
    const packs = Array.isArray(options.packs) ? options.packs : [];
    if (mode === AVATAR_SOURCE_MODES.GENERATED) {
        return {
            ...source,
            sourceMode: mode,
            generated: true,
            src: '',
            packSrc: ''
        };
    }
    if (mode === AVATAR_SOURCE_MODES.PACK) {
        const packSrc = String(source.packSrc || '').trim() || getDefaultAvatarPackSrc(packs);
        return {
            ...source,
            sourceMode: mode,
            generated: false,
            src: '',
            packSrc
        };
    }
    return {
        ...source,
        sourceMode: mode,
        generated: false,
        packSrc: '',
        src: String(source.src || '').trim()
    };
}

export function toAvatarSettingsViewModel(config = {}, options = {}) {
    const sourceMode = options.sourceMode || deriveAvatarSourceMode(config);
    return {
        sourceMode,
        config: normalizeAvatarForSourceMode(config, sourceMode, options)
    };
}

export function buildAvatarFieldState(sourceMode = AVATAR_SOURCE_MODES.GENERATED) {
    return {
        sourceMode,
        generated: sourceMode === AVATAR_SOURCE_MODES.GENERATED,
        pack: sourceMode === AVATAR_SOURCE_MODES.PACK,
        svg: sourceMode === AVATAR_SOURCE_MODES.SVG,
        common: true
    };
}
