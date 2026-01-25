import { parseJsonToolResult, normalizeGitStatusPayload } from "./git-commit-modal-utils.js";

export function createRepoActions(ctx) {
    const {
        getState,
        applyState,
        service
    } = ctx;

    const toChangeRows = (status, limit = 800) => {
        const map = new Map();
        const touch = (entry, flag) => {
            if (!entry) return;
            const pathValue = entry && typeof entry === 'object' ? entry.path : entry;
            const key = String(pathValue || '').trim();
            if (!key) return;
            const existing = map.get(key) || {
                path: key,
                flags: { staged: false, unstaged: false, untracked: false, conflicted: false },
                origPath: null,
                x: ' ',
                y: ' '
            };
            existing.flags[flag] = true;
            if (entry?.origPath && !existing.origPath) existing.origPath = entry.origPath;
            if (typeof entry?.x === 'string' && entry.x.length) {
                if (existing.x === ' ' || existing.x === '?' || entry.x !== ' ') {
                    existing.x = entry.x;
                }
            }
            if (typeof entry?.y === 'string' && entry.y.length) {
                if (existing.y === ' ' || existing.y === '?' || entry.y !== ' ') {
                    existing.y = entry.y;
                }
            }
            map.set(key, existing);
        };

        const slice = (list) => (Array.isArray(list) ? list : []).slice(0, limit);
        for (const entry of slice(status.conflicted)) touch(entry, 'conflicted');
        for (const entry of slice(status.untracked)) touch(entry, 'untracked');
        for (const entry of slice(status.unstaged)) touch(entry, 'unstaged');
        for (const entry of slice(status.staged)) touch(entry, 'staged');

        const rows = Array.from(map.values());
        for (const row of rows) {
            const f = row.flags || {};
            row.kind = f.conflicted ? 'conflicted'
                : f.untracked ? 'untracked'
                    : (f.staged && f.unstaged) ? 'staged+unstaged'
                        : f.staged ? 'staged'
                            : f.unstaged ? 'unstaged'
                                : 'unknown';
        }
        rows.sort((a, b) => a.path.localeCompare(b.path));
        return rows;
    };

    const updateRepoOverviewFromStatus = (repoPath, statusPayload) => {
        const state = getState();
        const normalized = normalizeGitStatusPayload(statusPayload);
        const { raw, paths, counts } = normalized;
        const staged = raw.staged;
        const unstaged = raw.unstaged;
        const untracked = raw.untracked;
        const conflicted = raw.conflicted;
        const ignored = raw.ignored;
        const changes = {
            staged: paths.staged,
            unstaged: paths.unstaged,
            untracked: paths.untracked,
            conflicted: paths.conflicted
        };
        const dirty = counts.staged + counts.unstaged + counts.untracked + counts.conflicted > 0;
        const repoList = Array.isArray(state.repoOverviews) ? state.repoOverviews : [];
        const nextRepoOverviews = repoList.map((repo) => {
            if (!repo || repo.path !== repoPath) return repo;
            return {
                ...repo,
                ok: true,
                dirty,
                counts,
                changes,
                changesAll: toChangeRows({ staged, unstaged, untracked, conflicted }),
                sample: {
                    staged: changes.staged.slice(0, 8),
                    unstaged: changes.unstaged.slice(0, 8),
                    untracked: changes.untracked.slice(0, 8),
                    conflicted: changes.conflicted.slice(0, 8)
                },
                ignored: paths.ignored.slice(0, 800),
                ignoredCount: counts.ignored
            };
        });
        applyState({ repoOverviews: nextRepoOverviews }, { silent: true });
    };

    const loadManualConflicts = async (repoPaths) => {
        const paths = Array.isArray(repoPaths) ? repoPaths.filter(Boolean) : [];
        if (!paths.length) {
            applyState({ manualConflicts: [] });
            return;
        }
        const collected = [];
        for (const repoPath of paths) {
            try {
                const text = await service.gitStatus(repoPath);
                const payload = parseJsonToolResult(text) || {};
                const normalized = normalizeGitStatusPayload(payload);
                for (const filePath of normalized.paths.conflicted) {
                    if (!filePath) continue;
                    collected.push({ repoPath, filePath });
                }
            } catch {
                continue;
            }
        }
        applyState({ manualConflicts: collected }, { silent: true });
    };

    return {
        updateRepoOverviewFromStatus,
        loadManualConflicts
    };
}
