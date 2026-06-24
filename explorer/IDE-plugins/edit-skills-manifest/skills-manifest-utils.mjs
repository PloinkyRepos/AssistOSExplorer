export const SKILLS_MANIFEST_FILE = 'ploinky-skills-manifest.json';

export function buildSkillsManifestPath(folderPath) {
    const normalized = String(folderPath || '').trim().replace(/\/+$/, '');
    if (!normalized) {
        return '';
    }
    return `${normalized}/${SKILLS_MANIFEST_FILE}`;
}

export function parseToolResult(payload) {
    if (!payload) return {};
    if (typeof payload === 'string') {
        try {
            return JSON.parse(payload);
        } catch (_) {
            return {};
        }
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'json')) {
        return payload.json && typeof payload.json === 'object' ? payload.json : {};
    }
    const text = payload?.content?.find?.((entry) => entry?.type === 'text')?.text || payload?.text;
    if (!text) return payload && typeof payload === 'object' ? payload : {};
    try {
        return JSON.parse(text);
    } catch (_) {
        return {};
    }
}

export function deriveRepoNameFromUrl(url) {
    const rawUrl = String(url || '').trim();
    const withoutHash = rawUrl.split('#')[0].split('?')[0].replace(/\/+$/, '');
    const lastSegment = withoutHash.slice(withoutHash.lastIndexOf('/') + 1);
    return lastSegment.replace(/\.git$/i, '').replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
}
