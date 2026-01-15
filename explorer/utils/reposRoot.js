const normalizeSlashes = (value) => String(value || '').replace(/\\/g, '/');

const stripTrailingSlash = (value) => normalizeSlashes(value).replace(/\/+$/g, '');

const pickFirstRoot = (value) => {
    if (!value || typeof value !== 'string') return '';
    const first = value.split(',').map((part) => part.trim()).filter(Boolean)[0];
    return first || '';
};

export function getReposRoot({ rootHint } = {}) {
    const envRoot = pickFirstRoot(rootHint)
        || pickFirstRoot(window?.ASSISTOS_FS_ROOT)
        || pickFirstRoot(window?.MCP_FS_ROOT)
        || '';

    const normalizedRoot = stripTrailingSlash(envRoot);
    if (normalizedRoot) {
        if (normalizedRoot.endsWith('/.ploinky/repos')) {
            return normalizedRoot;
        }
        return `${normalizedRoot}/.ploinky/repos`;
    }

    return '.ploinky/repos';
}
