import {
    normalizeErrorMessage,
    parseJsonToolResult,
    setGitConflictFlag
} from "./git-commit-modal-utils.js";
import { AUTOCOMMIT_RESET_EVENT } from "/explorer/utils/appEvents.js";

export function createConflictActions(ctx) {
    const {
        getState,
        applyState,
        service,
        setStatusLine,
        updateCommitButtons,
        syncStaticUI,
        refreshAll,
        loadRepoOverviews,
        collectConflictedItems,
        hasConflictsForRepos,
        handlePullConflicts,
        maybeRestoreAutoStash,
        updateRepoOverviewFromStatus
    } = ctx;

    const selectConflictFile = async ({ repoPath, filePath } = {}) => {
        if (!repoPath || !filePath) return;
        const state = getState();
        const selection = { repoPath, filePath };
        const requestKey = `${repoPath}::${filePath}`;
        applyState({
            conflictHelper: {
                ...(state.conflictHelper || {}),
                selected: selection,
                ours: '',
                theirs: '',
                choice: '',
                status: 'Loading conflict versions...',
                loading: true,
                requestKey
            }
        });

        try {
            const text = await service.gitConflictVersions({ path: repoPath, file: filePath });
            const payload = parseJsonToolResult(text) || {};
            const ours = payload.ours ?? '';
            const theirs = payload.theirs ?? '';
            const oursError = payload.oursError || '';
            const theirsError = payload.theirsError || '';
            const source = String(getState().conflictSource || '').toLowerCase();
            const localSide = (source === 'merge' || source === 'rebase' || source === 'stash') ? 'theirs' : 'ours';
            const displayOurs = localSide === 'ours' ? ours : theirs;
            const displayTheirs = localSide === 'ours' ? theirs : ours;
            const displayOursError = localSide === 'ours' ? oursError : theirsError;
            const displayTheirsError = localSide === 'ours' ? theirsError : oursError;
            let status = '';
            if (displayOursError || displayTheirsError) {
                const oursLabel = 'Local';
                const theirsLabel = source === 'stash' ? 'Stash' : 'Remote';
                const parts = [];
                if (displayOursError) parts.push(`${oursLabel} unavailable: ${displayOursError}`);
                if (displayTheirsError) parts.push(`${theirsLabel} unavailable: ${displayTheirsError}`);
                status = parts.join(' · ');
            } else {
                status = 'Compare versions or resolve in your editor.';
            }

            const current = getState().conflictHelper || {};
            if (current.requestKey !== requestKey) return;
            applyState({
                conflictHelper: {
                    ...current,
                    selected: selection,
                    ours: String(displayOurs || ''),
                    theirs: String(displayTheirs || ''),
                    choice: '',
                    status,
                    loading: false,
                    requestKey: null
                }
            });
        } catch (error) {
            const current = getState().conflictHelper || {};
            if (current.requestKey !== requestKey) return;
            applyState({
                conflictHelper: {
                    ...current,
                    selected: selection,
                    loading: false,
                    status: normalizeErrorMessage(error)
                }
            });
        }
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

    const applyConflictChoice = async ({ repoPath, filePath, source } = {}) => {
        if (!repoPath || !filePath) return;
        const side = normalizeConflictSource(source);
        if (side !== 'ours' && side !== 'theirs') {
            setStatusLine('Pick left or right to continue.', true);
            return;
        }
        const state = getState();
        applyState({
            conflictHelper: {
                ...(state.conflictHelper || {}),
                selected: { repoPath, filePath },
                choice: side,
                status: `Selected ${side === 'ours' ? 'left' : 'right'} version. Click Save to apply.`,
                loading: false
            }
        });
    };

    const saveConflictResolution = async ({ repoPath, filePath, choice } = {}) => {
        if (!repoPath || !filePath) return;
        const side = normalizeConflictSource(choice || getState().conflictHelper?.choice);
        if (side !== 'ours' && side !== 'theirs') {
            setStatusLine('Pick left or right to continue.', true);
            return;
        }
        const state = getState();
        const source = String(state.conflictSource || '').toLowerCase();
        const localSide = (source === 'merge' || source === 'rebase' || source === 'stash') ? 'theirs' : 'ours';
        const applySide = side === 'ours' ? localSide : (localSide === 'ours' ? 'theirs' : 'ours');
        applyState({
            conflictHelper: {
                ...(state.conflictHelper || {}),
                selected: { repoPath, filePath },
                status: 'Saving resolution...',
                loading: true
            }
        });

        try {
            await service.gitCheckoutConflict({ path: repoPath, file: filePath, source: applySide });
            await service.gitStage(repoPath, [filePath]);
            const statusPayload = parseJsonToolResult(await service.gitStatus(repoPath)) || {};
            updateRepoOverviewFromStatus(repoPath, statusPayload.status || statusPayload);
            applyState({
                conflictHelper: {
                    ...(state.conflictHelper || {}),
                    choice: '',
                    loading: false,
                    status: 'Resolved and staged.'
                },
                manualConflicts: []
            });
            const stillConflicted = collectConflictedItems([repoPath]).some((item) => item.filePath === filePath);
            if (stillConflicted) {
                await selectConflictFile({ repoPath, filePath });
            }
            updateCommitButtons();
            if (!hasConflictsForRepos([repoPath])) {
                setGitConflictFlag(false);
                window.dispatchEvent(new CustomEvent(AUTOCOMMIT_RESET_EVENT));
                setStatusLine('Ready.');
            }
        } catch (error) {
            applyState({
                conflictHelper: {
                    ...(state.conflictHelper || {}),
                    loading: false,
                    status: normalizeErrorMessage(error)
                }
            });
        }
    };

    const refreshConflicts = async () => {
        await refreshAll({ force: true });
        await maybeRestoreAutoStash();
        applyState({ manualConflicts: [] }, { silent: true });
        const selection = getState().conflictHelper?.selected;
        if (selection?.repoPath && selection?.filePath) {
            const stillConflicted = collectConflictedItems([selection.repoPath])
                .some((item) => item.filePath === selection.filePath);
            if (stillConflicted) {
                await selectConflictFile(selection);
            }
        }
    };

    return {
        selectConflictFile,
        applyConflictChoice,
        saveConflictResolution,
        refreshConflicts,
        normalizeConflictSource
    };
}
