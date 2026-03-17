const normalizeSlashes = (value) => String(value || '').replace(/\\/g, '/');

const stripTrailingSlash = (value) => normalizeSlashes(value).replace(/\/+$/g, '');

const pickFirstRoot = (value) => {
    if (!value || typeof value !== 'string') return '';
    const first = value.split(',').map((part) => part.trim()).filter(Boolean)[0];
    return first || '';
};

export function getWorkspaceRoot({ rootHint } = {}) {
    const envRoot = pickFirstRoot(rootHint)
        || pickFirstRoot(window?.ASSISTOS_FS_ROOT)
        || pickFirstRoot(window?.MCP_FS_ROOT)
        || '';

    const normalizedRoot = stripTrailingSlash(envRoot);
    if (normalizedRoot) {
        return normalizedRoot;
    }

    return '.';
}

export function getInternalReposRoot({ rootHint } = {}) {
    const workspaceRoot = getWorkspaceRoot({ rootHint });
    const normalizedWorkspace = stripTrailingSlash(workspaceRoot);
    if (!normalizedWorkspace || normalizedWorkspace === '.') {
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
        candidates.push('.');
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
