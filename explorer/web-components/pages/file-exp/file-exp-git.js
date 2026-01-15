import {
    parseJsonToolResult,
    normalizeErrorMessage,
    humanizeGitError,
    isGitConflictError,
    isGitPullBlockedError,
    getRememberedGitPat,
    getAutocommitSettings,
    getGitConflictFlag,
    setGitConflictFlag
} from "../../modals/git-commit-modal/git-commit-modal-utils.js";
import { callToolWithLoader } from "../../../utils/globalLoader.js";

export function attachGitController(fileExp) {
    const reposRoot = '/.ploinky/repos';
    const AUTOCOMMIT_MESSAGE = 'chore: autocommit';

    const getConflictFlag = () => getGitConflictFlag();
    const setConflictFlag = (value) => setGitConflictFlag(Boolean(value));

    const updateGitButtonIndicator = () => {
        const button = fileExp.element?.querySelector?.('#gitButton');
        if (!button) return;
        button.classList.toggle('has-conflicts', getConflictFlag());
    };

    const autocommit = {
        timerId: null,
        running: false,
        scheduledIntervalMinutes: null
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
        const { enabled, intervalMinutes } = getAutocommitSettings();
        if (!enabled) {
            clearAutocommitTimer();
            return;
        }
        if (getConflictFlag()) {
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

    const callGitTool = async (toolName, args) => {
        const result = await callToolWithLoader('explorer', toolName, args);
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

    const repoHasAnyChanges = (status) => {
        const staged = Array.isArray(status?.staged) ? status.staged : [];
        const unstaged = Array.isArray(status?.unstaged) ? status.unstaged : [];
        const untracked = Array.isArray(status?.untracked) ? status.untracked : [];
        return staged.length > 0 || unstaged.length > 0 || untracked.length > 0;
    };

    const stageAll = async (repoPath) => {
        await callGitTool('git_stage', { path: repoPath, files: [] });
    };

    const commit = async (repoPath) => {
        await callGitTool('git_commit', {
            path: repoPath,
            message: AUTOCOMMIT_MESSAGE
        });
    };

    const pull = async (repoPath, token) => {
        const payload = {
            path: repoPath,
            rebase: false,
            ffOnly: true
        };
        const cleanToken = String(token || '').trim();
        if (cleanToken) payload.token = cleanToken;
        await callGitTool('git_pull', payload);
    };

    const push = async (repoPath, token) => {
        const payload = { path: repoPath };
        const cleanToken = String(token || '').trim();
        if (cleanToken) payload.token = cleanToken;
        await callGitTool('git_push', payload);
    };

    const pullWithAutoStash = async (repoPath, token) => {
        try {
            await pull(repoPath, token);
            return true;
        } catch (error) {
            const msg = humanizeGitError(normalizeErrorMessage(error), { action: 'pull' });
            if (isGitConflictError(msg)) {
                throw new Error(msg);
            }
            if (!isGitPullBlockedError(msg)) {
                throw new Error(msg);
            }

            const stashResult = await callGitTool('git_stash', {
                path: repoPath,
                includeUntracked: true,
                message: 'Autocommit: auto-stash before pull'
            }) || {};

            if (!stashResult.created) {
                throw new Error(msg);
            }

            await pull(repoPath, token);

            const popResult = await callGitTool('git_stash_pop', {
                path: repoPath,
                ref: stashResult.ref || null,
                reinstateIndex: true
            }) || {};

            if (popResult.conflicts) {
                throw new Error('Conflicts after restoring stashed changes. Resolve them before continuing.');
            }

            return true;
        }
    };

    const runAutocommitTick = async () => {
        if (autocommit.running) return;
        const { enabled } = getAutocommitSettings();
        if (!enabled) return;
        if (getConflictFlag()) return;
        autocommit.running = true;
        try {
            const repos = await listRepos();
            const token = getRememberedGitPat();
            for (const repoPath of repos) {
                try {
                    await pullWithAutoStash(repoPath, token);
                } catch (error) {
                    const msg = normalizeErrorMessage(error);
                    if (isGitConflictError(msg)) {
                        setConflictFlag(true);
                        updateGitButtonIndicator();
                    }
                    clearAutocommitTimer();
                    fileExp.showStatus(`Autocommit stopped: ${msg}`, true);
                    return;
                }

                let status = null;
                try {
                    status = await getRepoStatus(repoPath);
                } catch {
                    continue;
                }
                if (repoHasConflicts(status)) {
                    setConflictFlag(true);
                    updateGitButtonIndicator();
                    clearAutocommitTimer();
                    fileExp.showStatus('Autocommit stopped: merge conflicts detected.', true);
                    return;
                }
                if (!repoHasAnyChanges(status)) {
                    continue;
                }
                await stageAll(repoPath);
                const afterStage = await getRepoStatus(repoPath);
                if (repoHasConflicts(afterStage)) {
                    setConflictFlag(true);
                    updateGitButtonIndicator();
                    clearAutocommitTimer();
                    fileExp.showStatus('Autocommit stopped: merge conflicts detected.', true);
                    return;
                }
                const staged = Array.isArray(afterStage?.staged) ? afterStage.staged : [];
                if (!staged.length) {
                    continue;
                }

                try {
                    await commit(repoPath);
                } catch (error) {
                    const msg = normalizeErrorMessage(error);
                    clearAutocommitTimer();
                    fileExp.showStatus(`Autocommit stopped: ${msg}`, true);
                    return;
                }

                try {
                    await push(repoPath, token);
                } catch (error) {
                    const msg = normalizeErrorMessage(error);
                    clearAutocommitTimer();
                    fileExp.showStatus(`Autocommit stopped: ${msg}`, true);
                    return;
                }
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
        await syncConflictFlagFromRepos();
        ensureAutocommitTimer();
        const repoPath = reposRoot;
        return fileExp.withLoader(async () => {
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

    Object.assign(fileExp, {
        openGitModal,
        updateGitButtonIndicator,
        ensureAutocommitTimer
    });
}
