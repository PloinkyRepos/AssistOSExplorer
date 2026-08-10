export function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

export function escapeAttr(value) {
    return escapeHtml(value).replaceAll("'", '&#39;');
}

export function parseRoles(value) {
    const values = Array.isArray(value) ? value : [value];
    const roles = values
        .flatMap((entry) => String(entry || '').split(','))
        .map((role) => role.trim())
        .filter((role) => role.toLowerCase() !== 'local')
        .filter(Boolean);
    return Array.from(new Set(roles));
}

export function encodeOptions(options = []) {
    return encodeURIComponent(JSON.stringify(options));
}
