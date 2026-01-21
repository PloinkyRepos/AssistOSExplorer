import {
    normalizeErrorMessage,
    humanizeGitError,
    parseJsonToolResult,
    isReposRootPath,
    isGitAuthError,
    isGitIdentityError,
    isGitConflictError,
    isGitPullBlockedError,
    extractGitPullBlockedFiles,
    getRememberedGitPat,
    getRememberedGitIdentity,
    setRememberedGitPat,
    setRememberedGitIdentity,
    setAutocommitSettings,
    setCredentialsValidated
} from "./git-commit-modal-utils.js";
import { withGlobalLoader } from "../../../utils/globalLoader.js";

export function createGitCommitActions(ctx) {
    const {
        getState,
        service,
        setStatusLine,
        updateCommitButtons,
        syncStaticUI,
        updateIdentityPrompt,
        updateAuthPrompt,
        updateIgnorePrompt,
        closeActionsMenu,
        getSelectedReposForBatch,
        getPathsForCommitInRepo,
        setCommitMessage,
        clearCommitMessageInput,
        clearDiffCache,
        loadRepoInfo,
        loadRepoOverviews,
        refreshAll
    } = ctx;

    const coerceCount = (value) => {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) return null;
            const parsed = Number(trimmed);
            if (Number.isFinite(parsed)) return parsed;
        }
        return null;
    };

    const extractAheadCount = (payload) => {
        if (!payload || typeof payload !== 'object') return null;
        const candidates = [
            payload.ahead,
            payload.aheadCount,
            payload.ahead_by,
            payload.aheadBy,
            payload.status?.ahead,
            payload.status?.aheadCount,
            payload.status?.ahead_by,
            payload.status?.aheadBy,
            payload.branch?.ahead,
            payload.branch?.aheadCount,
            payload.tracking?.ahead,
            payload.tracking?.aheadCount,
            payload.tracking?.ahead_by,
            payload.tracking?.aheadBy
        ];
        for (const candidate of candidates) {
            const value = coerceCount(candidate);
            if (value !== null) return value;
        }
        return null;
    };

    const getAheadCountForRepo = async (repoPath) => {
        if (!repoPath) return null;
        let info = null;
        try {
            const state = getState();
            if (loadRepoInfo && repoPath === state.repoPath) {
                info = await loadRepoInfo({ force: true });
            } else {
                const text = await service.gitInfo(repoPath);
                info = parseJsonToolResult(text) || {};
            }
        } catch (_) {
            info = null;
        }
        const fromInfo = extractAheadCount(info);
        if (fromInfo !== null) return fromInfo;
        try {
            const statusText = await service.gitStatus(repoPath);
            const statusPayload = parseJsonToolResult(statusText) || {};
            return extractAheadCount(statusPayload);
        } catch (_) {
            return null;
        }
    };

    const collectConflictedItems = (repoPaths) => {
        const targets = Array.isArray(repoPaths) && repoPaths.length ? new Set(repoPaths) : null;
        const repos = Array.isArray(getState().repoOverviews) ? getState().repoOverviews : [];
        const out = [];
        for (const repo of repos) {
            if (!repo?.path) continue;
            if (targets && !targets.has(repo.path)) continue;
            const conflicted = Array.isArray(repo?.changes?.conflicted) ? repo.changes.conflicted : [];
            for (const filePath of conflicted) {
                if (!filePath) continue;
                out.push({ repoPath: repo.path, filePath });
            }
        }
        return out;
    };

    const hasConflictsForRepos = (repoPaths) => collectConflictedItems(repoPaths).length > 0;

    const clearPullBlockedState = () => {
        const state = getState();
        if (!state.pullBlocked) return;
        state.pullBlocked = null;
        syncStaticUI();
    };

    const loadManualConflicts = async (repoPaths) => {
        const state = getState();
        const paths = Array.isArray(repoPaths) ? repoPaths.filter(Boolean) : [];
        if (!paths.length) {
            state.manualConflicts = [];
            return;
        }
        const collected = [];
        for (const repoPath of paths) {
            try {
                const text = await service.gitStatus(repoPath);
                const payload = parseJsonToolResult(text) || {};
                const status = payload?.status || payload || {};
            const conflicted = Array.isArray(status.conflicted) ? status.conflicted : [];
            for (const entry of conflicted) {
                const filePath = typeof entry === 'string'
                    ? entry
                    : (entry?.path || entry?.filePath || '');
                if (!filePath) continue;
                collected.push({ repoPath, filePath });
            }
            } catch {
                continue;
            }
        }
        state.manualConflicts = collected;
    };

    const handlePullConflicts = async (message, repoPaths = null, source = 'merge') => {
        await loadManualConflicts(repoPaths);
        const state = getState();
        state.conflictSource = source;
        state.conflictFocus = false;
        await loadRepoOverviews({ force: true });
        syncStaticUI();
        updateCommitButtons();
        setStatusLine(message || 'Merge conflicts detected. Resolve them before continuing.', true);
    };

    const restoreStash = async (repoPath, stashRef) => {
        try {
            const request = { path: repoPath, reinstateIndex: true };
            if (stashRef) request.ref = stashRef;
            const text = await service.gitStashPop(request);
            const payload = parseJsonToolResult(text) || {};
            if (payload.noStash) {
                setStatusLine('No stash entries found to restore.', true);
                return { ok: false, conflicts: false };
            }
            if (payload.conflicts) {
                await handlePullConflicts('Conflicts after restoring stashed changes. Resolve them before continuing.', [repoPath], 'stash');
                return { ok: false, conflicts: true };
            }
            if (payload.ok === false) {
                setStatusLine(payload.output || 'Failed to restore stash.', true);
                return { ok: false, conflicts: false };
            }
            return { ok: true, conflicts: false };
        } catch (error) {
            setStatusLine(normalizeErrorMessage(error), true);
            return { ok: false, conflicts: false };
        }
    };

    const encodeBase64 = (value) => {
        const raw = String(value ?? '');
        try {
            return btoa(unescape(encodeURIComponent(raw)));
        } catch {
            try {
                return btoa(raw);
            } catch {
                return '';
            }
        }
    };

    const getRepoLabel = (repoPath) => {
        if (!repoPath) return '';
        const state = getState();
        const repo = Array.isArray(state.repoOverviews)
            ? state.repoOverviews.find((entry) => entry?.path === repoPath)
            : null;
        return repo?.name || repoPath.split('/').filter(Boolean).slice(-1)[0] || repoPath;
    };

    const selectStashRef = async (repoPath) => {
        try {
            const text = await service.gitStashList({ path: repoPath });
            const payload = parseJsonToolResult(text) || {};
            const entries = Array.isArray(payload.entries) ? payload.entries : [];
            if (!entries.length) {
                setStatusLine('No stash entries found to restore.', true);
                return { ok: false, canceled: false };
            }
            if (entries.length === 1) {
                return { ok: true, ref: entries[0]?.ref || null };
            }
            const repoLabel = getRepoLabel(repoPath);
            const stashes = encodeBase64(JSON.stringify(entries));
            const selection = await assistOS.UI.showModal("git-stash-select-modal", {
                repoPath,
                repoLabel,
                stashes
            }, true);
            const ref = selection?.ref || null;
            if (!ref) {
                return { ok: false, canceled: true };
            }
            return { ok: true, ref };
        } catch (error) {
            setStatusLine(normalizeErrorMessage(error), true);
            return { ok: false, canceled: false };
        }
    };

    const pullWithAutoStash = async (repoPath, token, repoPaths) => {
        const state = getState();
        setStatusLine('Local changes detected. Stashing before pull...');
        let stashPayload = null;
        try {
            const text = await service.gitStash({
                path: repoPath,
                includeUntracked: true,
                message: 'webskel:auto-pull'
            });
            stashPayload = parseJsonToolResult(text) || {};
        } catch (error) {
            setStatusLine(normalizeErrorMessage(error), true);
            return false;
        }

        const stashCreated = Boolean(stashPayload.created);
        const stashRef = stashPayload.ref || null;

        try {
            await gitPullWithToken(repoPath, token);
        } catch (error) {
            const msg = humanizeGitError(normalizeErrorMessage(error), { action: 'pull' });
            if (isGitIdentityError(msg)) {
                if (stashCreated) {
                    await restoreStash(repoPath, stashRef);
                }
                await ensureGitIdentityOrPrompt(repoPath, { type: 'pull', mode: 'batch', repoPaths });
                return false;
            }
            if (isGitAuthError(msg)) {
                if (stashCreated) {
                    await restoreStash(repoPath, stashRef);
                }
                if (!token) {
                    showGitAuthPrompt(repoPath, { type: 'pull', mode: 'batch', repoPaths }, { message: msg });
                    return false;
                }
                setStatusLine(`${msg} (A token is already saved. Use "Token" to update it.)`, true);
                return false;
            }
            if (isGitConflictError(msg)) {
                if (stashCreated) {
                    state.autoStash = { repoPath, ref: stashRef };
                }
                await handlePullConflicts('Pull completed with conflicts. Resolve them, then restore your stashed changes.', [repoPath], 'merge');
                return false;
            }
            if (isGitPullBlockedError(msg)) {
                if (stashCreated) {
                    await restoreStash(repoPath, stashRef);
                }
                const blockedFiles = extractGitPullBlockedFiles(msg);
                state.pullBlocked = blockedFiles.length ? { repoPath, files: blockedFiles } : null;
                syncStaticUI();
                updateCommitButtons();
                setStatusLine('Pull blocked: could not auto-stash your local changes.', true);
                return false;
            }
            if (stashCreated) {
                await restoreStash(repoPath, stashRef);
            }
            throw error;
        }

        if (stashCreated) {
            setStatusLine('Restoring stashed changes...');
            const restored = await restoreStash(repoPath, stashRef);
            if (!restored.ok) return false;
        }

        return true;
    };

    const maybeRestoreAutoStash = async () => {
        const state = getState();
        const pending = state.autoStash;
        if (!pending?.repoPath) return false;
        if (hasConflictsForRepos([pending.repoPath])) return false;
        state.autoStash = null;
        setStatusLine('Restoring stashed changes...');
        const restored = await restoreStash(pending.repoPath, pending.ref);
        if (restored.ok) {
            await loadRepoOverviews({ force: true });
            syncStaticUI();
            updateCommitButtons();
            setStatusLine('Restored stashed changes.');
        }
        return restored.ok;
    };

    const stashRepos = async (repoPaths) => {
        const list = Array.isArray(repoPaths) ? repoPaths.filter(Boolean) : [];
        if (!list.length) return { ok: false, created: 0, skipped: 0, total: 0 };
        let created = 0;
        let skipped = 0;
        for (const repoPath of list) {
            const text = await service.gitStash({
                path: repoPath,
                includeUntracked: true,
                message: 'webskel:manual-stash'
            });
            const payload = parseJsonToolResult(text) || {};
            if (payload.created) {
                created += 1;
            } else {
                skipped += 1;
            }
        }
        return { ok: true, created, skipped, total: list.length };
    };

    const stashSelectedRepos = async () => {
        const state = getState();
        const selected = getSelectedReposForBatch();
        const targets = selected.length
            ? selected
            : (state.repoPath && !isReposRootPath(state.repoPath, state.reposRoot)) ? [state.repoPath] : [];
        if (!targets.length) {
            setStatusLine('Select a repository or file to stash.', true);
            return;
        }
        state.autoStash = null;
        setStatusLine(`Stashing ${targets.length} repo(s)...`);
        return withGlobalLoader(async () => {
            try {
                const result = await stashRepos(targets);
                if (!result.ok) return;
                await loadRepoOverviews({ force: true });
                await refreshAll({ force: true });
                updateCommitButtons();
                if (result.created === 0) {
                    setStatusLine('Nothing to stash.');
                    return;
                }
                if (result.created === result.total) {
                    setStatusLine(`Stashed ${result.created} repo(s).`);
                    return;
                }
                setStatusLine(`Stashed ${result.created} repo(s). ${result.skipped} repo(s) had no changes.`);
            } catch (error) {
                setStatusLine(normalizeErrorMessage(error), true);
            }
        });
    };

    const unstashSelectedRepos = async () => {
        const state = getState();
        const selected = getSelectedReposForBatch();
        const targets = selected.length
            ? selected
            : (state.repoPath && !isReposRootPath(state.repoPath, state.reposRoot)) ? [state.repoPath] : [];
        if (!targets.length) {
            setStatusLine('Select a repository or file to unstash.', true);
            return;
        }
        state.autoStash = null;
        setStatusLine(`Unstashing ${targets.length} repo(s)...`);
        return withGlobalLoader(async () => {
            try {
                for (const repoPath of targets) {
                    const selection = await selectStashRef(repoPath);
                    if (!selection.ok) {
                        if (selection.canceled) {
                            setStatusLine('Unstash canceled.');
                        }
                        return;
                    }
                    const restored = await restoreStash(repoPath, selection.ref);
                    if (!restored.ok) return;
                    if (restored.conflicts) return;
                }
                await loadRepoOverviews({ force: true });
                await refreshAll({ force: true });
                updateCommitButtons();
                setStatusLine('Unstash complete.');
            } catch (error) {
                setStatusLine(normalizeErrorMessage(error), true);
            }
        });
    };

    const selectConflictFile = async ({ repoPath, filePath } = {}) => {
        if (!repoPath || !filePath) return;
        const state = getState();
        const selection = { repoPath, filePath };
        const requestKey = `${repoPath}::${filePath}`;
        state.conflictHelper = {
            ...(state.conflictHelper || {}),
            selected: selection,
            ours: '',
            theirs: '',
            choice: '',
            status: 'Loading conflict versions...',
            loading: true,
            requestKey
        };
        syncStaticUI();

        try {
            const text = await service.gitConflictVersions({ path: repoPath, file: filePath });
            const payload = parseJsonToolResult(text) || {};
            let ours = payload.ours ?? '';
            let theirs = payload.theirs ?? '';
            let oursError = payload.oursError || '';
            let theirsError = payload.theirsError || '';
            // Keep Git's native meaning: ours=stage 2 (local), theirs=stage 3 (remote),
            // regardless of merge/rebase context.
            let status = '';
            if (oursError || theirsError) {
                const parts = [];
                if (oursError) parts.push(`Local unavailable: ${oursError}`);
                if (theirsError) parts.push(`Remote unavailable: ${theirsError}`);
                status = parts.join(' · ');
            } else {
                status = 'Compare versions or resolve in your editor.';
            }

            const current = getState().conflictHelper || {};
            if (current.requestKey !== requestKey) return;
            state.conflictHelper = {
                ...current,
                selected: selection,
                ours: String(ours || ''),
                theirs: String(theirs || ''),
                choice: '',
                status,
                loading: false,
                requestKey: null
            };
        } catch (error) {
            const current = getState().conflictHelper || {};
            if (current.requestKey !== requestKey) return;
            state.conflictHelper = {
                ...current,
                selected: selection,
                loading: false,
                status: normalizeErrorMessage(error)
            };
        }
        syncStaticUI();
    };

    const normalizeConflictSource = (value) => {
        const raw = String(value || '').trim().toLowerCase();
        if (!raw) return '';
        if (raw === 'ours' || raw === 'theirs') return raw;
        if (raw.endsWith('/ours')) return 'ours';
        if (raw.endsWith('/theirs')) return 'theirs';
        const match = raw.match(/(ours|theirs)$/);
        return match ? match[1] : '';
    };

    const toPaths = (items) => (Array.isArray(items) ? items : [])
        .map((entry) => (entry && typeof entry === 'object') ? entry.path : entry)
        .map((value) => String(value || '').trim())
        .filter(Boolean);

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
        const status = statusPayload?.status || statusPayload || {};
        const staged = Array.isArray(status.staged) ? status.staged : [];
        const unstaged = Array.isArray(status.unstaged) ? status.unstaged : [];
        const untracked = Array.isArray(status.untracked) ? status.untracked : [];
        const conflicted = Array.isArray(status.conflicted) ? status.conflicted : [];
        const ignored = Array.isArray(status.ignored) ? status.ignored : [];
        const counts = {
            staged: staged.length,
            unstaged: unstaged.length,
            untracked: untracked.length,
            conflicted: conflicted.length
        };
        const changes = {
            staged: toPaths(staged),
            unstaged: toPaths(unstaged),
            untracked: toPaths(untracked),
            conflicted: toPaths(conflicted)
        };
        const dirty = counts.staged + counts.unstaged + counts.untracked + counts.conflicted > 0;
        const repoList = Array.isArray(state.repoOverviews) ? state.repoOverviews : [];
        state.repoOverviews = repoList.map((repo) => {
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
                ignored: toPaths(ignored).slice(0, 800),
                ignoredCount: ignored.length
            };
        });
    };

    const applyConflictChoice = async ({ repoPath, filePath, source } = {}) => {
        if (!repoPath || !filePath) return;
        const side = normalizeConflictSource(source);
        if (side !== 'ours' && side !== 'theirs') {
            setStatusLine('Pick local or remote to continue.', true);
            return;
        }
        const state = getState();
        state.conflictHelper = {
            ...(state.conflictHelper || {}),
            selected: { repoPath, filePath },
            choice: side,
            status: `Selected ${side === 'ours' ? 'local' : 'remote'} version. Click Save to apply.`,
            loading: false
        };
        syncStaticUI();
    };

    const saveConflictResolution = async ({ repoPath, filePath, choice } = {}) => {
        if (!repoPath || !filePath) return;
        const side = normalizeConflictSource(choice || getState().conflictHelper?.choice);
        if (side !== 'ours' && side !== 'theirs') {
            setStatusLine('Pick local or remote to continue.', true);
            return;
        }
        const state = getState();
        state.conflictHelper = {
            ...(state.conflictHelper || {}),
            selected: { repoPath, filePath },
            status: 'Saving resolution...',
            loading: true
        };
        syncStaticUI();

        try {
            await service.gitCheckoutConflict({ path: repoPath, file: filePath, source: side });
            await service.gitStage(repoPath, [filePath]);
            const statusPayload = parseJsonToolResult(await service.gitStatus(repoPath)) || {};
            updateRepoOverviewFromStatus(repoPath, statusPayload.status || statusPayload);
            state.conflictHelper = {
                ...(state.conflictHelper || {}),
                choice: '',
                loading: false,
                status: 'Resolved and staged.'
            };
            state.manualConflicts = [];
            const stillConflicted = collectConflictedItems([repoPath]).some((item) => item.filePath === filePath);
            if (stillConflicted) {
                await selectConflictFile({ repoPath, filePath });
            }
            updateCommitButtons();
            syncStaticUI();
            if (!hasConflictsForRepos([repoPath])) {
                setStatusLine('Ready.');
            }
        } catch (error) {
            state.conflictHelper = {
                ...(state.conflictHelper || {}),
                loading: false,
                status: normalizeErrorMessage(error)
            };
            syncStaticUI();
        }
    };

    const refreshConflicts = async () => {
        await refreshAll({ force: true });
        await maybeRestoreAutoStash();
        const state = getState();
        state.manualConflicts = [];
        const selection = getState().conflictHelper?.selected;
        if (selection?.repoPath && selection?.filePath) {
            const stillConflicted = collectConflictedItems([selection.repoPath])
                .some((item) => item.filePath === selection.filePath);
            if (stillConflicted) {
                await selectConflictFile(selection);
            }
        }
    };

    const showGitAuthPrompt = (repoPath, pendingAction, { message = '' } = {}) => {
        const state = getState();
        const remembered = getRememberedGitPat();
        state.authPrompt = {
            visible: true,
            repoPath,
            pendingAction: pendingAction || null,
            token: '',
            remember: Boolean(remembered)
        };
        syncStaticUI();
        updateAuthPrompt({ focus: 'token' });
        updateCommitButtons();
        setStatusLine(
            message || (remembered ? 'A token is already saved. Paste a new token to replace it.' : 'Authentication required to push.'),
            true
        );
    };

    const openGitTokenPrompt = () => {
        const state = getState();
        showGitAuthPrompt(state.repoPath, null, { message: '' });
    };

    const resolveIdentityRepoPath = async () => {
        const state = getState();
        const selectedRepo = state.selectedRepoPath;
        if (selectedRepo && !isReposRootPath(selectedRepo, state.reposRoot)) return selectedRepo;
        if (state.repoPath && !isReposRootPath(state.repoPath, state.reposRoot)) return state.repoPath;
        const selected = getSelectedReposForBatch();
        if (selected.length) return selected[0];
        try {
            const payload = parseJsonToolResult(await service.gitReposOverview(state.reposRoot)) || {};
            const repos = Array.isArray(payload.repos) ? payload.repos : [];
            const first = repos.map((repo) => repo?.path).find(Boolean);
            if (first) return first;
        } catch {
            // ignore
        }
        return '';
    };

    const openGitIdentityPrompt = async () => {
        const state = getState();
        const repoPath = await resolveIdentityRepoPath();
        if (!repoPath) {
            setStatusLine('Select a repository to set identity.', true);
            return;
        }

        const remembered = getRememberedGitIdentity();
        const name = remembered.name || state.identityPrompt?.name || '';
        const email = remembered.email || state.identityPrompt?.email || '';
        state.identityPrompt = {
            visible: true,
            repoPath,
            pendingAction: null,
            name,
            email
        };
        syncStaticUI();
        updateIdentityPrompt({ focus: !name ? 'name' : (!email ? 'email' : 'name') });
        updateCommitButtons();
    };

    const cancelGitToken = () => {
        const state = getState();
        state.authPrompt = { visible: false, repoPath: null, pendingAction: null, token: '', remember: false };
        if (state.credentialsOpen && !state.credentialsGate) {
            state.credentialsOpen = false;
        }
        syncStaticUI();
        updateCommitButtons();
        setStatusLine('Cancelled.', true);
    };

    const cancelGitIdentity = () => {
        const state = getState();
        if (state.credentialsGate) {
            state.identityPrompt = {
                ...state.identityPrompt,
                visible: true
            };
            syncStaticUI();
            updateIdentityPrompt({ focus: state.identityPrompt?.name ? 'email' : 'name' });
            updateCommitButtons();
            setStatusLine('Set name and email to continue.', true);
            return;
        }
        state.identityPrompt = { visible: false, repoPath: null, pendingAction: null, name: '', email: '' };
        if (state.credentialsOpen && !state.credentialsGate) {
            state.credentialsOpen = false;
        }
        syncStaticUI();
        updateCommitButtons();
        setStatusLine('Cancelled.', true);
    };

    const cancelGitCredentials = () => {
        const state = getState();
        if (state.credentialsGate) {
            state.identityPrompt = {
                ...state.identityPrompt,
                visible: true
            };
            syncStaticUI();
            updateIdentityPrompt({ focus: state.identityPrompt?.name ? 'email' : 'name' });
            updateCommitButtons();
            setStatusLine('Set name and email to continue.', true);
            return;
        }
        state.identityPrompt = { visible: false, repoPath: null, pendingAction: null, name: '', email: '' };
        state.authPrompt = { visible: false, repoPath: null, pendingAction: null, token: '', remember: false };
        if (state.credentialsOpen) state.credentialsOpen = false;
        syncStaticUI();
        updateCommitButtons();
        setStatusLine('Cancelled.', true);
    };

    const resolveIgnoreRepoPath = () => {
        const state = getState();
        const selectedRepo = state.selectedRepoPath;
        if (selectedRepo && !isReposRootPath(selectedRepo, state.reposRoot)) return selectedRepo;
        if (state.repoPath && !isReposRootPath(state.repoPath, state.reposRoot)) return state.repoPath;
        const selected = getSelectedReposForBatch();
        if (selected.length === 1) return selected[0];
        return '';
    };

    const getUntrackedPathsForRepo = (repoPath) => {
        const state = getState();
        const repo = (state.repoOverviews || []).find((item) => item?.path === repoPath) || null;
        const rows = Array.isArray(repo?.changesAll) ? repo.changesAll : [];
        if (rows.length && typeof rows[0] === 'string') {
            const untracked = Array.isArray(repo?.changes?.untracked) ? repo.changes.untracked : [];
            return untracked
                .map((row) => String(row || '').trim())
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b));
        }
        return rows
            .filter((row) => {
                if (!row) return false;
                const flags = row.flags || {};
                if (flags.untracked) return true;
                if (row.kind === 'untracked') return true;
                return row.x === '?' && row.y === '?';
            })
            .map((row) => String(row.path || '').trim())
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b));
    };

    const normalizeIgnorePattern = (value) => String(value || '').trim().replace(/^\.\/+/, '');

    const buildIgnorePatterns = (paths, { mode = 'file', anchor = true } = {}) => {
        const out = [];
        const seen = new Set();
        const list = Array.isArray(paths) ? paths : [];
        for (const raw of list) {
            const normalized = normalizeIgnorePattern(raw);
            if (!normalized) continue;
            let pattern = normalized;
            if (mode === 'folder') {
                const parts = normalized.split('/').filter(Boolean);
                if (parts.length > 1) {
                    pattern = `${parts.slice(0, -1).join('/')}/`;
                }
            }
            if (anchor && !pattern.startsWith('/')) {
                pattern = `/${pattern}`;
            }
            if (seen.has(pattern)) continue;
            seen.add(pattern);
            out.push(pattern);
        }
        return out.join('\n');
    };

    const openGitIgnorePrompt = (options = {}) => {
        const repoPath = options.repoPath || resolveIgnoreRepoPath();
        if (!repoPath) {
            const selected = getSelectedReposForBatch();
            const message = selected.length > 1
                ? 'Select files from a single repository to edit .gitignore.'
                : 'Select a repository to edit .gitignore.';
            setStatusLine(message, true);
            return;
        }
        const overridePaths = Array.isArray(options.paths) ? options.paths.filter(Boolean) : [];
        const selectedPaths = overridePaths.length ? overridePaths : getPathsForCommitInRepo(repoPath);
        const fallbackPaths = selectedPaths.length ? selectedPaths : getUntrackedPathsForRepo(repoPath);
        const source = options.source || (selectedPaths.length ? 'selection' : (fallbackPaths.length ? 'untracked' : 'manual'));
        const mode = options.mode || 'file';
        const anchor = options.anchor !== undefined ? Boolean(options.anchor) : true;
        const overridePatterns = typeof options.patterns === 'string' ? options.patterns.trim() : '';
        const patterns = overridePatterns || buildIgnorePatterns(fallbackPaths, { mode, anchor });
        const state = getState();
        state.ignorePrompt = {
            visible: true,
            repoPath,
            mode,
            anchor,
            patterns,
            paths: fallbackPaths,
            source,
            stopTracking: Boolean(options.stopTracking)
        };
        syncStaticUI();
        updateIgnorePrompt({ focus: 'patterns' });
        updateCommitButtons();
        if (!fallbackPaths.length) {
            setStatusLine('No files selected. Add ignore patterns manually.');
        }
    };

    const setIgnoreMode = ({ mode } = {}) => {
        const state = getState();
        const next = String(mode || '').trim();
        if (next !== 'file' && next !== 'folder') return;
        const anchor = state.ignorePrompt?.anchor !== false;
        const paths = Array.isArray(state.ignorePrompt?.paths) ? state.ignorePrompt.paths : [];
        const patterns = paths.length
            ? buildIgnorePatterns(paths, { mode: next, anchor })
            : (state.ignorePrompt?.patterns || '');
        state.ignorePrompt = {
            ...state.ignorePrompt,
            mode: next,
            anchor,
            patterns
        };
        syncStaticUI();
        updateIgnorePrompt();
        updateCommitButtons();
    };

    const setIgnoreAnchor = ({ anchor } = {}) => {
        const state = getState();
        const next = typeof anchor === 'boolean' ? anchor : Boolean(anchor);
        const mode = state.ignorePrompt?.mode || 'file';
        const paths = Array.isArray(state.ignorePrompt?.paths) ? state.ignorePrompt.paths : [];
        const patterns = paths.length
            ? buildIgnorePatterns(paths, { mode, anchor: next })
            : (state.ignorePrompt?.patterns || '');
        state.ignorePrompt = {
            ...state.ignorePrompt,
            anchor: next,
            patterns
        };
        syncStaticUI();
        updateIgnorePrompt();
        updateCommitButtons();
    };

    const cancelGitIgnore = () => {
        const state = getState();
        state.ignorePrompt = {
            visible: false,
            repoPath: null,
            mode: 'file',
            anchor: true,
            patterns: '',
            paths: [],
            source: 'manual',
            stopTracking: false
        };
        syncStaticUI();
        updateCommitButtons();
        setStatusLine('Cancelled.', true);
    };

    const isMissingFileError = (error) => {
        const message = normalizeErrorMessage(error).toLowerCase();
        return message.includes('no such file') || message.includes('enoent') || message.includes('not found');
    };

    const saveGitIgnore = async (payload = {}) => {
        const state = getState();
        const repoPath = state.ignorePrompt?.repoPath;
        if (!repoPath) return;
        const raw = String(payload.patterns ?? state.ignorePrompt?.patterns ?? '').trim();
        if (!raw) {
            setStatusLine('Enter at least one ignore pattern.', true);
            updateIgnorePrompt({ focus: 'patterns' });
            return;
        }
        const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        if (!lines.length) {
            setStatusLine('Enter at least one ignore pattern.', true);
            updateIgnorePrompt({ focus: 'patterns' });
            return;
        }

        const ignorePath = `${String(repoPath).replace(/\/+$/g, '')}/.gitignore`;
        const stopTracking = Boolean(state.ignorePrompt?.stopTracking);
        const ignoredPaths = Array.isArray(state.ignorePrompt?.paths) ? state.ignorePrompt.paths : [];
        return withGlobalLoader(async () => {
            try {
                let existing = '';
                try {
                    existing = await service.readTextFile(ignorePath);
                } catch (error) {
                    if (!isMissingFileError(error)) throw error;
                }
                const existingLines = String(existing || '').split(/\r?\n/);
                const existingSet = new Set(existingLines.map((line) => line.trim()).filter(Boolean));
                const toAdd = lines.filter((line) => !existingSet.has(line));
                if (!toAdd.length && !stopTracking) {
                    state.ignorePrompt = {
                        visible: false,
                        repoPath: null,
                        mode: 'file',
                        anchor: true,
                        patterns: '',
                        paths: [],
                        source: 'manual',
                        stopTracking: false
                    };
                    syncStaticUI();
                    updateCommitButtons();
                    setStatusLine('All patterns are already in .gitignore.');
                    return;
                }

                if (stopTracking && ignoredPaths.length) {
                    await service.gitUntrack(repoPath, ignoredPaths);
                }
                if (toAdd.length) {
                    const needsNewline = existing && !existing.endsWith('\n');
                    const nextContent = `${existing}${needsNewline ? '\n' : ''}${toAdd.join('\n')}\n`;
                    await service.writeFile(ignorePath, nextContent);
                }
                if (!stopTracking && ignoredPaths.length) {
                    const map = state.ignoreHints || {};
                    const current = new Set(Array.isArray(map[repoPath]) ? map[repoPath] : []);
                    for (const path of ignoredPaths) {
                        const normalized = normalizeIgnorePattern(path);
                        if (normalized) current.add(normalized);
                    }
                    map[repoPath] = Array.from(current);
                    state.ignoreHints = map;
                }

                state.ignorePrompt = {
                    visible: false,
                    repoPath: null,
                    mode: 'file',
                    anchor: true,
                    patterns: '',
                    paths: [],
                    source: 'manual',
                    stopTracking: false
                };
                if (state.selectedFilesByRepo && state.selectedFilesByRepo[repoPath]) {
                    const entry = state.selectedFilesByRepo[repoPath];
                    if (entry?.files && entry.files.size && ignoredPaths.length) {
                        const nextFiles = new Set(entry.files);
                        for (const path of ignoredPaths) {
                            nextFiles.delete(path);
                        }
                        const nextEntry = { ...entry, files: nextFiles };
                        if (!nextFiles.size && (!entry.prefixes || entry.prefixes.size === 0)) {
                            const nextSelected = { ...state.selectedFilesByRepo };
                            delete nextSelected[repoPath];
                            state.selectedFilesByRepo = nextSelected;
                        } else {
                            state.selectedFilesByRepo = { ...state.selectedFilesByRepo, [repoPath]: nextEntry };
                        }
                    }
                }
                syncStaticUI();
                updateCommitButtons();
                await loadRepoOverviews({ force: true });
                await refreshAll({ force: true });
                if (stopTracking && toAdd.length) {
                    setStatusLine(`Stopped tracking ${ignoredPaths.length} file(s) and added ${toAdd.length} pattern(s).`);
                } else if (stopTracking) {
                    setStatusLine(`Stopped tracking ${ignoredPaths.length} file(s).`);
                } else {
                    setStatusLine(`Added ${toAdd.length} pattern(s) to .gitignore.`);
                }
            } catch (error) {
                setStatusLine(normalizeErrorMessage(error), true);
            }
        });
    };

    const isDiffFileHeaderLine = (line) => {
        if (!line) return false;
        return (
            line.startsWith('diff --git ') ||
            line.startsWith('index ') ||
            line.startsWith('new file mode ') ||
            line.startsWith('deleted file mode ') ||
            line.startsWith('old mode ') ||
            line.startsWith('new mode ') ||
            line.startsWith('similarity index ') ||
            line.startsWith('rename from ') ||
            line.startsWith('rename to ') ||
            line.startsWith('--- ') ||
            line.startsWith('+++ ') ||
            line.startsWith('Binary files ') ||
            line.startsWith('GIT binary patch')
        );
    };

    const summarizeDiffForAi = (diffText, { maxLines = 120 } = {}) => {
        const lines = String(diffText || '').split(/\r?\n/);
        const out = [];
        let contentCount = 0;
        for (const line of lines) {
            if (line.startsWith('@@')) {
                out.push(line);
                continue;
            }
            if (isDiffFileHeaderLine(line)) continue;
            if (contentCount >= maxLines) continue;
            out.push(line);
            contentCount += 1;
        }
        if (out.length === 0 && lines.length > 0) {
            return lines.slice(0, maxLines).join('\n');
        }
        return out.join('\n');
    };

    const generateCommitMessage = async () => {
        const selectedRepos = getSelectedReposForBatch();
        if (!selectedRepos.length) {
            setStatusLine('Select at least one file to generate a message.', true);
            return;
        }

        setStatusLine('Generating commit message...');
        return withGlobalLoader(async () => {
            try {
                const selections = selectedRepos.map((repoPath) => ({
                    repoPath,
                    files: getPathsForCommitInRepo(repoPath)
                })).filter((entry) => entry.repoPath && Array.isArray(entry.files) && entry.files.length > 0);
                if (!selections.length) {
                    setStatusLine('Select at least one file to generate a message.', true);
                    return;
                }

                const diffs = [];
                const maxFilesPerRepo = 80;
                const maxFilesTotal = 20;

                for (const selection of selections) {
                    const repoPath = selection.repoPath;
                    const files = Array.isArray(selection.files) ? selection.files.slice(0, maxFilesPerRepo) : [];
                    for (const filePath of files) {
                        if (diffs.length >= maxFilesTotal) break;
                        const diff = await service.gitDiff({
                            path: repoPath,
                            file: filePath,
                            cached: false,
                            ref: 'HEAD'
                        });
                        const summary = summarizeDiffForAi(diff, { maxLines: 120 });
                        diffs.push({ repoPath, filePath, diff: summary || '' });
                    }
                    if (diffs.length >= maxFilesTotal) break;
                }

                if (!diffs.length) {
                    setStatusLine('Select at least one file to generate a message.', true);
                    return;
                }

                const payloadText = await service.generateCommitMessage(diffs);
                const payload = parseJsonToolResult(payloadText);
                if (!payload || typeof payload !== 'object') {
                    throw new Error('Failed to generate commit message.');
                }
                if (payload.ok === false) {
                    throw new Error(payload.error || 'Failed to generate commit message.');
                }
                const next = String(payload.message || '').trim();
                if (!next) throw new Error('AI returned an empty commit message.');

                setCommitMessage(next);
                updateCommitButtons();
                setStatusLine('Commit message generated.');
            } catch (error) {
                setStatusLine(normalizeErrorMessage(error), true);
            }
        });
    };

    const saveGitToken = async (payload = {}) => {
        const state = getState();
        const pending = state.authPrompt?.pendingAction;
        const token = String(payload.token ?? state.authPrompt?.token ?? '').trim();
        const remember = typeof payload.remember === 'boolean' ? payload.remember : Boolean(state.authPrompt?.remember);
        state.authPrompt = {
            ...state.authPrompt,
            token,
            remember
        };
        if (!token) {
            state.authPrompt = {
                ...state.authPrompt,
                visible: true,
                token: '',
                remember
            };
            syncStaticUI();
            updateAuthPrompt({ focus: 'token' });
            updateCommitButtons();
            setStatusLine('Enter a token to continue.', true);
            return;
        }
        if (remember) setRememberedGitPat(token);
        else setRememberedGitPat('');

        state.authPrompt = { visible: false, repoPath: null, pendingAction: null, token: '', remember: false };
        syncStaticUI();
        updateCommitButtons();
        setStatusLine(pending?.type === 'pull' ? 'Retrying pull…' : 'Retrying push…');
        try {
            if (pending?.type === 'push') {
                if (pending.mode === 'batch') {
                    const list = Array.isArray(pending.repoPaths) ? pending.repoPaths : [];
                    await pushRepos(list, { token });
                } else {
                    await push({ silent: false, token });
                }
            } else if (pending?.type === 'pull') {
                const list = Array.isArray(pending.repoPaths) ? pending.repoPaths : [];
                await pullRepos(list, { token });
            }
        } catch (error) {
            setStatusLine(normalizeErrorMessage(error), true);
        }
    };

    const saveGitCredentials = async (payload = {}) => {
        const state = getState();
        const name = String(payload.name ?? state.identityPrompt?.name ?? '').trim();
        const email = String(payload.email ?? state.identityPrompt?.email ?? '').trim();
        const token = String(payload.token ?? state.authPrompt?.token ?? '').trim();
        const remember = typeof payload.remember === 'boolean' ? payload.remember : Boolean(state.authPrompt?.remember);
        const validateOnly = Boolean(payload.validateOnly);
        const autocommitIntervalMinutes = payload.autocommitIntervalMinutes;
        const autocommitRepos = Array.isArray(payload.autocommitRepos) ? payload.autocommitRepos : null;

        const identityRequired = Boolean(state.credentialsGate || state.identityPrompt?.visible);
        const authRequired = Boolean(state.authPrompt?.visible);
        const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
        const identityValid = Boolean(name && email && emailPattern.test(email));
        const tokenRequired = remember || authRequired;
        const tokenValid = !tokenRequired || Boolean(token);

        state.identityPrompt = {
            ...state.identityPrompt,
            name,
            email
        };
        state.authPrompt = {
            ...state.authPrompt,
            token,
            remember
        };

        if (!identityValid) {
            state.identityPrompt = {
                ...state.identityPrompt,
                visible: true,
                name,
                email
            };
            syncStaticUI();
            updateIdentityPrompt({ focus: !name ? 'name' : 'email' });
            updateCommitButtons();
            setStatusLine(!name || !email ? 'Enter name and email.' : 'Enter a valid email address.', true);
            return;
        }
        if (tokenRequired && !tokenValid) {
            state.authPrompt = {
                ...state.authPrompt,
                visible: true,
                token: '',
                remember
            };
            syncStaticUI();
            updateAuthPrompt({ focus: 'token' });
            updateCommitButtons();
            setStatusLine('Enter a token to continue.', true);
            return;
        }

        if (!state.credentialsValidated && !state.credentialsDirty && state.autocommitDirty && !validateOnly) {
            setAutocommitSettings({ intervalMinutes: autocommitIntervalMinutes, repos: autocommitRepos });
            try {
                window.dispatchEvent(new CustomEvent('webskel-autocommit-settings-changed'));
            } catch {
                // ignore dispatch errors
            }
            state.autocommitDirty = false;
            state.autocommitDraft = {
                intervalMinutes: autocommitIntervalMinutes,
                repos: autocommitRepos
            };
            syncStaticUI();
            updateCommitButtons();
            setStatusLine('Autocommit settings saved.');
            return;
        }

        if (!state.credentialsValidated) {
            let validationRepoPath = state.identityPrompt?.repoPath || state.authPrompt?.repoPath;
            if (!validationRepoPath) {
                validationRepoPath = await resolveIdentityRepoPath();
            }
            if (!validationRepoPath) {
                validationRepoPath = state.reposRoot || state.repoPath || '';
            }
            if (!validationRepoPath) {
                setStatusLine('Select a repository to validate credentials.', true);
                return;
            }
            if (!token) {
                setStatusLine('Enter a token to validate credentials.', true);
                return;
            }
            setStatusLine('Validating credentials...');
            try {
                await gitPullWithToken(validationRepoPath, token);
            } catch (error) {
                const msg = normalizeErrorMessage(error);
                const lower = msg.toLowerCase();
                if (isGitAuthError(msg) || lower.includes('repository not found')) {
                    setStatusLine('Token validation failed. Check your token and repo access.', true);
                    return;
                }
                if (lower.includes('remote is not https')) {
                    setStatusLine(msg, true);
                    return;
                }
                if (isGitIdentityError(msg)) {
                    setStatusLine('Author identity is not valid for git. Update name/email and retry.', true);
                    return;
                }
                if (!isGitPullBlockedError(msg) && !isGitConflictError(msg)) {
                    setStatusLine(msg || 'Unable to validate credentials.', true);
                    return;
                }
            }
            state.credentialsValidated = true;
            setCredentialsValidated(true);
            syncStaticUI();
            updateCommitButtons();
            setStatusLine('Credentials validated. Select autocommit repositories and save.');
            await refreshAll({ force: true });
            updateIdentityPrompt();
            return;
        }
        if (validateOnly) {
            setStatusLine('Credentials already validated.');
            return;
        }

        let identitySaved = false;
        let tokenSaved = false;
        let repoPath = state.identityPrompt?.repoPath;
        if (identityValid && (identityRequired || identityValid)) {
            if (!repoPath) {
                repoPath = await resolveIdentityRepoPath();
            }
            if (!repoPath) {
                repoPath = state.reposRoot || state.repoPath || '';
            }
            if (!repoPath) {
                setStatusLine('Select a repository to set identity.', true);
                return;
            }
            setRememberedGitIdentity({ name, email });
            identitySaved = true;
        }

        if (tokenValid && (authRequired || tokenValid)) {
            if (remember) setRememberedGitPat(token);
            else setRememberedGitPat('');
            tokenSaved = true;
        }

        setAutocommitSettings({ intervalMinutes: autocommitIntervalMinutes, repos: autocommitRepos });
        try {
            window.dispatchEvent(new CustomEvent('webskel-autocommit-settings-changed'));
        } catch {
            // ignore dispatch errors
        }
        state.autocommitDirty = false;
        state.autocommitDraft = {
            intervalMinutes: autocommitIntervalMinutes,
            repos: autocommitRepos
        };
        state.credentialsDirty = false;

        const pending = state.authPrompt?.pendingAction || state.identityPrompt?.pendingAction;
        const wasGate = state.credentialsGate;

        if (identitySaved) {
            state.identityPrompt = { visible: false, repoPath: null, pendingAction: null, name: '', email: '' };
        }
        if (tokenSaved || authRequired) {
            state.authPrompt = { visible: false, repoPath: null, pendingAction: null, token: '', remember: false };
        }
        if (identitySaved && state.credentialsGate) {
            state.credentialsGate = false;
        }
        if (state.credentialsOpen && !state.credentialsGate) {
            state.credentialsOpen = false;
        }

        syncStaticUI();
        updateCommitButtons();

        if (pending?.type) {
            if (pending.type === 'pull') {
                setStatusLine('Retrying pull…');
            } else if (pending.type === 'push') {
                setStatusLine('Retrying push…');
            } else if (pending.type === 'commit') {
                setStatusLine('Retrying commit…');
            }
            try {
                if (pending.type === 'commit') {
                    await commitSelectedRepos();
                } else if (pending.type === 'push') {
                    if (pending.mode === 'batch') {
                        const list = Array.isArray(pending.repoPaths) ? pending.repoPaths : [];
                        await pushRepos(list, { token });
                    } else {
                        await push({ silent: false, token });
                    }
                } else if (pending.type === 'pull') {
                    if (pending.mode === 'batch') {
                        const list = Array.isArray(pending.repoPaths) ? pending.repoPaths : [];
                        await pullRepos(list, { token });
                    } else {
                        await pullSelectedRepos();
                    }
                }
            } catch (error) {
                setStatusLine(normalizeErrorMessage(error), true);
            }
            return;
        }

        if (identitySaved && tokenSaved) {
            setStatusLine('Credentials saved.');
        } else if (identitySaved) {
            setStatusLine('Identity saved.');
        } else if (tokenSaved) {
            setStatusLine('Token saved.');
        }

        if (wasGate && identitySaved) {
            await refreshAll({ force: true });
        }
    };

    const gitPushWithToken = async (repoPath, token) => {
        const payload = { path: repoPath };
        const cleanToken = String(token || '').trim();
        if (cleanToken) payload.token = cleanToken;
        await service.gitPush(payload);
    };

    const gitPullWithToken = async (repoPath, token) => {
        const state = getState();
        const mode = state.pullMode || 'ffOnly';
        const payload = { path: repoPath };
        if (mode === 'rebase') {
            payload.rebase = true;
            payload.ffOnly = false;
        } else if (mode === 'merge') {
            payload.rebase = false;
            payload.ffOnly = false;
        } else {
            payload.rebase = false;
            payload.ffOnly = true;
        }
        const cleanToken = String(token || '').trim();
        if (cleanToken) payload.token = cleanToken;
        await service.gitPull(payload);
    };

    const pushRepos = async (repoPaths, { token = null } = {}) => {
        const list = Array.isArray(repoPaths) ? repoPaths.filter(Boolean) : [];
        const effectiveToken = String(token || '').trim() || getRememberedGitPat();
        let pushedAny = false;
        for (const repoPath of list) {
            const ahead = await getAheadCountForRepo(repoPath);
            if (ahead === 0) {
                continue;
            }
            try {
                await gitPushWithToken(repoPath, effectiveToken);
                pushedAny = true;
            } catch (error) {
                const msg = normalizeErrorMessage(error);
                if (isGitAuthError(msg)) {
                    if (!effectiveToken) {
                        showGitAuthPrompt(repoPath, { type: 'push', mode: 'batch', repoPaths: list }, { message: msg });
                        return false;
                    }
                    setStatusLine(`${msg} (A token is already saved. Use “Token” to update it.)`, true);
                    return false;
                }
                throw error;
            }
        }
        if (!pushedAny && list.length) {
            setStatusLine('Nothing to push. Selected repositories are up to date.');
            return false;
        }
        return pushedAny;
    };

    const pullRepos = async (repoPaths, { token = null } = {}) => {
        const state = getState();
        state.pullBlocked = null;
        state.conflictSource = state.pullMode === 'rebase' ? 'rebase' : 'merge';
        syncStaticUI();
        const list = Array.isArray(repoPaths) ? repoPaths.filter(Boolean) : [];
        const effectiveToken = String(token || '').trim() || getRememberedGitPat();
        const conflictSource = state.pullMode === 'rebase' ? 'rebase' : 'merge';
        for (const repoPath of list) {
            try {
                await gitPullWithToken(repoPath, effectiveToken);
            } catch (error) {
                const msg = humanizeGitError(normalizeErrorMessage(error), { action: 'pull' });
                if (isGitIdentityError(msg)) {
                    await ensureGitIdentityOrPrompt(repoPath, { type: 'pull', mode: 'batch', repoPaths: list });
                    return false;
                }
                if (isGitAuthError(msg)) {
                    if (!effectiveToken) {
                        showGitAuthPrompt(repoPath, { type: 'pull', mode: 'batch', repoPaths: list }, { message: msg });
                        return false;
                    }
                    setStatusLine(`${msg} (A token is already saved. Use “Token” to update it.)`, true);
                    return false;
                }
                if (isGitConflictError(msg)) {
                    await handlePullConflicts('Merge conflicts detected. Resolve them before continuing.', [repoPath], conflictSource);
                    return false;
                }
                if (isGitPullBlockedError(msg)) {
                    const autoOk = await pullWithAutoStash(repoPath, effectiveToken, list);
                    if (!autoOk) return false;
                    continue;
                }
                throw error;
            }
        }
        return true;
    };

    const ensureGitIdentityOrPrompt = async (repoPath, pendingAction) => {
        if (!repoPath) return false;
        const remembered = getRememberedGitIdentity();
        if (remembered.name && remembered.email) {
            return true;
        }
        const state = getState();
        const name = remembered.name || state.identityPrompt?.name || '';
        const email = remembered.email || state.identityPrompt?.email || '';
        state.identityPrompt = {
            visible: true,
            repoPath,
            pendingAction: pendingAction || null,
            name,
            email
        };
        syncStaticUI();
        updateIdentityPrompt({ focus: !name ? 'name' : (!email ? 'email' : 'name') });
        updateCommitButtons();
        setStatusLine('Set name and email to continue.', true);
        return false;
    };

    const saveGitIdentity = async (payload = {}) => {
        const state = getState();
        const repoPath = state.identityPrompt?.repoPath;
        if (!repoPath) return;
        const name = String(payload.name ?? state.identityPrompt?.name ?? '').trim();
        const email = String(payload.email ?? state.identityPrompt?.email ?? '').trim();
        state.identityPrompt = {
            ...state.identityPrompt,
            name,
            email
        };
        if (!name || !email) {
            state.identityPrompt = {
                ...state.identityPrompt,
                visible: true,
                name,
                email
            };
            syncStaticUI();
            updateIdentityPrompt({ focus: !name ? 'name' : 'email' });
            updateCommitButtons();
            setStatusLine('Enter name and email.', true);
            return;
        }
        setRememberedGitIdentity({ name, email });
        const pending = state.identityPrompt?.pendingAction;
        state.identityPrompt = { visible: false, repoPath: null, pendingAction: null, name: '', email: '' };
        const wasGate = state.credentialsGate;
        state.credentialsGate = false;
        syncStaticUI();
        updateCommitButtons();
        setStatusLine('Identity saved locally. Git config unchanged.');

        if (wasGate && !pending?.type) {
            await refreshAll({ force: true });
        }
        if (pending?.type === 'commit') {
            if (pending.mode === 'batch') await commitSelectedRepos();
            else await commitSelectedRepos();
        } else if (pending?.type === 'push') {
            await push({ silent: false });
        } else if (pending?.type === 'pull') {
            await pullSelectedRepos();
        }
    };

    const commitSelectedRepos = async () => {
        const state = getState();
        const selected = getSelectedReposForBatch();
        const message = (state.commitMessage || '').trim();
        if (!message) {
            setStatusLine('Enter a commit message.', true);
            return;
        }
        if (!selected.length) return;
        clearPullBlockedState();
        const shouldPush = (state.commitMode || 'commit') === 'commitPush';
        if (hasConflictsForRepos(selected)) {
            syncStaticUI();
            updateCommitButtons();
            setStatusLine('Resolve merge conflicts before committing.', true);
            return;
        }
        setStatusLine('Pulling latest changes before commit...');
        return withGlobalLoader(async () => {
            try {
                const pullOk = await pullRepos(selected);
                if (!pullOk) return;
                await loadRepoOverviews({ force: true });
                syncStaticUI();
                updateCommitButtons();
                if (hasConflictsForRepos(selected)) {
                    setStatusLine('Resolve merge conflicts before committing.', true);
                    return;
                }
                setStatusLine(shouldPush ? `Committing & pushing ${selected.length} repo(s)…` : `Committing ${selected.length} repo(s)…`);
                for (const repoPath of selected) {
                    const identityOk = await ensureGitIdentityOrPrompt(repoPath, { type: 'commit', mode: 'batch', repoPaths: selected });
                    if (!identityOk) return;
                    const list = getPathsForCommitInRepo(repoPath);
                    if (!list.length) continue;
                    await service.gitStage(repoPath, list);
                    const after = parseJsonToolResult(await service.gitStatus(repoPath));
                    const afterStatus = after?.status || after || {};
                    if (!(afterStatus.staged || []).length) {
                        continue;
                    }
                    const remembered = getRememberedGitIdentity();
                    const userName = String(remembered.name || state.identityPrompt?.name || '').trim();
                    const userEmail = String(remembered.email || state.identityPrompt?.email || '').trim();
                    try {
                        await service.gitCommit({
                            path: repoPath,
                            message,
                            userName: userName || null,
                            userEmail: userEmail || null
                        });
                    } catch (error) {
                        const msg = normalizeErrorMessage(error);
                        if (isGitIdentityError(msg)) {
                            await ensureGitIdentityOrPrompt(repoPath, { type: 'commit', mode: 'batch', repoPaths: selected });
                            return;
                        }
                        throw error;
                    }
                    if (shouldPush) {
                        const token = getRememberedGitPat();
                        try {
                            await gitPushWithToken(repoPath, token);
                        } catch (error) {
                            const msg = normalizeErrorMessage(error);
                            if (isGitAuthError(msg)) {
                                if (!token) {
                                    showGitAuthPrompt(repoPath, { type: 'push', mode: 'batch', repoPaths: [repoPath] }, { message: msg });
                                    return;
                                }
                                setStatusLine(`${msg} (A token is already saved. Use “Token” to update it.)`, true);
                                return;
                            }
                            throw error;
                        }
                    }
                }
                state.selectedFilesByRepo = {};
                state.commitMessage = '';
                clearCommitMessageInput();
                clearDiffCache();
                await loadRepoOverviews({ force: true });
                await refreshAll({ force: true });
                setStatusLine('Done.');
            } catch (error) {
                setStatusLine(normalizeErrorMessage(error), true);
            }
        });
    };

    const commit = async () => {
        await commitSelectedRepos();
    };

    const push = async ({ silent = false, token = null } = {}) => {
        const state = getState();
        const identityOk = await ensureGitIdentityOrPrompt(state.repoPath, { type: 'push', mode: 'single' });
        if (!identityOk) {
            return;
        }
        return withGlobalLoader(async () => {
            try {
                const ahead = await getAheadCountForRepo(state.repoPath);
                if (ahead === 0) {
                    if (!silent) {
                        setStatusLine('Nothing to push. Branch is up to date with upstream.');
                    }
                    return;
                }
                if (!silent) {
                    setStatusLine('Pushing…');
                }
                const effectiveToken = String(token || '').trim() || getRememberedGitPat();
                await gitPushWithToken(state.repoPath, effectiveToken);
                if (!silent) {
                    setStatusLine('Pushed.');
                }
            } catch (error) {
                const msg = normalizeErrorMessage(error);
                if (isGitAuthError(msg)) {
                    const effectiveToken = String(token || '').trim() || getRememberedGitPat();
                    if (!effectiveToken) {
                        showGitAuthPrompt(state.repoPath, { type: 'push', mode: 'batch', repoPaths: [state.repoPath] }, { message: msg });
                    } else {
                        setStatusLine(`${msg} (A token is already saved. Use “Token” to update it.)`, true);
                    }
                } else {
                    setStatusLine(msg, true);
                }
            }
        });
    };

    const pushSelectedRepos = async (repoPaths) => {
        const list = Array.isArray(repoPaths) ? repoPaths.filter(Boolean) : [];
        if (!list.length) return false;
        for (const repoPath of list) {
            const identityOk = await ensureGitIdentityOrPrompt(repoPath, { type: 'push', mode: 'batch', repoPaths: list });
            if (!identityOk) {
                return false;
            }
        }
        setStatusLine(`Pushing ${list.length} repo(s)…`);
        return withGlobalLoader(async () => {
            try {
                const pushedAny = await pushRepos(list);
                if (pushedAny) {
                    setStatusLine('Pushed.');
                }
                return pushedAny;
            } catch (error) {
                setStatusLine(normalizeErrorMessage(error), true);
                return false;
            }
        });
    };

    const pullSelectedRepos = async (modeOverride = null) => {
        const state = getState();
        const selected = getSelectedReposForBatch();
        if (!selected.length) {
            setStatusLine('Select at least one file/repo to pull.', true);
            return;
        }
        clearPullBlockedState();
        const mode = modeOverride || state.pullMode || 'merge';
        state.conflictSource = mode === 'rebase' ? 'rebase' : 'merge';
        if (mode !== 'ffOnly') {
            for (const repoPath of selected) {
                const ok = await ensureGitIdentityOrPrompt(repoPath, { type: 'pull', mode: 'batch', repoPaths: selected });
                if (!ok) return;
            }
        }
        setStatusLine(`Pulling ${selected.length} repo(s)…`);
        try {
            const ok = await pullRepos(selected);
            if (!ok) return;
            clearDiffCache();
            await loadRepoOverviews({ force: true });
            await refreshAll({ force: true });
            updateCommitButtons();
            if (hasConflictsForRepos(selected)) {
                setStatusLine('Pull completed with conflicts. Resolve them and refresh.', true);
                return;
            }
            setStatusLine('Pulled.');
        } catch (error) {
            setStatusLine(humanizeGitError(normalizeErrorMessage(error), { action: 'pull' }), true);
        }
    };

    const setPullMode = (element, mode) => {
        const state = getState();
        const next = (mode || element?.dataset?.mode || '').trim();
        if (next !== 'ffOnly' && next !== 'rebase' && next !== 'merge') return;
        state.pullMode = next;
        syncStaticUI();
        if (state.identityPrompt?.visible) return;
        if (state.authPrompt?.visible) return;
        pullSelectedRepos();
    };

    const runGitAction = (element, mode) => {
        const state = getState();
        const next = (mode || element?.dataset?.mode || '').trim();
        if (!next) return;
        if (next === 'commit' || next === 'commitPush') {
            const messageOk = Boolean((state.commitMessage || '').trim());
            const selected = getSelectedReposForBatch();
            if (!selected.length) {
                setStatusLine('Select at least one file to commit.', true);
                return;
            }
            if (!messageOk) {
                setStatusLine('Enter a commit message.', true);
                return;
            }
            state.commitMode = next;
            closeActionsMenu();
            updateCommitButtons();
            if (state.identityPrompt?.visible || state.authPrompt?.visible) return;
            commit();
            return;
        }
        if (next === 'push') {
            closeActionsMenu();
            if (state.identityPrompt?.visible || state.authPrompt?.visible) return;
            const selected = getSelectedReposForBatch();
            if (selected.length) {
                pushSelectedRepos(selected);
                return;
            }
            if (!state.repoPath || isReposRootPath(state.repoPath, state.reposRoot) || state.repoInfoOk === false) {
                setStatusLine('Select at least one repository to push.', true);
                return;
            }
            push({ silent: false });
            return;
        }
        if (next === 'pull') {
            closeActionsMenu();
            if (state.identityPrompt?.visible || state.authPrompt?.visible) return;
            pullSelectedRepos('merge');
            return;
        }
        if (next === 'stash') {
            closeActionsMenu();
            if (state.identityPrompt?.visible || state.authPrompt?.visible) return;
            stashSelectedRepos();
            return;
        }
        if (next === 'unstash') {
            closeActionsMenu();
            if (state.identityPrompt?.visible || state.authPrompt?.visible) return;
            unstashSelectedRepos();
            return;
        }
        if (next === 'pullFfOnly' || next === 'pullRebase') {
            const modeMap = {
                pullFfOnly: 'ffOnly',
                pullRebase: 'rebase'
            };
            closeActionsMenu();
            setPullMode(null, modeMap[next]);
        }
    };

    return {
        runGitAction,
        showGitAuthPrompt,
        openGitTokenPrompt,
        openGitIdentityPrompt,
        openGitIgnorePrompt,
        cancelGitToken,
        cancelGitIdentity,
        cancelGitCredentials,
        cancelGitIgnore,
        generateCommitMessage,
        saveGitToken,
        saveGitCredentials,
        saveGitIgnore,
        setIgnoreMode,
        setIgnoreAnchor,
        selectConflictFile,
        applyConflictChoice,
        saveConflictResolution,
        refreshConflicts,
        gitPushWithToken,
        gitPullWithToken,
        pushRepos,
        pullRepos,
        ensureGitIdentityOrPrompt,
        saveGitIdentity,
        commitSelectedRepos,
        commit,
        push,
        pushSelectedRepos,
        pullSelectedRepos,
        stashSelectedRepos,
        unstashSelectedRepos
    };
}
