import {
    normalizeErrorMessage,
    humanizeGitError,
    parseJsonToolResult,
    isReposRootPath,
    isGitAuthError,
    isGitIdentityError,
    getRememberedGitPat,
    setRememberedGitPat
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
        closeActionsMenu,
        closeSettingsMenu,
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
        closeSettingsMenu();
        const state = getState();
        showGitAuthPrompt(state.repoPath, null, { message: '' });
    };

    const openGitIdentityPrompt = () => {
        closeSettingsMenu();
        const state = getState();
        let repoPath = state.selectedRepoPath || state.repoPath;
        if (!repoPath || isReposRootPath(repoPath, state.reposRoot)) {
            const selected = getSelectedReposForBatch();
            repoPath = selected[0] || '';
        }
        if (!repoPath) {
            setStatusLine('Select a repository to set identity.', true);
            return;
        }
        state.identityPrompt = {
            visible: true,
            repoPath,
            pendingAction: null,
            name: state.identityPrompt?.name || '',
            email: state.identityPrompt?.email || ''
        };
        syncStaticUI();
        updateIdentityPrompt({ focus: 'name' });
        updateCommitButtons();
    };

    const cancelGitToken = () => {
        const state = getState();
        state.authPrompt = { visible: false, repoPath: null, pendingAction: null, token: '', remember: false };
        syncStaticUI();
        updateCommitButtons();
        setStatusLine('Cancelled.', true);
    };

    const cancelGitIdentity = () => {
        const state = getState();
        state.identityPrompt = { visible: false, repoPath: null, pendingAction: null, name: '', email: '' };
        syncStaticUI();
        updateCommitButtons();
        setStatusLine('Cancelled.', true);
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
                const payload = parseJsonToolResult(payloadText) || {};
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
        const list = Array.isArray(repoPaths) ? repoPaths.filter(Boolean) : [];
        const effectiveToken = String(token || '').trim() || getRememberedGitPat();
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
                throw error;
            }
        }
        return true;
    };

    const ensureGitIdentityOrPrompt = async (repoPath, pendingAction) => {
        if (!repoPath) return false;
        try {
            const payload = parseJsonToolResult(await service.gitIdentity(repoPath)) || {};
            if (payload.ok) return true;
        } catch (_) {
            // ignore and prompt
        }

        const state = getState();
        state.identityPrompt = {
            visible: true,
            repoPath,
            pendingAction: pendingAction || null,
            name: '',
            email: ''
        };
        syncStaticUI();
        updateIdentityPrompt({ focus: 'name' });
        updateCommitButtons();
        setStatusLine('Set git user.name and user.email to continue.', true);
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

        const nextScope = String(payload.scope || '').trim() || 'local';
        try {
            await service.gitSetIdentity({
                path: repoPath,
                scope: nextScope === 'global' ? 'global' : 'local',
                name,
                email
            });
            const pending = state.identityPrompt?.pendingAction;
            state.identityPrompt = { visible: false, repoPath: null, pendingAction: null, name: '', email: '' };
            syncStaticUI();
            updateCommitButtons();
            setStatusLine('Git identity saved.');

            if (pending?.type === 'commit') {
                if (pending.mode === 'batch') await commitSelectedRepos();
                else await commitSelectedRepos();
            } else if (pending?.type === 'push') {
                await push({ silent: false });
            } else if (pending?.type === 'pull') {
                await pullSelectedRepos();
            }
        } catch (error) {
            setStatusLine(normalizeErrorMessage(error), true);
        }
    };

    const commitSelectedRepos = async () => {
        const state = getState();
        const selected = getSelectedReposForBatch();
        const message = (state.commitMessage || '').trim();
        if (!state.amend && !message) {
            setStatusLine('Enter a commit message.', true);
            return;
        }
        if (!selected.length) return;
        const shouldPush = (state.commitMode || 'commit') === 'commitPush';
        setStatusLine(shouldPush ? `Committing & pushing ${selected.length} repo(s)…` : `Committing ${selected.length} repo(s)…`);
        return withGlobalLoader(async () => {
            try {
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
                    await service.gitCommit({
                        path: repoPath,
                        message,
                        amend: Boolean(state.amend),
                        signoff: Boolean(state.signoff)
                    });
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

    const pullSelectedRepos = async () => {
        const state = getState();
        const selected = getSelectedReposForBatch();
        if (!selected.length) {
            setStatusLine('Select at least one file/repo to pull.', true);
            return;
        }
        const mode = state.pullMode || 'ffOnly';
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
            const messageOk = Boolean((state.commitMessage || '').trim()) || state.amend;
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
            pullSelectedRepos();
            return;
        }
        if (next === 'pullFfOnly' || next === 'pullRebase' || next === 'pullMerge') {
            const modeMap = {
                pullFfOnly: 'ffOnly',
                pullRebase: 'rebase',
                pullMerge: 'merge'
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
        cancelGitToken,
        cancelGitIdentity,
        generateCommitMessage,
        saveGitToken,
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
        pullSelectedRepos
    };
}
