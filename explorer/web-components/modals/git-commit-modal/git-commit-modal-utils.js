export function normalizeErrorMessage(error) {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message || 'Unknown error';
    return String(error);
}

export function parseJsonToolResult(toolResultText) {
    if (!toolResultText) return null;
    if (typeof toolResultText !== 'string') return toolResultText;
    return JSON.parse(toolResultText);
}

export function normalizeSlashes(value) {
    return String(value || '').replaceAll('\\', '/');
}

export function stripTrailingSlash(value) {
    return normalizeSlashes(value).replace(/\/+$/g, '');
}

export function isReposRootPath(candidate, reposRoot) {
    const normalizedCandidate = stripTrailingSlash(candidate);
    const normalizedRoot = stripTrailingSlash(reposRoot);
    if (!normalizedCandidate || !normalizedRoot) return false;
    if (normalizedCandidate === normalizedRoot) return true;
    return normalizedCandidate.endsWith(normalizedRoot);
}

