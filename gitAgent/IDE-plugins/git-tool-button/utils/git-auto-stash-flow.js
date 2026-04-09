import {
    normalizeErrorMessage,
    humanizeGitError,
    isGitAuthError,
    isGitIdentityError,
    isGitConflictError,
    isGitPullBlockedError,
    extractGitPullBlockedFiles,
    parseJsonToolResult,
    normalizeGitStatusPayload
} from "../components/git-commit-modal/git-commit-modal-utils.js";

export async function restoreStashFlow({
    service,
    repoPath,
    stashRef = null,
    setStatusLine = () => {},
    onConflicts = null,
    onStateChange = null
} = {}) {
    try {
        const popStash = async (reinstateIndex) => {
            const request = { path: repoPath, reinstateIndex };
            if (stashRef) request.ref = stashRef;
            const text = await service.gitStashPop(request);
            return parseJsonToolResult(text) || {};
        };

        let payload = await popStash(true);
        let restoredWithoutIndex = false;
        if (payload.indexConflicts) {
            setStatusLine('Could not restore staged state. Retrying stash without index...');
            payload = await popStash(false);
            restoredWithoutIndex = payload.ok !== false && !payload.conflicts;
        }

        if (payload.noStash) {
            return { ok: false, conflicts: false, message: 'No stash entries found to restore.' };
        }
        if (payload.conflicts) {
            const seededConflicts = Array.isArray(payload.conflictPaths)
                ? payload.conflictPaths
                    .filter(Boolean)
                    .map((filePath) => ({ repoPath, filePath }))
                : [];
            if (typeof onConflicts === 'function') {
                const resolved = await onConflicts({ repoPath, seededConflicts, payload });
                if (typeof onStateChange === 'function') {
                    await onStateChange({ repoPath, payload, restored: resolved });
                }
                return {
                    ok: Boolean(resolved),
                    conflicts: !resolved,
                    message: resolved ? '' : 'Conflicts after restoring stashed changes.'
                };
            }
            if (typeof onStateChange === 'function') {
                await onStateChange({ repoPath, payload, restored: false });
            }
            return {
                ok: false,
                conflicts: true,
                message: 'Conflicts after restoring stashed changes.',
                conflictPaths: seededConflicts
            };
        }
        if (payload.ok === false) {
            if (typeof onStateChange === 'function') {
                await onStateChange({ repoPath, payload, restored: false });
            }
            return { ok: false, conflicts: false, message: payload.output || 'Failed to restore stash.' };
        }
        if (typeof onStateChange === 'function') {
            await onStateChange({ repoPath, payload, restored: true });
        }
        if (restoredWithoutIndex) {
            setStatusLine('Restored stashed changes without staged state.');
        }
        return { ok: true, conflicts: false };
    } catch (error) {
        if (typeof onStateChange === 'function') {
            await onStateChange({ repoPath, payload: null, restored: false });
        }
        return { ok: false, conflicts: false, message: normalizeErrorMessage(error) };
    }
}

export async function pullWithAutoStashFlow({
    service,
    repoPath,
    token = null,
    repoPaths = [],
    gitPullWithToken,
    restoreStash,
    setStatusLine = () => {}
} = {}) {
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
        return { ok: false, reason: 'status_error', message: normalizeErrorMessage(error) };
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
            return { ok: false, reason: 'stash_failed', message: normalizeErrorMessage(error) };
        }

        stashCreated = Boolean(stashPayload.created);
        stashRef = stashPayload.ref || null;
        if (!stashCreated) {
            return {
                ok: false,
                reason: 'stash_failed',
                message: 'Failed to stash local changes. Resolve them before pulling.'
            };
        }
    }

    const rollbackAutoStash = async () => {
        if (!stashCreated) {
            return { ok: false, conflicts: false };
        }
        setStatusLine('Restoring stashed changes...');
        return restoreStash(repoPath, stashRef);
    };

    try {
        await gitPullWithToken(repoPath, token);
    } catch (error) {
        const msg = humanizeGitError(normalizeErrorMessage(error), { action: 'pull' });
        if (isGitIdentityError(msg)) {
            const rollback = stashCreated ? await rollbackAutoStash() : null;
            return { ok: false, reason: 'identity', message: msg, rollback, repoPath, repoPaths };
        }
        if (isGitAuthError(msg)) {
            const rollback = stashCreated ? await rollbackAutoStash() : null;
            return { ok: false, reason: 'auth', message: msg, rollback, repoPath, repoPaths };
        }
        if (isGitConflictError(msg)) {
            return {
                ok: false,
                reason: 'pull_conflicts',
                message: stashCreated
                    ? 'Pull completed with conflicts. Resolve them, then restore your stashed changes.'
                    : 'Pull completed with conflicts. Resolve them before continuing.',
                repoPath,
                repoPaths,
                stashCreated,
                stashRef
            };
        }
        if (isGitPullBlockedError(msg)) {
            const rollback = stashCreated ? await rollbackAutoStash() : null;
            return {
                ok: false,
                reason: 'pull_blocked',
                message: 'Pull blocked: could not auto-stash your local changes.',
                detailedMessage: msg,
                blockedFiles: extractGitPullBlockedFiles(msg),
                rollback,
                repoPath,
                repoPaths
            };
        }
        const rollback = stashCreated ? await rollbackAutoStash() : null;
        return { ok: false, reason: 'pull_error', message: msg, rollback, repoPath, repoPaths };
    }

    if (stashCreated) {
        const restored = await rollbackAutoStash();
        if (!restored.ok) {
            return {
                ok: false,
                reason: 'restore_failed',
                message: restored.message || 'Failed to restore stash.',
                conflicts: restored.conflicts,
                repoPath,
                repoPaths
            };
        }
    }

    return { ok: true, repoPath, repoPaths };
}
