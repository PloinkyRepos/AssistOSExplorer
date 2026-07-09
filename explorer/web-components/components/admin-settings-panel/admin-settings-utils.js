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

export function normalizeAuditCapture(capture = {}) {
    return {
        dpuOperations: capture.dpuOperations !== false,
        fileAccess: capture.fileAccess !== false,
        explorerActions: capture.explorerActions !== false,
        pluginUsage: capture.pluginUsage !== false,
        aiActivity: capture.aiActivity === true
    };
}

export function encodeOptions(options = []) {
    return encodeURIComponent(JSON.stringify(options));
}

export function normalizeToolResult(result) {
    if (!result) return {};
    if (result.json && typeof result.json === 'object') return result.json;
    if (result.raw) return normalizeToolResult(result.raw);
    if (result.isError) {
        throw new Error(extractToolText(result) || 'DPU tool failed.');
    }
    const blocks = Array.isArray(result.content) ? result.content : Array.isArray(result.blocks) ? result.blocks : [];
    const jsonBlock = blocks.find((block) => block?.type === 'json' && block.json !== undefined);
    if (jsonBlock) return jsonBlock.json;
    const text = result.text || extractToolText({ content: blocks });
    if (text) {
        try {
            return JSON.parse(text);
        } catch {
            if (/missing or invalid mcp session/i.test(text)) {
                throw new Error(text);
            }
        }
    }
    return result;
}

export function extractToolText(result) {
    const blocks = Array.isArray(result?.content) ? result.content : Array.isArray(result?.blocks) ? result.blocks : [];
    return blocks.find((block) => block?.type === 'text' && typeof block.text === 'string')?.text || '';
}
