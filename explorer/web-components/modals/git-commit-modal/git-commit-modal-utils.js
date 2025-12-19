export function normalizeErrorMessage(error) {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message || 'Unknown error';
    return String(error);
}

export function humanizeGitError(message, { action = null } = {}) {
    const raw = String(message || '').trim();
    if (!raw) return 'Unknown error';

    const cleaned = raw
        .split(/\r?\n/)
        .filter((line) => !line.trim().toLowerCase().startsWith('hint:'))
        .join('\n')
        .trim();

    const lower = cleaned.toLowerCase();
    if (action === 'pull' && (
        lower.includes('not possible to fast-forward')
        || lower.includes("can't be fast-forwarded")
        || lower.includes('diverging branches')
        || lower.includes('need to specify how to reconcile divergent branches')
        || lower.includes('specify how to reconcile them')
    )) {
        return 'Pull failed: branches diverged. Use Pull ▾ → Rebase or Merge.';
    }

    return cleaned || raw;
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

export function isGitAuthError(message) {
    const text = String(message || '');
    const lower = text.toLowerCase();
    if (lower.includes('terminal prompts disabled')) return true;
    if (lower.includes('could not read username')) return true;
    if (lower.includes('could not read password')) return true;
    if (lower.includes('authentication failed')) return true;
    if (lower.includes('fatal: authentication')) return true;
    if (lower.includes('http basic: access denied')) return true;
    if (lower.includes('permission denied')) return true;
    return false;
}

export function isGitIdentityError(message) {
    const text = String(message || '');
    const lower = text.toLowerCase();
    if (lower.includes('author identity unknown')) return true;
    if (lower.includes('committer identity unknown')) return true;
    if (lower.includes('unable to auto-detect email address')) return true;
    if (lower.includes('please tell me who you are')) return true;
    return false;
}

const GIT_PAT_STORAGE_KEY = 'webskel.git.pat';

export function getRememberedGitPat() {
    try {
        return String(localStorage.getItem(GIT_PAT_STORAGE_KEY) || '');
    } catch {
        return '';
    }
}

export function setRememberedGitPat(token) {
    try {
        const value = String(token || '').trim();
        if (!value) {
            localStorage.removeItem(GIT_PAT_STORAGE_KEY);
            return;
        }
        localStorage.setItem(GIT_PAT_STORAGE_KEY, value);
    } catch {
        // ignore
    }
}
