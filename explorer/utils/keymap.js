const STORAGE_KEY = 'assistosExplorerKeymap';

const DEFAULT_KEYMAP = {
    findFile: 'Mod+P',
    findInFiles: 'Mod+Shift+F',
    replaceInFiles: 'Mod+Shift+R',
    saveFile: 'Mod+S',
    llmAutocomplete: 'Alt+Space',
    openKeymap: 'Mod+K'
};

const KEYMAP_ACTIONS = [
    {
        id: 'findFile',
        label: 'Find File',
        description: 'Search by file name'
    },
    {
        id: 'findInFiles',
        label: 'Find in Files',
        description: 'Search text across files'
    },
    {
        id: 'replaceInFiles',
        label: 'Find/Replace in Files',
        description: 'Search and replace across files'
    },
    {
        id: 'saveFile',
        label: 'Save File',
        description: 'Save the active file'
    },
    {
        id: 'llmAutocomplete',
        label: 'LLM Autocomplete',
        description: 'Insert AI completion at the cursor'
    },
    {
        id: 'openKeymap',
        label: 'Open Keymap',
        description: 'Open keyboard shortcuts'
    }
];

const KEY_ALIASES = {
    ' ': 'Space',
    '\u00A0': 'Space',
    Spacebar: 'Space',
    Esc: 'Escape',
    Del: 'Delete',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right'
};

let cachedKeymap = null;

function isMacPlatform() {
    if (typeof navigator === 'undefined') return false;
    return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent || '');
}

function normalizeKeyName(key) {
    if (!key) return '';
    const aliased = KEY_ALIASES[key] || key;
    if (aliased.length === 1) return aliased.toUpperCase();
    return aliased.charAt(0).toUpperCase() + aliased.slice(1);
}

function parseShortcutString(shortcut) {
    if (!shortcut || typeof shortcut !== 'string') return null;
    const parts = shortcut.split('+').map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return null;

    const parsed = {
        mod: false,
        ctrl: false,
        meta: false,
        alt: false,
        shift: false,
        key: ''
    };

    for (const part of parts) {
        const token = part.toLowerCase();
        if (token === 'mod') {
            parsed.mod = true;
            continue;
        }
        if (token === 'ctrl' || token === 'control') {
            parsed.ctrl = true;
            continue;
        }
        if (token === 'cmd' || token === 'command' || token === 'meta') {
            parsed.meta = true;
            continue;
        }
        if (token === 'alt' || token === 'option') {
            parsed.alt = true;
            continue;
        }
        if (token === 'shift') {
            parsed.shift = true;
            continue;
        }
        parsed.key = normalizeKeyName(part);
    }

    if (!parsed.key) return null;
    return parsed;
}

function formatShortcut(parsed) {
    const parts = [];
    if (parsed.mod) {
        parts.push('Mod');
    } else {
        if (parsed.ctrl) parts.push('Ctrl');
        if (parsed.meta) parts.push('Meta');
    }
    if (parsed.alt) parts.push('Alt');
    if (parsed.shift) parts.push('Shift');
    if (parsed.key) parts.push(parsed.key);
    return parts.join('+');
}

export function normalizeShortcutString(shortcut) {
    const parsed = parseShortcutString(shortcut);
    if (!parsed) return '';
    return formatShortcut(parsed);
}

export function formatShortcutForDisplay(shortcut) {
    const parsed = parseShortcutString(shortcut);
    if (!parsed) return '';
    const parts = [];
    if (parsed.mod) {
        parts.push(isMacPlatform() ? 'Cmd' : 'Ctrl');
    } else {
        if (parsed.ctrl) parts.push('Ctrl');
        if (parsed.meta) parts.push('Cmd');
    }
    if (parsed.alt) parts.push(isMacPlatform() ? 'Option' : 'Alt');
    if (parsed.shift) parts.push('Shift');
    if (parsed.key) parts.push(parsed.key === 'Space' ? 'Space' : parsed.key);
    return parts.join('+');
}

export function eventToShortcut(event) {
    if (!event || typeof event.key !== 'string') return '';
    const key = event.code === 'Space' ? 'Space' : normalizeKeyName(event.key);
    if (!key) return '';
    const lower = key.toLowerCase();
    if (lower === 'shift' || lower === 'alt' || lower === 'control' || lower === 'meta') {
        return '';
    }
    const parsed = {
        mod: Boolean(event.metaKey || event.ctrlKey),
        ctrl: false,
        meta: false,
        alt: Boolean(event.altKey),
        shift: Boolean(event.shiftKey),
        key
    };
    return formatShortcut(parsed);
}

export function matchesShortcut(event, shortcut) {
    const parsed = parseShortcutString(shortcut);
    if (!parsed) return false;
    const key = normalizeKeyName(event.key);
    if (!key || key !== parsed.key) {
        if (!(parsed.key === 'Space' && event.code === 'Space')) {
            return false;
        }
    }

    if (parsed.mod) {
        if (!(event.ctrlKey || event.metaKey)) return false;
    } else {
        if (event.ctrlKey !== parsed.ctrl) return false;
        if (event.metaKey !== parsed.meta) return false;
    }
    if (event.altKey !== parsed.alt) return false;
    if (event.shiftKey !== parsed.shift) return false;
    return true;
}

export function getDefaultKeymap() {
    return { ...DEFAULT_KEYMAP };
}

export function getKeymapActions() {
    return KEYMAP_ACTIONS.map((action) => ({ ...action }));
}

function normalizeKeymap(input) {
    const base = getDefaultKeymap();
    const output = { ...base };
    if (!input || typeof input !== 'object') {
        return output;
    }
    for (const key of Object.keys(base)) {
        if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
        const raw = input[key];
        if (raw === '' || raw === null) {
            output[key] = '';
            continue;
        }
        if (typeof raw !== 'string') {
            output[key] = base[key];
            continue;
        }
        const normalized = normalizeShortcutString(raw);
        output[key] = normalized || base[key];
    }
    return output;
}

export function loadKeymap() {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return getDefaultKeymap();
        const parsed = JSON.parse(raw);
        return normalizeKeymap(parsed);
    } catch (_) {
        return getDefaultKeymap();
    }
}

export function saveKeymap(keymap) {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keymap));
    } catch (_) {
        // ignore
    }
}

export function getKeymap() {
    if (!cachedKeymap) {
        cachedKeymap = loadKeymap();
    }
    return cachedKeymap;
}

export function setKeymap(nextKeymap) {
    cachedKeymap = normalizeKeymap(nextKeymap);
    saveKeymap(cachedKeymap);
    return cachedKeymap;
}

export function resetKeymap() {
    cachedKeymap = getDefaultKeymap();
    saveKeymap(cachedKeymap);
    return cachedKeymap;
}
