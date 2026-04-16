import { getWorkspaceRoot } from "./workspaceRoot.js";

const normalizeSlashes = (value) => String(value || '').replace(/\\/g, '/');

const stripTrailingSlash = (value) => normalizeSlashes(value).replace(/\/+$/g, '');

export function getInternalReposRoot({ rootHint } = {}) {
    const workspaceRoot = getWorkspaceRoot({ rootHint });
    const normalizedWorkspace = stripTrailingSlash(workspaceRoot);
    if (!normalizedWorkspace || normalizedWorkspace === '/') {
        return '.ploinky/repos';
    }
    if (normalizedWorkspace.endsWith('/.ploinky/repos')) {
        return normalizedWorkspace;
    }
    return `${normalizedWorkspace}/.ploinky/repos`;
}

export function getRepoScanPaths({ rootHint, includeWorkspaceFallback = true } = {}) {
    const candidates = [
        getWorkspaceRoot({ rootHint }),
        getInternalReposRoot({ rootHint })
    ];

    if (includeWorkspaceFallback) {
        candidates.push(getInternalReposRoot({ rootHint }));
    }

    const seen = new Set();
    return candidates.filter((value) => {
        const normalized = stripTrailingSlash(value || '') || '.';
        if (!normalized) return false;
        if (seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
    });
}

export function getReposRoot(options = {}) {
    return getWorkspaceRoot(options);
}
