const EXPLORER_THEME_STORAGE_KEY = "assistosExplorerTheme";
const WEBCHAT_THEME_STORAGE_KEY = "webchat_theme";
export const EXPLORER_THEME_CHANGE_EVENT = "explorer-theme-change";

function normalizeTheme(rawTheme) {
    const normalized = typeof rawTheme === "string" ? rawTheme.toLowerCase() : "";
    if (normalized === "dark" || normalized === "obsidian") {
        return "dark";
    }
    return "light";
}

function readStorage(key) {
    try {
        return window.localStorage.getItem(key);
    } catch (_) {
        return null;
    }
}

function writeStorage(key, value) {
    try {
        window.localStorage.setItem(key, value);
    } catch (_) {
        // ignore storage errors
    }
}

export function applyTheme(theme) {
    if (typeof document === "undefined") {
        return "light";
    }
    const normalizedTheme = normalizeTheme(theme);
    const isDark = normalizedTheme === "dark";
    const root = document.documentElement;
    root.classList.toggle("theme-dark", isDark);
    root.classList.toggle("theme-light", !isDark);
    root.setAttribute("theme", normalizedTheme);
    return normalizedTheme;
}

export function getCurrentTheme() {
    if (typeof document === "undefined") {
        return "light";
    }
    return document.documentElement.classList.contains("theme-dark") ? "dark" : "light";
}

export function resolveInitialTheme() {
    if (typeof window === "undefined") {
        return "light";
    }
    const explorerTheme = readStorage(EXPLORER_THEME_STORAGE_KEY);
    if (explorerTheme) {
        return normalizeTheme(explorerTheme);
    }
    const webchatTheme = readStorage(WEBCHAT_THEME_STORAGE_KEY);
    return normalizeTheme(webchatTheme);
}

export function initializeTheme() {
    const initialTheme = resolveInitialTheme();
    return applyTheme(initialTheme);
}

export function setTheme(theme) {
    if (typeof window === "undefined") {
        return "light";
    }
    const normalizedTheme = applyTheme(theme);
    writeStorage(EXPLORER_THEME_STORAGE_KEY, normalizedTheme);
    window.dispatchEvent(new CustomEvent(EXPLORER_THEME_CHANGE_EVENT, {
        detail: { theme: normalizedTheme }
    }));
    return normalizedTheme;
}
