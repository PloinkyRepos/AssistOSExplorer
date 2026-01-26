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
    normalizeGitStatusPayload
} from "./git-commit-modal-utils.js";
import { withGlobalLoader } from "../../../utils/globalLoader.js";

export function createGitOpsActions(ctx) {
    const {
        getState,
        applyState,
        service,
        setStatusLine,
        updateCommitButtons,
        syncStaticUI,
        closeActionsMenu,
        getSelectedReposForBatch,
        getPathsForCommitInRepo,
        setCommitMessage,
        clearCommitMessageInput,
        clearDiffCache,
        loadRepoOverviews,
        refreshAll,
        showGitAuthPrompt,
        ensureGitIdentityOrPrompt,
        isAutoresolveEnabled,
        pullWithAutoStash,
        handlePullConflicts,
        clearPullBlockedState,
        hasConflictsForRepos,
        collectConflictedItems,
        updateRepoOverviewFromStatus,
        getAheadCountForRepo,
        dispatchAutocommitStop,
        dispatchAutocommitReset,
        generateCommitMessageForSelections
    } = ctx;

    const dispatchFileTreeRefresh = () => {
        window.dispatchEvent(new CustomEvent('webskel-file-exp-refresh'));
    };

    const gitPushWithToken = async (repoPath, token) => {
        const payload = { path: repoPath };
        const cleanToken = String(token || '').trim();
        if (cleanToken) payload.token = cleanToken;
        await service.gitPush(payload);
    };

    const applyGitIdentityForRepo = async (repoPath) => {
        const remembered = getRememberedGitIdentity();
        const state = getState();
        const name = String(remembered.name || state.identityPrompt?.name || '').trim();
        const email = String(remembered.email || state.identityPrompt?.email || '').trim();
        if (!name || !email) {
            return false;
        }
        try {
            await service.gitSetIdentity({ path: repoPath, name, email });
            return true;
        } catch {
            return false;
        }
    };

    const gitPullWithToken = async (repoPath, token) => {
        const payload = { path: repoPath, rebase: false, ffOnly: false };
        const cleanToken = String(token || '').trim();
        if (cleanToken) payload.token = cleanToken;
        await service.gitPull(payload);
    };

    const pushRepos = async (repoPaths, { token = null } = {}) => {
        const state = getState();
        const list = Array.isArray(repoPaths) ? repoPaths.filter(Boolean) : [];
        if (!list.length) {
            setStatusLine('Select at least one repository to push.', true);
            return false;
        }
        const effectiveToken = String(token || '').trim()
            || String(state.authPrompt?.token || '').trim()
            || getRememberedGitPat();
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
                const human = humanizeGitError(msg, { action: 'push' });
                if (isGitAuthError(msg)) {
                    if (!effectiveToken) {
                        showGitAuthPrompt(repoPath, { type: 'push', mode: 'batch', repoPaths: list }, { message: human });
                        return false;
                    }
                    setStatusLine(`${human} (A token is already saved. Use “Token” to update it.)`, true);
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
        applyState({
            pullBlocked: null,
            conflictSource: state.pullMode === 'rebase' ? 'rebase' : 'merge'
        });
        const list = Array.isArray(repoPaths) ? repoPaths.filter(Boolean) : [];
        const effectiveToken = String(token || '').trim()
            || String(state.authPrompt?.token || '').trim()
            || getRememberedGitPat();
        const conflictSource = state.pullMode === 'rebase' ? 'rebase' : 'merge';
        for (const repoPath of list) {
            if (state.pullMode !== 'ffOnly') {
                const identityOk = await applyGitIdentityForRepo(repoPath);
                if (!identityOk) {
                    setStatusLine('Set name, email, and token in Git settings to continue.', true);
                    await ensureGitIdentityOrPrompt(repoPath, { type: 'pull', mode: 'batch', repoPaths: list });
                    return false;
                }
            }
            try {
                const statusPayload = parseJsonToolResult(await service.gitStatus(repoPath)) || {};
                const normalized = normalizeGitStatusPayload(statusPayload);
                if (normalized.counts.conflicted > 0) {
                    const resolved = await handlePullConflicts('Resolve merge conflicts before pulling.', [repoPath], conflictSource);
                    if (!resolved) return false;
                }
                const hasLocalChanges = (normalized.counts.staged
                    + normalized.counts.unstaged
                    + normalized.counts.untracked) > 0;
                if (hasLocalChanges) {
                    const autoOk = await pullWithAutoStash(repoPath, effectiveToken, list);
                    if (!autoOk) return false;
                    continue;
                }
                await gitPullWithToken(repoPath, effectiveToken);
            } catch (error) {
                const msg = humanizeGitError(normalizeErrorMessage(error), { action: 'pull' });
                if (isGitIdentityError(msg)) {
                    setStatusLine('Set name, email, and token in Git settings to continue.', true);
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
                    const resolved = await handlePullConflicts('Merge conflicts detected. Resolve them before continuing.', [repoPath], conflictSource);
                    if (resolved) continue;
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
            await handlePullConflicts('Merge conflicts detected. Resolve them before continuing.', selected, 'merge');
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
                    await handlePullConflicts('Merge conflicts detected. Resolve them before continuing.', selected, 'merge');
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
                applyState({ selectedFilesByRepo: {}, commitMessage: '' }, { silent: true });
                clearCommitMessageInput();
                clearDiffCache();
                await loadRepoOverviews({ force: true });
                await refreshAll({ force: true });
                dispatchFileTreeRefresh();
                setStatusLine('Done.');
            } catch (error) {
                setStatusLine(normalizeErrorMessage(error), true);
            }
        });
    };

    const syncSelectedRepos = async () => {
        const state = getState();
        const selected = getSelectedReposForBatch();
        if (!selected.length) {
            setStatusLine('Select at least one repository to sync.', true);
            return;
        }
        clearPullBlockedState();
        setStatusLine(`Syncing ${selected.length} repo(s)…`);
        return withGlobalLoader(async () => {
            try {
                const pullOk = await pullRepos(selected);
                if (!pullOk) return;
                const stagedSelections = [];
                for (const repoPath of selected) {
                    const statusPayload = parseJsonToolResult(await service.gitStatus(repoPath)) || {};
                    const normalized = normalizeGitStatusPayload(statusPayload);
                    updateRepoOverviewFromStatus(repoPath, statusPayload);
                    const stagedPaths = normalized.paths.staged
                        .concat(
                            normalized.paths.unstaged,
                            normalized.paths.untracked
                        );
                    if (stagedPaths.length) {
                        await service.gitStage(repoPath, stagedPaths);
                        stagedSelections.push({ repoPath, files: stagedPaths });
                    }
                }

                if (!stagedSelections.length) {
                    const pushedAny = await pushRepos(selected);
                    if (!pushedAny) {
                        dispatchAutocommitReset();
                        return;
                    }
                    setStatusLine('Pushed.');
                    return;
                }

                const message = await generateCommitMessageForSelections(stagedSelections);
                if (!message) {
                    setStatusLine('AI returned an empty commit message.', true);
                    dispatchAutocommitStop();
                    return;
                }
                setCommitMessage(message);
                updateCommitButtons();

                for (const selection of stagedSelections) {
                    const repoPath = selection.repoPath;
                    const identityOk = await ensureGitIdentityOrPrompt(repoPath, { type: 'sync', mode: 'batch', repoPaths: selected });
                    if (!identityOk) {
                        dispatchAutocommitStop();
                        return;
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
                            await ensureGitIdentityOrPrompt(repoPath, { type: 'sync', mode: 'batch', repoPaths: selected });
                            dispatchAutocommitStop();
                            return;
                        }
                        throw error;
                    }
                }

                const token = getRememberedGitPat();
                for (const repoPath of selected) {
                    try {
                        await gitPushWithToken(repoPath, token);
                    } catch (error) {
                        const msg = normalizeErrorMessage(error);
                        const human = humanizeGitError(msg, { action: 'push' });
                        if (isGitAuthError(msg)) {
                            if (!token) {
                                showGitAuthPrompt(repoPath, { type: 'push', mode: 'batch', repoPaths: selected }, { message: human });
                                dispatchAutocommitStop();
                                return;
                            }
                            setStatusLine(`${human} (A token is already saved. Use “Token” to update it.)`, true);
                            dispatchAutocommitStop();
                            return;
                        }
                        throw error;
                    }
                }

                applyState({ selectedFilesByRepo: {}, commitMessage: '' }, { silent: true });
                clearCommitMessageInput();
                clearDiffCache();
                await loadRepoOverviews({ force: true });
                await refreshAll({ force: true });
                dispatchFileTreeRefresh();
                setStatusLine('Sync complete.');
                dispatchAutocommitReset();
            } catch (error) {
                setStatusLine(humanizeGitError(normalizeErrorMessage(error), { action: 'push' }), true);
                dispatchAutocommitStop();
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
        setStatusLine('Pushing...');
        return withGlobalLoader(async () => {
            try {
                const pushedAny = await pushRepos([state.repoPath], { token });
                if (!pushedAny) return;
                if (!silent) {
                    setStatusLine('Push complete.');
                }
            } catch (error) {
                setStatusLine(humanizeGitError(normalizeErrorMessage(error), { action: 'push' }), true);
            }
        });
    };

    const pushSelectedRepos = async (repoPaths) => {
        const list = Array.isArray(repoPaths) ? repoPaths.filter(Boolean) : [];
        if (!list.length) {
            setStatusLine('Select at least one repository to push.', true);
            return;
        }
        const identityOk = await ensureGitIdentityOrPrompt(list[0], { type: 'push', mode: 'batch', repoPaths: list });
        if (!identityOk) {
            return;
        }
        setStatusLine(`Pushing ${list.length} repo(s)…`);
        return withGlobalLoader(async () => {
            try {
                const pushedAny = await pushRepos(list);
                if (!pushedAny) return;
                setStatusLine('Pushed.');
            } catch (error) {
                setStatusLine(humanizeGitError(normalizeErrorMessage(error), { action: 'push' }), true);
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
        applyState({ conflictSource: mode === 'rebase' ? 'rebase' : 'merge' }, { silent: true });
        if (mode !== 'ffOnly') {
            for (const repoPath of selected) {
                const ok = await ensureGitIdentityOrPrompt(repoPath, { type: 'pull', mode: 'batch', repoPaths: selected });
                if (!ok) return;
            }
        }
        setStatusLine(`Pulling ${selected.length} repo(s)…`);
        return withGlobalLoader(async () => {
            try {
                const ok = await pullRepos(selected);
                if (!ok) return;
                clearDiffCache();
                await loadRepoOverviews({ force: true });
                await refreshAll({ force: true });
                dispatchFileTreeRefresh();
                setStatusLine('Pull complete.');
            } catch (error) {
                setStatusLine(normalizeErrorMessage(error), true);
            }
        });
    };

    const setPullMode = (element, mode) => {
        const state = getState();
        const next = (mode || element?.dataset?.mode || '').trim();
        if (next !== 'ffOnly' && next !== 'rebase' && next !== 'merge') return;
        applyState({ pullMode: next });
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
            applyState({ commitMode: next }, { silent: true });
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
        if (next === 'sync') {
            closeActionsMenu();
            if (state.identityPrompt?.visible || state.authPrompt?.visible) return;
            syncSelectedRepos();
            return;
        }
        if (next === 'stash') {
            closeActionsMenu();
            if (state.identityPrompt?.visible || state.authPrompt?.visible) return;
            ctx.stashSelectedRepos();
            return;
        }
        if (next === 'unstash') {
            closeActionsMenu();
            if (state.identityPrompt?.visible || state.authPrompt?.visible) return;
            ctx.unstashSelectedRepos();
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
        gitPushWithToken,
        gitPullWithToken,
        pushRepos,
        pullRepos,
        commitSelectedRepos,
        syncSelectedRepos,
        commit,
        push,
        pushSelectedRepos,
        pullSelectedRepos,
        runGitAction
    };
}
