import { normalizeErrorMessage, humanizeGitError, isGitAuthError, isGitIdentityError, isGitConflictError, isGitPullBlockedError, extractGitPullBlockedFiles, parseJsonToolResult, normalizeGitStatusPayload } from "./git-commit-modal-utils.js";

export function createAutoStashActions(ctx) {
    const {
        getState,
        applyState,
        service,
        setStatusLine,
        updateCommitButtons,
        syncStaticUI,
        loadRepoOverviews,
        handlePullConflicts,
        ensureGitIdentityOrPrompt,
        showGitAuthPrompt,
        gitPullWithToken,
        restoreStash,
        hasConflictsForRepos,
        collectConflictedItems
    } = ctx;

    const pullWithAutoStash = async (repoPath, token, repoPaths) => {
        let stashPayload = null;
        let stashCreated = false;
        let stashRef = null;
        let hasLocalChanges = false;
        try {
            const statusText = await service.gitStatus(repoPath);
            const statusPayload = parseJsonToolResult(statusText) || {};
            const normalized = normalizeGitStatusPayload(statusPayload);
            const changesCount = normalized.counts.staged
                + normalized.counts.unstaged
                + normalized.counts.untracked
                + normalized.counts.conflicted;
            hasLocalChanges = changesCount > 0;
        } catch (error) {
            setStatusLine(normalizeErrorMessage(error), true);
            return false;
        }

        if (hasLocalChanges) {
            setStatusLine('Local changes detected. Stashing before pull...');
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

            stashCreated = Boolean(stashPayload.created);
            stashRef = stashPayload.ref || null;
            if (!stashCreated) {
                setStatusLine('Failed to stash local changes. Resolve them before pulling.', true);
                return false;
            }
        }

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
                    applyState({ autoStash: { repoPath, ref: stashRef } }, { silent: true });
                }
                const conflictMessage = stashCreated
                    ? 'Pull completed with conflicts. Resolve them, then restore your stashed changes.'
                    : 'Pull completed with conflicts. Resolve them before continuing.';
                const resolved = await handlePullConflicts(conflictMessage, [repoPath], 'merge');
                if (!resolved) return false;
                if (stashCreated) {
                    applyState({ autoStash: null }, { silent: true });
                    setStatusLine('Restoring stashed changes...');
                    const restored = await restoreStash(repoPath, stashRef);
                    return restored.ok;
                }
                return true;
            }
            if (isGitPullBlockedError(msg)) {
                if (stashCreated) {
                    await restoreStash(repoPath, stashRef);
                }
                const blockedFiles = extractGitPullBlockedFiles(msg);
                applyState({ pullBlocked: blockedFiles.length ? { repoPath, files: blockedFiles } : null });
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
        applyState({ autoStash: null }, { silent: true });
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

    return {
        pullWithAutoStash,
        maybeRestoreAutoStash
    };
}
