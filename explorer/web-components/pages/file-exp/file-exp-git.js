import {
    parseJsonToolResult,
    getRememberedGitPat,
    getRememberedGitIdentity,
    normalizeErrorMessage,
    humanizeGitError,
    isGitAuthError,
    isGitIdentityError,
    isGitConflictError,
    isGitPullBlockedError,
    getAutocommitSettings,
    getGitConflictFlag,
    setGitConflictFlag
} from "../../modals/git-commit-modal/git-commit-modal-utils.js";
import { callAgentTool } from "../../../services/infrastructure/explorerApi.js";
import { getReposRoot } from "../../../utils/reposRoot.js";

export function attachGitController(fileExp) {
    const reposRoot = getReposRoot();
    const AUTOCOMMIT_MESSAGE = 'chore: autocommit';

    const getConflictFlag = () => getGitConflictFlag();
    const setConflictFlag = (value) => setGitConflictFlag(Boolean(value));
    let pushWarningMessage = '';

    const updateGitButtonIndicator = () => {
        const button = fileExp.element?.querySelector?.('#gitButton');
        if (!button) return;
        if (!button.dataset.defaultTitle) {
            button.dataset.defaultTitle = button.title || 'Commit and push with Git';
        }
        button.classList.toggle('has-conflicts', getConflictFlag());
        button.classList.toggle('has-push-warning', Boolean(pushWarningMessage));
        button.title = pushWarningMessage || button.dataset.defaultTitle;
    };

    const setPushWarning = (message) => {
        pushWarningMessage = message ? String(message) : '';
        updateGitButtonIndicator();
    };

    const refreshOpenGitModals = async () => {
        const modals = Array.from(document.querySelectorAll('git-commit-modal'));
        if (!modals.length) return;
        for (const modal of modals) {
            const presenter = modal?.webSkelPresenter || modal?.presenter || modal;
            if (typeof presenter?.refreshAll === 'function') {
                try {
                    await presenter.refreshAll({ force: true });
                } catch {
                    // ignore refresh failures
                }
            }
        }
    };

    const autocommit = {
        timerId: null,
        running: false,
        scheduledIntervalMinutes: null,
        conflictRefreshPending: false
    };

    const clearAutocommitTimer = () => {
        if (autocommit.timerId) {
            clearInterval(autocommit.timerId);
            autocommit.timerId = null;
        }
        autocommit.running = false;
        autocommit.scheduledIntervalMinutes = null;
    };

    const ensureAutocommitTimer = () => {
        const { enabled, intervalMinutes, repos } = getAutocommitSettings();
        if (enabled === false) {
            clearAutocommitTimer();
            return;
        }
        if (Array.isArray(repos) && repos.length === 0) {
            clearAutocommitTimer();
            return;
        }
        if (getConflictFlag()) {
            clearAutocommitTimer();
            if (!autocommit.conflictRefreshPending) {
                autocommit.conflictRefreshPending = true;
                syncConflictFlagFromRepos()
                    .catch(() => {})
                    .finally(() => {
                        autocommit.conflictRefreshPending = false;
                        ensureAutocommitTimer();
                    });
            }
            clearAutocommitTimer();
            return;
        }
        if (autocommit.timerId && autocommit.scheduledIntervalMinutes === intervalMinutes) {
            return;
        }
        clearAutocommitTimer();
        autocommit.scheduledIntervalMinutes = intervalMinutes;
        autocommit.timerId = setInterval(() => {
            runAutocommitTick();
        }, Math.max(1, intervalMinutes) * 60 * 1000);
    };

    const callGitTool = async (toolName, args, options = {}) => {
        const result = await callAgentTool('gitAgent', toolName, args, { raw: true, ...options });
        const parsed = parseJsonToolResult(result);
        if (parsed !== null && parsed !== undefined) {
            return parsed;
        }
        const text = typeof result?.text === 'string' ? result.text.trim() : '';
        if (text) {
            return parseJsonToolResult(text);
        }
        return null;
    };

    const listRepos = async () => {
        const payload = await callGitTool('git_repos_overview', { path: reposRoot }) || {};
        const repos = Array.isArray(payload?.repos) ? payload.repos : [];
        return repos.map((r) => r?.path).filter(Boolean);
    };

    const getRepoStatus = async (repoPath) => {
        const payload = await callGitTool('git_status', { path: repoPath }) || {};
        return payload?.status || payload || {};
    };

    const repoHasConflicts = (status) => {
        const conflicted = Array.isArray(status?.conflicted) ? status.conflicted : [];
        return conflicted.length > 0;
    };

    const extractChangePaths = (entries) => {
        const list = Array.isArray(entries) ? entries : [];
        return list
            .map((entry) => {
                if (!entry) return '';
                if (typeof entry === 'string') return entry;
                return entry.path || entry.filePath || entry.name || '';
            })
            .map((value) => String(value || '').trim())
            .filter(Boolean);
    };

    const buildStageList = (status) => {
        const unstaged = extractChangePaths(status?.unstaged);
        const untracked = extractChangePaths(status?.untracked);
        return Array.from(new Set([...unstaged, ...untracked]));
    };

    const hasAnyChanges = (status) => {
        const staged = extractChangePaths(status?.staged);
        const unstaged = extractChangePaths(status?.unstaged);
        const untracked = extractChangePaths(status?.untracked);
        return staged.length + unstaged.length + untracked.length > 0;
    };

    const showAutocommitStopped = (message) => {
        clearAutocommitTimer();
        fileExp.showStatus(`Autocommit stopped: ${message}`, true);
    };

    const setConflictAndStop = (message) => {
        setConflictFlag(true);
        updateGitButtonIndicator();
        showAutocommitStopped(message || 'Merge conflicts detected.');
    };

    const pullRepoWithToken = async (repoPath, token) => {
        const payload = { path: repoPath, ffOnly: true, rebase: false };
        const cleanToken = String(token || '').trim();
        if (cleanToken) payload.token = cleanToken;
        await callAgentTool('gitAgent', 'git_pull', payload);
    };

    const restoreStash = async (repoPath, stashRef) => {
        try {
            const text = await callAgentTool('gitAgent', 'git_stash_pop', {
                path: repoPath,
                ref: stashRef || null,
                reinstateIndex: true
            }, { raw: true });
            const payload = parseJsonToolResult(text) || {};
            if (payload.noStash) {
                return { ok: false, conflicts: false, message: 'No stash entries found to restore.' };
            }
            if (payload.conflicts) {
                return { ok: false, conflicts: true, message: 'Conflicts after restoring stashed changes.' };
            }
            if (payload.ok === false) {
                return { ok: false, conflicts: false, message: payload.output || 'Failed to restore stash.' };
            }
            return { ok: true, conflicts: false };
        } catch (error) {
            return { ok: false, conflicts: false, message: normalizeErrorMessage(error) };
        }
    };

    const pullWithAutoStash = async (repoPath, token) => {
        let stashPayload = null;
        try {
            const text = await callAgentTool('gitAgent', 'git_stash', {
                path: repoPath,
                includeUntracked: true,
                message: 'webskel:auto-pull'
            }, { raw: true });
            stashPayload = parseJsonToolResult(text) || {};
        } catch (error) {
            return { ok: false, message: normalizeErrorMessage(error) };
        }

        const stashCreated = Boolean(stashPayload.created);
        const stashRef = stashPayload.ref || null;

        try {
            await pullRepoWithToken(repoPath, token);
        } catch (error) {
            const msg = humanizeGitError(normalizeErrorMessage(error), { action: 'pull' });
            if (stashCreated) {
                await restoreStash(repoPath, stashRef);
            }
            return { ok: false, message: msg };
        }

        if (stashCreated) {
            const restored = await restoreStash(repoPath, stashRef);
            if (!restored.ok) {
                return { ok: false, conflicts: restored.conflicts, message: restored.message || 'Failed to restore stash.' };
            }
        }

        return { ok: true };
    };

    const runAutocommitTick = async () => {
        if (autocommit.running) return;
        const { repos } = getAutocommitSettings();
        if (getConflictFlag()) return;
        if (Array.isArray(repos) && repos.length === 0) return;
        autocommit.running = true;
        try {
            const token = getRememberedGitPat();
            const rememberedIdentity = getRememberedGitIdentity();
            const selectedRepos = Array.isArray(repos) ? repos.filter(Boolean) : [];
            const repoList = selectedRepos.length ? selectedRepos : await listRepos();
            if (!repoList.length) return;
            let committedAny = false;

            for (const repoPath of repoList) {
                if (getConflictFlag()) return;
                const initialStatus = await getRepoStatus(repoPath);
                if (!hasAnyChanges(initialStatus)) {
                    continue;
                }
                try {
                    await pullRepoWithToken(repoPath, token);
                } catch (error) {
                    const msg = humanizeGitError(normalizeErrorMessage(error), { action: 'pull' });
                    if (isGitIdentityError(msg)) {
                        showAutocommitStopped('Set name and email in Git settings to continue.');
                        return;
                    }
                    if (isGitAuthError(msg)) {
                        showAutocommitStopped(token ? `${msg} (A token is already saved. Use “Token” to update it.)` : msg);
                        return;
                    }
                    if (isGitConflictError(msg)) {
                        setConflictAndStop('Merge conflicts detected.');
                        return;
                    }
                    if (isGitPullBlockedError(msg)) {
                        const stashed = await pullWithAutoStash(repoPath, token);
                        if (!stashed.ok) {
                            if (stashed.conflicts) {
                                setConflictAndStop(stashed.message || 'Conflicts after restoring stashed changes.');
                            } else {
                                showAutocommitStopped(stashed.message || 'Pull blocked: could not auto-stash your local changes.');
                            }
                            return;
                        }
                    } else {
                        showAutocommitStopped(msg || 'Pull failed.');
                        return;
                    }
                }

                const status = await getRepoStatus(repoPath);
                if (repoHasConflicts(status)) {
                    setConflictAndStop('Merge conflicts detected.');
                    return;
                }
                if (!hasAnyChanges(status)) {
                    continue;
                }
                const stageList = buildStageList(status);
                if (stageList.length) {
                    await callAgentTool('gitAgent', 'git_stage', { path: repoPath, files: stageList });
                }
                const after = await getRepoStatus(repoPath);
                const staged = extractChangePaths(after?.staged);
                if (!staged.length) {
                    continue;
                }
                const userName = String(rememberedIdentity.name || '').trim();
                const userEmail = String(rememberedIdentity.email || '').trim();
                if (!userName || !userEmail) {
                    showAutocommitStopped('Set name and email in Git settings to continue.');
                    return;
                }
                try {
                    await callAgentTool('gitAgent', 'git_commit', {
                        path: repoPath,
                        message: AUTOCOMMIT_MESSAGE,
                        userName: userName || null,
                        userEmail: userEmail || null
                    });
                    committedAny = true;
                } catch (error) {
                    const msg = normalizeErrorMessage(error);
                    if (isGitIdentityError(msg)) {
                        showAutocommitStopped('Set name and email in Git settings to continue.');
                        return;
                    }
                    if (isGitConflictError(msg)) {
                        setConflictAndStop('Merge conflicts detected.');
                        return;
                    }
                    showAutocommitStopped(msg || 'Commit failed.');
                    return;
                }

                try {
                    await callAgentTool('gitAgent', 'git_push', {
                        path: repoPath,
                        token: String(token || '').trim() || undefined
                    });
                    setPushWarning('');
                } catch (error) {
                    const msg = normalizeErrorMessage(error);
                    if (isGitAuthError(msg)) {
                        setPushWarning('Autocommit created commits but push failed. Please push manually.');
                        showAutocommitStopped(token ? `${msg} (A token is already saved. Use “Token” to update it.)` : msg);
                        return;
                    }
                    setPushWarning('Autocommit created commits but push failed. Please push manually.');
                    showAutocommitStopped(msg || 'Push failed.');
                    return;
                }
            }

            if (committedAny) {
                await refreshOpenGitModals();
            }
        } catch {
            // ignore autocommit failures to avoid spamming; next tick will retry
        } finally {
            autocommit.running = false;
        }
    };

    const syncConflictFlagFromRepos = async () => {
        try {
            const repos = await listRepos();
            for (const repoPath of repos) {
                const status = await getRepoStatus(repoPath);
                if (repoHasConflicts(status)) {
                    setConflictFlag(true);
                    updateGitButtonIndicator();
                    return true;
                }
            }
            setConflictFlag(false);
            updateGitButtonIndicator();
            return false;
        } catch {
            updateGitButtonIndicator();
            return getConflictFlag();
        }
    };

    async function openGitModal() {
        const repoPath = reposRoot;
        return fileExp.withLoader(async () => {
            await syncConflictFlagFromRepos();
            ensureAutocommitTimer();
            const modal = await assistOS.UI.createReactiveModal('git-commit-modal', { repoPath });
            if (getConflictFlag()) {
                try {
                    const el = modal?.element || modal;
                    const presenter = el?.webSkelPresenter || el?.presenter || el;
                    presenter?.openConflictHelper?.();
                } catch {
                    // ignore
                }
            }
        });
    }

    updateGitButtonIndicator();
    ensureAutocommitTimer();
    window.addEventListener('storage', (event) => {
        if (!event?.key) return;
        if (event.key.startsWith('webskel.git.autocommit.')) {
            ensureAutocommitTimer();
            return;
        }
        if (event.key === 'webskel.git.conflicts') {
            updateGitButtonIndicator();
            ensureAutocommitTimer();
        }
    });
    window.addEventListener('webskel-autocommit-settings-changed', () => {
        ensureAutocommitTimer();
    });

    Object.assign(fileExp, {
        openGitModal,
        updateGitButtonIndicator,
        ensureAutocommitTimer
    });
}
