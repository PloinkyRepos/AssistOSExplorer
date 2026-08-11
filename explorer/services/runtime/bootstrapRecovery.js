const RELOAD_STATE_KEY = 'explorer:bootstrap-asset-reloads';
const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504]);
const TRANSIENT_ASSET_PATTERNS = [
    /failed to fetch dynamically imported module/i,
    /failed to fetch/i,
    /service unavailable/i,
    /\((?:502|503|504)\)/,
    /\b(?:502|503|504)\b/
];

export function isTransientAssetLoadError(error) {
    const status = Number(error?.status ?? error?.statusCode);
    if (TRANSIENT_HTTP_STATUSES.has(status)) return true;
    const details = [error?.message, error?.stack, error]
        .filter(Boolean)
        .map((value) => String(value))
        .join('\n');
    return TRANSIENT_ASSET_PATTERNS.some((pattern) => pattern.test(details));
}

export function clearBootstrapReloadState(windowRef = globalThis.window) {
    try {
        windowRef?.sessionStorage?.removeItem(RELOAD_STATE_KEY);
    } catch (_) {
        // Storage may be unavailable in privacy-restricted browser contexts.
    }
}

export function scheduleBootstrapReload(error, {
    windowRef = globalThis.window,
    maxReloads = 3,
    delayMs = 750
} = {}) {
    if (!windowRef || !isTransientAssetLoadError(error)) return false;
    try {
        const previous = Number.parseInt(windowRef.sessionStorage.getItem(RELOAD_STATE_KEY) || '0', 10);
        const count = Number.isFinite(previous) ? previous : 0;
        if (count >= maxReloads) return false;
        windowRef.sessionStorage.setItem(RELOAD_STATE_KEY, String(count + 1));
        windowRef.setTimeout(() => windowRef.location.reload(), delayMs);
        return true;
    } catch (_) {
        return false;
    }
}
