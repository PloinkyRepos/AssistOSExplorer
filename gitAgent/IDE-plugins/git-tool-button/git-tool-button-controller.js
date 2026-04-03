import {
    parseJsonToolResult,
    getRememberedGitIdentity,
    normalizeErrorMessage,
    humanizeGitError,
    isGitAuthError,
    isGitIdentityError,
    isGitConflictError,
    isGitPullBlockedError,
    getAutocommitSettings,
    getConflictAutoresolveSetting,
    getGitConflictFlag,
    setGitConflictFlag,
    getGitErrorFlag,
    setGitErrorFlag,
    normalizeGitStatusPayload,
    normalizeSlashes
} from "./components/git-commit-modal/git-commit-modal-utils.js";
import { callAgentTool } from "/explorer/services/infrastructure/explorerApi.js";
import { getReposRoot, getRepoScanPaths } from "/explorer/utils/reposRoot.js";
import {
    AUTOCOMMIT_SETTINGS_CHANGED_EVENT,
    AUTOCOMMIT_RESET_EVENT,
    AUTOCOMMIT_STOP_EVENT,
    FILE_EXP_REFRESH_EVENT
} from "/explorer/utils/appEvents.js";
import { GIT_MODAL_CLOSED_EVENT } from "./git-tool-button-events.js";

export function attachGitController(fileExp) {
    const reposRoot = getReposRoot();
    const AUTOCOMMIT_MESSAGE = 'chore: autocommit';
    const setWindowListener = (key, eventName, handler, options) => {
        if (typeof fileExp.setWindowListener === 'function') {
            return fileExp.setWindowListener(key, eventName, handler, options);
        }
        if (typeof fileExp.addWindowListener === 'function') {
            return fileExp.addWindowListener(eventName, handler, options);
        }
        window.addEventListener(eventName, handler, options);
        return () => window.removeEventListener(eventName, handler, options);
    };

    const getConflictFlag = () => getGitConflictFlag();
    const setConflictFlag = (value) => setGitConflictFlag(Boolean(value));
    const getErrorFlag = () => getGitErrorFlag();
    const setErrorFlag = (value) => setGitErrorFlag(Boolean(value));
    let pushWarningMessage = '';

    const updateGitButtonIndicator = () => {
        const button = fileExp.element?.querySelector?.('#gitButton');
        if (!button) return;
        if (!button.dataset.defaultTitle) {
            button.dataset.defaultTitle = button.title || 'Commit and push with Git';
        }
        button.classList.toggle('has-conflicts', getConflictFlag());
        button.classList.toggle('has-git-error', getErrorFlag());
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
        if (getConflictFlag() && !isAutoresolveEnabled()) {
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
        const seen = new Set();
        const results = [];
        const scanPaths = getRepoScanPaths({ rootHint: reposRoot });
        for (const scanPath of scanPaths) {
            if (!scanPath) continue;
            try {
                const payload = await callGitTool('git_repos_overview', { path: scanPath }) || {};
                const repos = Array.isArray(payload?.repos) ? payload.repos : [];
                for (const repo of repos) {
                    const repoPath = String(repo?.path || '').trim();
                    if (!repoPath || seen.has(repoPath)) continue;
                    seen.add(repoPath);
                    results.push(repoPath);
                }
            } catch {
                // try next path
            }
        }
        return results;
    };

    const getRepoStatus = async (repoPath) => {
        const payload = await callGitTool('git_status', { path: repoPath }) || {};
        return payload?.status || payload || {};
    };

    const repoHasConflicts = (status) => normalizeGitStatusPayload(status).counts.conflicted > 0;

    const buildStageList = (status) => {
        const { paths } = normalizeGitStatusPayload(status);
        return Array.from(new Set([...paths.unstaged, ...paths.untracked]));
    };

    const hasAnyChanges = (status) => {
        const { counts } = normalizeGitStatusPayload(status);
        return counts.staged + counts.unstaged + counts.untracked > 0;
    };

    const showAutocommitStopped = (message) => {
        clearAutocommitTimer();
        setErrorFlag(true);
        updateGitButtonIndicator();
        fileExp.showStatus(`AutoSync stopped: ${message}`, true);
    };

    const setConflictAndStop = (message, repoPath = null) => {
        setConflictFlag(true);
        updateGitButtonIndicator();
        showAutocommitStopped(message || 'Merge conflicts detected.');
        void openGitModal({
            openConflictHelper: true,
            selectedRepoPath: repoPath || null
        });
    };

    const isAutoresolveEnabled = () => getConflictAutoresolveSetting();

    const pullRepoWithToken = async (repoPath, token) => {
        const payload = { path: repoPath, ffOnly: false, rebase: false };
        const cleanToken = String(token || '').trim();
        if (cleanToken) payload.token = cleanToken;
        await callAgentTool('gitAgent', 'git_pull', payload);
    };

    const restoreStash = async (repoPath, stashRef) => {
        try {
            const popStash = async (reinstateIndex) => {
                const request = { path: repoPath, reinstateIndex };
                if (stashRef) request.ref = stashRef;
                const text = await callAgentTool('gitAgent', 'git_stash_pop', request, { raw: true });
                return parseJsonToolResult(text) || {};
            };
            let payload = await popStash(true);
            let restoredWithoutIndex = false;
            if (payload.indexConflicts) {
                fileExp.showStatus('Could not restore staged state. Retrying stash without index...');
                payload = await popStash(false);
                restoredWithoutIndex = payload.ok !== false && !payload.conflicts;
            }
            if (payload.noStash) {
                return { ok: false, conflicts: false, message: 'No stash entries found to restore.' };
            }
            if (payload.conflicts) {
                return { ok: false, conflicts: true, message: 'Conflicts after restoring stashed changes.' };
            }
            if (payload.ok === false) {
                return { ok: false, conflicts: false, message: payload.output || 'Failed to restore stash.' };
            }
            if (restoredWithoutIndex) {
                return { ok: true, conflicts: false, message: 'Restored stashed changes without staged state.' };
            }
            return { ok: true, conflicts: false };
        } catch (error) {
            return { ok: false, conflicts: false, message: normalizeErrorMessage(error) };
        }
    };

    const pullWithAutoStash = async (repoPath, token) => {
        try {
            const statusPayload = await getRepoStatus(repoPath);
            const normalized = normalizeGitStatusPayload(statusPayload);
            const changesCount = normalized.counts.staged
                + normalized.counts.unstaged
                + normalized.counts.untracked
                + normalized.counts.conflicted;
            if (changesCount === 0) {
                await pullRepoWithToken(repoPath, token);
                return { ok: true };
            }
        } catch (error) {
            return { ok: false, message: normalizeErrorMessage(error) };
        }

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
        if (!stashCreated) {
            return { ok: false, message: 'Failed to stash local changes before pull.' };
        }

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

    const resolveConflictContent = (payload) => {
        if (!payload) return '';
        if (typeof payload === 'string') return payload;
        if (typeof payload.content === 'string') return payload.content;
        if (typeof payload.merged === 'string') return payload.merged;
        if (typeof payload.output === 'string') return payload.output;
        if (typeof payload.resolution === 'string') return payload.resolution;
        return '';
    };

    const joinPath = (base, file) => {
        const left = normalizeSlashes(base).replace(/\/+$/g, '');
        const right = normalizeSlashes(file).replace(/^\/+/g, '');
        return `${left}/${right}`;
    };

    const autoResolveConflicts = async (repoPath, source = 'merge') => {
        if (!isAutoresolveEnabled()) return { ok: false, message: '' };
        try {
            fileExp.showStatus('Auto-resolving conflicts...');
            const statusPayload = await getRepoStatus(repoPath);
            const normalized = normalizeGitStatusPayload(statusPayload);
            const conflictPaths = normalized.paths.conflicted;
            if (!conflictPaths.length) return { ok: true };
            for (const filePath of conflictPaths) {
                const versionsText = await callAgentTool('gitAgent', 'git_conflict_versions', {
                    path: repoPath,
                    file: filePath
                }, { raw: true });
                const versions = parseJsonToolResult(versionsText) || {};
                const localSide = (source === 'rebase' || source === 'stash') ? 'theirs' : 'ours';
                const oursContent = localSide === 'ours' ? (versions.ours || '') : (versions.theirs || '');
                const theirsContent = localSide === 'ours' ? (versions.theirs || '') : (versions.ours || '');
                const resolveText = await callAgentTool('llmAssistant', 'llm_resolve_conflict', {
                    base: versions.base || '',
                    ours: oursContent,
                    theirs: theirsContent,
                    source
                }, { raw: true });
                const resolvePayload = parseJsonToolResult(resolveText) || resolveText;
                const resolved = resolveConflictContent(resolvePayload);
                if (!resolved) {
                    return { ok: false, message: 'Autoresolve returned empty content.' };
                }
                const absolutePath = joinPath(repoPath, filePath);
                await fileExp.tooling.writeFile(absolutePath, resolved);
                fileExp.bumpWorkspaceVersion?.();
                await callAgentTool('gitAgent', 'git_stage', { path: repoPath, files: [filePath] });
            }
            const afterPayload = await getRepoStatus(repoPath);
            const afterNormalized = normalizeGitStatusPayload(afterPayload);
            if (afterNormalized.counts.conflicted > 0) {
                return { ok: false, message: '' };
            }
            setConflictFlag(false);
            updateGitButtonIndicator();
            fileExp.showStatus('Conflicts auto-resolved.');
            return { ok: true };
        } catch (error) {
            const msg = normalizeErrorMessage(error);
            if (msg.toLowerCase().includes('llm_resolve_conflict') && msg.toLowerCase().includes('not found')) {
                return { ok: false, message: 'Autoresolve unavailable: llm_resolve_conflict tool not found.' };
            }
            return { ok: false, message: msg };
        }
    };

    const runAutocommitTick = async () => {
        if (autocommit.running) return;
        const { repos } = getAutocommitSettings();
        if (getConflictFlag() && !isAutoresolveEnabled()) return;
        if (Array.isArray(repos) && repos.length === 0) return;
        autocommit.running = true;
        try {
            const token = '';
            const rememberedIdentity = getRememberedGitIdentity();
            const selectedRepos = Array.isArray(repos) ? repos.filter(Boolean) : [];
            const repoList = selectedRepos.length ? selectedRepos : await listRepos();
            if (!repoList.length) return;
            let committedAny = false;

            for (const repoPath of repoList) {
                if (getConflictFlag()) return;
                let initialStatus = await getRepoStatus(repoPath);
                if (normalizeGitStatusPayload(initialStatus).counts.conflicted > 0) {
                    const resolved = await autoResolveConflicts(repoPath, 'merge');
                    if (!resolved.ok) {
                        setConflictAndStop(resolved.message || 'Merge conflicts detected.', repoPath);
                        return;
                    }
                    initialStatus = await getRepoStatus(repoPath);
                }
                if (!hasAnyChanges(initialStatus)) {
                    continue;
                }
                try {
                    await pullRepoWithToken(repoPath, token);
                } catch (error) {
                    const msg = humanizeGitError(normalizeErrorMessage(error), { action: 'pull' });
                    if (isGitIdentityError(msg)) {
                        showAutocommitStopped('Set name, email, and token in Git settings to continue.');
                        return;
                    }
                    if (isGitAuthError(msg)) {
                        showAutocommitStopped(token ? `${msg} (A token is already saved. Use “Token” to update it.)` : msg);
                        return;
                    }
                    if (isGitConflictError(msg)) {
                        const resolved = await autoResolveConflicts(repoPath, 'merge');
                        if (!resolved.ok) {
                            setConflictAndStop(resolved.message || 'Merge conflicts detected.', repoPath);
                            return;
                        }
                    }
                    if (isGitPullBlockedError(msg)) {
                        const stashed = await pullWithAutoStash(repoPath, token);
                        if (!stashed.ok) {
                            if (stashed.conflicts) {
                                const resolved = await autoResolveConflicts(repoPath, 'stash');
                                if (!resolved.ok) {
                                    setConflictAndStop(resolved.message || stashed.message || 'Conflicts after restoring stashed changes.', repoPath);
                                    return;
                                }
                            } else {
                                showAutocommitStopped(stashed.message || 'Pull blocked: could not auto-stash your local changes.');
                                return;
                            }
                        }
                    } else {
                        showAutocommitStopped(msg || 'Pull failed.');
                        return;
                    }
                }

                let status = await getRepoStatus(repoPath);
                if (repoHasConflicts(status)) {
                    const resolved = await autoResolveConflicts(repoPath, 'merge');
                    if (!resolved.ok) {
                        setConflictAndStop(resolved.message || 'Merge conflicts detected.', repoPath);
                        return;
                    }
                    status = await getRepoStatus(repoPath);
                }
                if (!hasAnyChanges(status)) {
                    continue;
                }
                const stageList = buildStageList(status);
                if (stageList.length) {
                    await callAgentTool('gitAgent', 'git_stage', { path: repoPath, files: stageList });
                }
                const after = await getRepoStatus(repoPath);
                const staged = normalizeGitStatusPayload(after).paths.staged;
                if (!staged.length) {
                    continue;
                }
                const userName = String(rememberedIdentity.name || '').trim();
                const userEmail = String(rememberedIdentity.email || '').trim();
                if (!userName || !userEmail) {
                    showAutocommitStopped('Set name, email, and token in Git settings to continue.');
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
                        showAutocommitStopped('Set name, email, and token in Git settings to continue.');
                        return;
                    }
                    if (isGitConflictError(msg)) {
                        setConflictAndStop('Merge conflicts detected.', repoPath);
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
                setErrorFlag(false);
                updateGitButtonIndicator();
                if (typeof fileExp.refresh === 'function') {
                    await fileExp.refresh();
                }
                await refreshOpenGitModals();
                fileExp.showStatus('AutoSync complete.');
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

    async function openGitModal(options = {}) {
        const repoPath = reposRoot;
        return fileExp.withLoader(async () => {
            await syncConflictFlagFromRepos();
            ensureAutocommitTimer();
            await assistOS.UI.createReactiveModal('git-commit-modal', {
                repoPath,
                openConflictHelper: Boolean(options.openConflictHelper),
                selectedRepoPath: options.selectedRepoPath || null
            });
        });
    }

    updateGitButtonIndicator();
    ensureAutocommitTimer();
    const handleStorageEvent = (event) => {
        if (!event?.key) return;
        if (event.key.startsWith('webskel.git.autocommit.')) {
            ensureAutocommitTimer();
            return;
        }
        if (event.key === 'webskel.git.conflicts') {
            updateGitButtonIndicator();
            ensureAutocommitTimer();
        }
        if (event.key === 'webskel.git.errors') {
            updateGitButtonIndicator();
        }
    };
    const handleAutocommitSettingsChanged = () => {
        ensureAutocommitTimer();
    };
    const handleAutocommitReset = () => {
        clearAutocommitTimer();
        ensureAutocommitTimer();
    };
    const handleAutocommitStop = (event) => {
        clearAutocommitTimer();
        setErrorFlag(true);
        updateGitButtonIndicator();
        const message = String(event?.detail?.message || '').trim();
        if (message) {
            fileExp.showStatus(`AutoSync stopped: ${message}`, true);
        }
    };
    const handleFileExpRefresh = async () => {
        if (typeof fileExp.refresh === 'function') {
            await fileExp.refresh();
        }
        await syncConflictFlagFromRepos();
        ensureAutocommitTimer();
    };
    const handleGitModalClosed = () => {
        updateGitButtonIndicator();
        syncConflictFlagFromRepos()
            .catch(() => {})
            .finally(() => {
                ensureAutocommitTimer();
            });
    };

    setWindowListener('git-storage', 'storage', handleStorageEvent);
    setWindowListener('git-autocommit-settings-changed', AUTOCOMMIT_SETTINGS_CHANGED_EVENT, handleAutocommitSettingsChanged);
    setWindowListener('git-autocommit-reset', AUTOCOMMIT_RESET_EVENT, handleAutocommitReset);
    setWindowListener('git-autocommit-stop', AUTOCOMMIT_STOP_EVENT, handleAutocommitStop);
    setWindowListener('git-file-exp-refresh', FILE_EXP_REFRESH_EVENT, handleFileExpRefresh);
    setWindowListener('git-modal-closed', GIT_MODAL_CLOSED_EVENT, handleGitModalClosed);
    fileExp.registerCleanup?.(() => {
        clearAutocommitTimer();
    });

    Object.assign(fileExp, {
        openGitModal,
        updateGitButtonIndicator,
        ensureAutocommitTimer
    });
}
