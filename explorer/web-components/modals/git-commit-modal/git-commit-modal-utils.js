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

    const extractJson = (payload) => {
        if (!payload || typeof payload !== 'object') {
            return null;
        }

        if (Object.prototype.hasOwnProperty.call(payload, 'json')) {
            return payload.json;
        }

        const blocks = Array.isArray(payload.content) ? payload.content : null;
        if (blocks) {
            const jsonBlock = blocks.find((block) => block?.type === 'json' && block.json !== undefined);
            if (jsonBlock) {
                return jsonBlock.json;
            }
            const textBlock = blocks.find((block) => block?.type === 'text' && typeof block.text === 'string');
            if (textBlock?.text) {
                try {
                    return JSON.parse(textBlock.text);
                } catch {
                    return null;
                }
            }
        }

        if (typeof payload.text === 'string') {
            const trimmed = payload.text.trim();
            if (trimmed) {
                try {
                    return JSON.parse(trimmed);
                } catch {
                    // ignore
                }
            }
        }

        return payload;
    };

    if (typeof toolResultText !== 'string') {
        return extractJson(toolResultText);
    }

    const trimmed = toolResultText.trim();
    if (!trimmed) {
        return null;
    }

    try {
        const parsed = JSON.parse(trimmed);
        return extractJson(parsed);
    } catch {
        return null;
    }
}

export function normalizeSlashes(value) {
    return String(value || '').replaceAll('\\', '/');
}

export function extractChangePaths(entries) {
    const list = Array.isArray(entries) ? entries : [];
    return list
        .map((entry) => {
            if (!entry) return '';
            if (typeof entry === 'string') return entry;
            return entry.path || entry.filePath || entry.name || '';
        })
        .map((value) => String(value || '').trim())
        .filter(Boolean);
}

export function normalizeGitStatusPayload(payload) {
    const status = payload?.status || payload || {};
    const staged = Array.isArray(status.staged) ? status.staged : [];
    const unstaged = Array.isArray(status.unstaged) ? status.unstaged : [];
    const untracked = Array.isArray(status.untracked) ? status.untracked : [];
    const conflicted = Array.isArray(status.conflicted) ? status.conflicted : [];
    const ignored = Array.isArray(status.ignored) ? status.ignored : [];
    const paths = {
        staged: extractChangePaths(staged),
        unstaged: extractChangePaths(unstaged),
        untracked: extractChangePaths(untracked),
        conflicted: extractChangePaths(conflicted),
        ignored: extractChangePaths(ignored)
    };
    const counts = {
        staged: staged.length,
        unstaged: unstaged.length,
        untracked: untracked.length,
        conflicted: conflicted.length,
        ignored: ignored.length
    };
    return { status, raw: { staged, unstaged, untracked, conflicted, ignored }, paths, counts };
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

export function isGitConflictError(message) {
    const text = String(message || '');
    const lower = text.toLowerCase();
    if (lower.includes('conflict')) return true;
    if (lower.includes('unmerged')) return true;
    if (lower.includes('automatic merge failed')) return true;
    if (lower.includes('fix conflicts')) return true;
    return false;
}

export function isGitPullBlockedError(message) {
    const text = String(message || '');
    const lower = text.toLowerCase();
    if (lower.includes('would be overwritten by merge')) return true;
    if (lower.includes('would be overwritten by checkout')) return true;
    if (lower.includes('please commit your changes or stash them')) return true;
    if (lower.includes('cannot pull with rebase')) return true;
    if (lower.includes('you have unstaged changes')) return true;
    return false;
}

export function extractGitPullBlockedFiles(message) {
    const text = String(message || '');
    if (!text) return [];
    const lines = text.split(/\r?\n/);
    const startIndex = lines.findIndex((line) => line.toLowerCase().includes('would be overwritten by'));
    if (startIndex < 0) return [];
    const files = [];
    for (let i = startIndex + 1; i < lines.length; i += 1) {
        const raw = lines[i] || '';
        const line = raw.trim();
        if (!line) continue;
        const lower = line.toLowerCase();
        if (lower.startsWith('please commit')) break;
        if (lower.startsWith('aborting')) break;
        if (lower.startsWith('error:')) break;
        if (lower.startsWith('fatal:')) break;
        files.push(line);
    }
    return files;
}

const GIT_PAT_STORAGE_KEY = 'webskel.git.pat';
const GIT_IDENTITY_NAME_KEY = 'webskel.git.identity.name';
const GIT_IDENTITY_EMAIL_KEY = 'webskel.git.identity.email';

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

export function getRememberedGitIdentity() {
    try {
        return {
            name: String(localStorage.getItem(GIT_IDENTITY_NAME_KEY) || ''),
            email: String(localStorage.getItem(GIT_IDENTITY_EMAIL_KEY) || '')
        };
    } catch {
        return { name: '', email: '' };
    }
}

export function setRememberedGitIdentity({ name = '', email = '' } = {}) {
    try {
        const trimmedName = String(name || '').trim();
        const trimmedEmail = String(email || '').trim();
        if (trimmedName) {
            localStorage.setItem(GIT_IDENTITY_NAME_KEY, trimmedName);
        } else {
            localStorage.removeItem(GIT_IDENTITY_NAME_KEY);
        }
        if (trimmedEmail) {
            localStorage.setItem(GIT_IDENTITY_EMAIL_KEY, trimmedEmail);
        } else {
            localStorage.removeItem(GIT_IDENTITY_EMAIL_KEY);
        }
    } catch {
        // ignore
    }
}

const AUTOCOMMIT_ENABLED_STORAGE_KEY = 'webskel.git.autocommit.enabled';
const AUTOCOMMIT_INTERVAL_STORAGE_KEY = 'webskel.git.autocommit.intervalMinutes';
const AUTOCOMMIT_REPOS_STORAGE_KEY = 'webskel.git.autocommit.repos';
const AUTORESOLVE_CONFLICTS_STORAGE_KEY = 'webskel.git.autoresolve.conflicts';
const CREDENTIALS_VALIDATED_STORAGE_KEY = 'webskel.git.credentials.validated';
const GIT_CONFLICT_FLAG_STORAGE_KEY = 'webskel.git.conflicts';
const GIT_ERROR_FLAG_STORAGE_KEY = 'webskel.git.errors';

export function getAutocommitSettings() {
    let enabled = true;
    let intervalMinutes = 15;
    let repos = null;
    try {
        const rawEnabled = localStorage.getItem(AUTOCOMMIT_ENABLED_STORAGE_KEY);
        if (rawEnabled === 'true' || rawEnabled === 'false') {
            enabled = rawEnabled === 'true';
        }
        const rawInterval = localStorage.getItem(AUTOCOMMIT_INTERVAL_STORAGE_KEY);
        if (rawInterval !== null && rawInterval !== undefined) {
            const parsed = Number(rawInterval);
            if (Number.isFinite(parsed)) {
                intervalMinutes = Math.max(1, Math.floor(parsed));
            }
        }
        const rawRepos = localStorage.getItem(AUTOCOMMIT_REPOS_STORAGE_KEY);
        if (rawRepos) {
            const parsed = JSON.parse(rawRepos);
            if (Array.isArray(parsed)) {
                repos = parsed.map((entry) => String(entry || '').trim()).filter(Boolean);
            }
        }
    } catch {
        // ignore
    }
    return { enabled, intervalMinutes, repos };
}

export function setAutocommitSettings({ enabled = null, intervalMinutes = null, repos = null } = {}) {
    try {
        if (typeof enabled === 'boolean') {
            localStorage.setItem(AUTOCOMMIT_ENABLED_STORAGE_KEY, enabled ? 'true' : 'false');
        }
        if (intervalMinutes !== null && intervalMinutes !== undefined) {
            const parsed = Number(intervalMinutes);
            if (Number.isFinite(parsed)) {
                localStorage.setItem(AUTOCOMMIT_INTERVAL_STORAGE_KEY, String(Math.max(1, Math.floor(parsed))));
            }
        }
        if (Array.isArray(repos)) {
            const cleaned = repos.map((entry) => String(entry || '').trim()).filter(Boolean);
            localStorage.setItem(AUTOCOMMIT_REPOS_STORAGE_KEY, JSON.stringify(cleaned));
        }
    } catch {
        // ignore
    }
}

export function getConflictAutoresolveSetting() {
    try {
        return localStorage.getItem(AUTORESOLVE_CONFLICTS_STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
}

export function setConflictAutoresolveSetting(value) {
    try {
        localStorage.setItem(AUTORESOLVE_CONFLICTS_STORAGE_KEY, value ? 'true' : 'false');
    } catch {
        // ignore
    }
}

export function getCredentialsValidated() {
    try {
        return localStorage.getItem(CREDENTIALS_VALIDATED_STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
}

export function setCredentialsValidated(value) {
    try {
        localStorage.setItem(CREDENTIALS_VALIDATED_STORAGE_KEY, value ? 'true' : 'false');
    } catch {
        // ignore
    }
}

export function getGitConflictFlag() {
    try {
        return localStorage.getItem(GIT_CONFLICT_FLAG_STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
}

export function setGitConflictFlag(value) {
    try {
        localStorage.setItem(GIT_CONFLICT_FLAG_STORAGE_KEY, value ? 'true' : 'false');
    } catch {
        // ignore
    }
}

export function getGitErrorFlag() {
    try {
        return localStorage.getItem(GIT_ERROR_FLAG_STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
}

export function setGitErrorFlag(value) {
    try {
        localStorage.setItem(GIT_ERROR_FLAG_STORAGE_KEY, value ? 'true' : 'false');
    } catch {
        // ignore
    }
}
