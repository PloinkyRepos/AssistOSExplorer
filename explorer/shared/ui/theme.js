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

const PREFERS_DARK_QUERY = "(prefers-color-scheme: dark)";

function matchPrefersDark() {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return null;
    }
    try {
        return window.matchMedia(PREFERS_DARK_QUERY);
    } catch (_) {
        return null;
    }
}

// Detect the theme the browser/OS is currently asking for via prefers-color-scheme.
export function detectBrowserTheme() {
    const query = matchPrefersDark();
    return query && query.matches ? "dark" : "light";
}

// True when the user (or webchat) has an explicit, stored theme choice that must win over the OS.
export function hasStoredThemePreference() {
    return Boolean(readStorage(EXPLORER_THEME_STORAGE_KEY) || readStorage(WEBCHAT_THEME_STORAGE_KEY));
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
    if (webchatTheme) {
        return normalizeTheme(webchatTheme);
    }
    // No stored preference anywhere: follow the browser/OS theme as the default.
    return detectBrowserTheme();
}

let browserThemeListenerAttached = false;

// Keep following the OS theme while the user has not explicitly chosen one.
function attachBrowserThemeListener() {
    if (browserThemeListenerAttached) {
        return;
    }
    const query = matchPrefersDark();
    if (!query) {
        return;
    }
    const handler = (event) => {
        if (hasStoredThemePreference()) {
            return;
        }
        applyTheme(event.matches ? "dark" : "light");
        window.dispatchEvent(new CustomEvent(EXPLORER_THEME_CHANGE_EVENT, {
            detail: { theme: getCurrentTheme(), source: "system" }
        }));
    };
    if (typeof query.addEventListener === "function") {
        query.addEventListener("change", handler);
    }
    browserThemeListenerAttached = true;
}

export function initializeTheme() {
    const initialTheme = resolveInitialTheme();
    const applied = applyTheme(initialTheme);
    attachBrowserThemeListener();
    return applied;
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
