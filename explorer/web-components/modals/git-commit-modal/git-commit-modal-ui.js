import { isReposRootPath, getAutocommitSettings } from "./git-commit-modal-utils.js";

export function createGitCommitUI(ctx) {
    const {
        element,
        state,
        setMenuAbortController,
        runGitAction,
        openDiff,
        applyRepoPathFromInput,
        refreshAction,
        generateCommitMessage,
        toggleRepoChanges,
        toggleRepoFolderExpanded,
        toggleTreeFolder,
        toggleTreePrefixSelectionCheckbox,
        toggleTreeFileSelectionCheckbox,
        toggleRepoAllChangesCheckbox,
        openIgnoreForFile,
        openStopTrackingForFile,
        removeIgnoreForFile,
        rollbackFile,
        deleteFile,
        saveGitCredentials,
        cancelGitCredentials,
        saveGitIgnore,
        cancelGitIgnore,
        setIgnoreMode,
        setIgnoreAnchor,
        openIgnoreForDiff,
        selectConflictFile,
        applyConflictChoice,
        stageConflictFile,
        refreshConflicts,
        openConflictHelper,
        closeModal,
        cancelConflictResolution
    } = ctx;

    const bindEvents = () => {
        if (!element.dataset.boundCommitMenu) {
            const closeIfOutside = (event) => {
                const root = element.querySelector('#gitActionsSplit');
                const inside = root && (event.target === root || root.contains(event.target));
                if (!inside) closeActionsMenu();
                if (!event.target?.closest?.('.git-file-menu')) {
                    closeFileMenus();
                }
            };
            const controller = new AbortController();
            setMenuAbortController(controller);
            document.addEventListener('pointerdown', closeIfOutside, {
                capture: true,
                signal: controller.signal
            });
            element.dataset.boundCommitMenu = 'true';
        }

        if (!element.dataset.boundPromptEvents) {
            element.addEventListener('git-credentials-submit', (event) => {
                saveGitCredentials(event?.detail || {});
            });
            element.addEventListener('git-credentials-cancel', () => {
                cancelGitCredentials();
            });
            element.addEventListener('git-credentials-change', (event) => {
                const detail = event?.detail || {};
                state.identityPrompt = {
                    ...state.identityPrompt,
                    name: String(detail.name ?? state.identityPrompt?.name ?? ''),
                    email: String(detail.email ?? state.identityPrompt?.email ?? '')
                };
                state.authPrompt = {
                    ...state.authPrompt,
                    token: String(detail.token ?? state.authPrompt?.token ?? ''),
                    remember: typeof detail.remember === 'boolean' ? detail.remember : Boolean(state.authPrompt?.remember)
                };
            });
            element.addEventListener('git-ignore-submit', (event) => {
                saveGitIgnore(event?.detail || {});
            });
            element.addEventListener('git-ignore-cancel', () => {
                cancelGitIgnore();
            });
            element.addEventListener('git-ignore-change', (event) => {
                const detail = event?.detail || {};
                state.ignorePrompt = {
                    ...state.ignorePrompt,
                    patterns: String(detail.patterns ?? state.ignorePrompt?.patterns ?? '')
                };
            });
            element.addEventListener('git-ignore-mode', (event) => {
                setIgnoreMode(event?.detail || {});
            });
            element.addEventListener('git-ignore-anchor', (event) => {
                setIgnoreAnchor(event?.detail || {});
            });
            element.addEventListener('git-diff-ignore', (event) => {
                openIgnoreForDiff(event?.detail || {});
            });
            element.dataset.boundPromptEvents = 'true';
        }

        if (!element.dataset.boundCommitBodyReady) {
            element.addEventListener('git-commit-body-ready', () => {
                updateCommitButtons();
                syncStaticUI();
            });
            element.dataset.boundCommitBodyReady = 'true';
        }

        if (!element.dataset.boundCommitBodyActions) {
            element.addEventListener('git-commit-body-action', (event) => {
                handleCommitBodyAction(event?.detail || {});
            });
            element.dataset.boundCommitBodyActions = 'true';
        }

        if (!element.dataset.boundCommitActions) {
            element.addEventListener('git-commit-actions-action', (event) => {
                handleCommitActionsAction(event?.detail || {});
            });
            element.dataset.boundCommitActions = 'true';
        }

        if (!element.dataset.boundRepoTreeActions) {
            element.addEventListener('git-repo-tree-action', (event) => {
                handleRepoTreeAction(event?.detail || {});
            });
            element.dataset.boundRepoTreeActions = 'true';
        }

        if (!element.dataset.boundConflictHelper) {
            element.addEventListener('git-conflict-select', (event) => {
                selectConflictFile?.(event?.detail || {});
            });
            element.addEventListener('git-conflict-apply', (event) => {
                applyConflictChoice?.(event?.detail || {});
            });
            element.addEventListener('git-conflict-stage', (event) => {
                stageConflictFile?.(event?.detail || {});
            });
            element.addEventListener('git-conflict-refresh', () => {
                refreshConflicts?.();
            });
            element.addEventListener('git-conflict-cancel', () => {
                cancelConflictResolution?.();
            });
            element.dataset.boundConflictHelper = 'true';
        }

        if (!element.dataset.boundStatusResolve) {
            element.addEventListener('git-status-resolve', () => {
                openConflictHelper?.();
            });
            element.dataset.boundStatusResolve = 'true';
        }

        if (!element.dataset.boundConflictBanner) {
            element.addEventListener('git-conflict-banner-open', () => {
                openConflictHelper?.();
            });
            element.dataset.boundConflictBanner = 'true';
        }

        if (!element.dataset.boundPullBlockedEvents) {
            element.addEventListener('git-pull-blocked-open', (event) => {
                openDiff?.(event?.detail || {});
            });
            element.dataset.boundPullBlockedEvents = 'true';
        }

        const changesRoot = element.querySelector('.git-changes');
        if (changesRoot && !changesRoot.dataset.bound) {
            // Selection is handled via WebSkel `data-local-action` on checkboxes.
            changesRoot.dataset.bound = 'true';
        }

        if (!element.dataset.boundEscape) {
            element.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    event.stopPropagation();
                    event.preventDefault();
                    closeModal();
                }
            });
            element.dataset.boundEscape = 'true';
        }
    };

    const syncStaticUI = () => {
        const subtitle = element.querySelector('#gitRepoSubtitle');
        if (subtitle) {
            subtitle.textContent = `Repository: ${state.repoPath}`;
        }

        const modalRoot = element.classList.contains('git-modal') ? element : element.querySelector('.git-modal');
        if (modalRoot) {
            const gateActive = Boolean(state.credentialsGate);
            const credentialsVisible = gateActive
                || Boolean(state.credentialsOpen)
                || Boolean(state.identityPrompt?.visible)
                || Boolean(state.authPrompt?.visible);
            modalRoot.classList.toggle('git-credentials-only', gateActive);
            modalRoot.classList.toggle('git-credentials-open', credentialsVisible);
        }

        updateCredentialsPrompt();
        updateConflictHelper();
        updateStatusBar();
        updateConflictBanner();
        updatePullBlockedPanel();
        updateCommitBody();
        updateRepoTree();
        updateIgnorePrompt();
    };

    const getCredentialsPromptPresenter = () => element.querySelector('git-credentials-prompt')?.webSkelPresenter || null;
    const getIgnorePromptPresenter = () => element.querySelector('git-ignore-prompt')?.webSkelPresenter || null;
    const getConflictHelperPresenter = () => element.querySelector('git-conflict-helper')?.webSkelPresenter || null;
    const getConflictBannerPresenter = () => element.querySelector('git-conflict-banner')?.webSkelPresenter || null;
    const getCommitBodyPresenter = () => element.querySelector('git-commit-body')?.webSkelPresenter || null;
    const getCommitActionsPresenter = () => element.querySelector('git-commit-actions')?.webSkelPresenter || null;
    const getRepoTreePresenter = () => element.querySelector('git-repo-tree')?.webSkelPresenter || null;

    const handleCommitBodyAction = ({ action, element: actionElement, mode, value } = {}) => {
        if (!action) return;
        if (action === 'applyRepoPathFromInput') {
            applyRepoPathFromInput?.(value);
            return;
        }
        const actionMap = {
            refreshAction,
            generateCommitMessage
        };
        if (action === 'runGitAction') {
            runGitAction?.(actionElement, mode);
            return;
        }
        if (action === 'updateCommitMessage') {
            updateCommitMessage(value);
            return;
        }
        const handler = actionMap[action];
        if (typeof handler === 'function') {
            handler(actionElement);
        }
    };

    const handleCommitActionsAction = ({ action, element: actionElement, mode, value } = {}) => {
        if (!action) return;
        if (action === 'runGitAction') {
            runGitAction?.(actionElement, mode);
            return;
        }
        if (action === 'updateCommitMessage') {
            updateCommitMessage(value);
            return;
        }
        if (action === 'generateCommitMessage') {
            generateCommitMessage?.();
            return;
        }
    };

    const handleRepoTreeAction = ({ action, element: actionElement } = {}) => {
        if (!action) return;
        const actionMap = {
            openDiff,
            toggleRepoChanges,
            toggleRepoFolderExpanded,
            toggleTreeFolder,
            toggleTreePrefixSelectionCheckbox,
            toggleTreeFileSelectionCheckbox,
            toggleRepoAllChangesCheckbox,
            openIgnoreForFile,
            openStopTrackingForFile,
            removeIgnoreForFile,
            rollbackFile,
            deleteFile
        };
        const handler = actionMap[action];
        if (typeof handler === 'function') {
            handler(actionElement);
        }
    };

    const updateCredentialsPrompt = (options = {}) => {
        const identityState = state.identityPrompt || {};
        const authState = state.authPrompt || {};
        const autocommit = getAutocommitSettings();
        const visible = Boolean(
            identityState.visible
            || authState.visible
            || state.credentialsGate
            || state.credentialsOpen
        );
        const detail = {
            visible,
            name: identityState.name || '',
            email: identityState.email || '',
            token: authState.token || '',
            remember: Boolean(authState.remember),
            autocommitEnabled: Boolean(autocommit.enabled),
            autocommitIntervalMinutes: Number(autocommit.intervalMinutes || 15)
        };
        if (options.focus) detail.focus = options.focus;
        const presenter = getCredentialsPromptPresenter();
        if (presenter?.setState) {
            presenter.setState(detail);
            return;
        }
        const target = element.querySelector('git-credentials-prompt');
        target?.dispatchEvent?.(new CustomEvent('git-credentials-update', { detail }));
    };

    const updateIdentityPrompt = (options = {}) => {
        updateCredentialsPrompt(options);
    };

    const updateAuthPrompt = (options = {}) => {
        updateCredentialsPrompt(options);
    };

    const updateIgnorePrompt = (options = {}) => {
        const promptState = state.ignorePrompt || {};
        const paths = Array.isArray(promptState.paths) ? promptState.paths : [];
        const preview = paths.slice(0, 4);
        const detail = {
            visible: Boolean(promptState.visible),
            repoLabel: promptState.repoPath || '',
            patterns: promptState.patterns || '',
            mode: promptState.mode || 'file',
            anchor: promptState.anchor !== false,
            count: paths.length,
            preview,
            source: promptState.source || 'manual',
            stopTracking: Boolean(promptState.stopTracking)
        };
        if (options.focus) detail.focus = options.focus;
        const presenter = getIgnorePromptPresenter();
        if (presenter?.setState) {
            presenter.setState(detail);
            return;
        }
        const target = element.querySelector('git-ignore-prompt');
        target?.dispatchEvent?.(new CustomEvent('git-ignore-update', { detail }));
    };

    const updateCommitBody = () => {
        const body = element.querySelector('git-commit-body');
        if (!body) return;
        const visible = !state.credentialsGate && !state.conflictFocus;
        const detail = {
            visible,
            repoPath: state.repoPath || ''
        };
        const presenter = getCommitBodyPresenter();
        if (presenter?.setState) {
            presenter.setState(detail);
            return;
        }
        body.classList.toggle('is-hidden', !visible);
    };

    const updateStatusBar = () => {
        const presenter = element.querySelector('git-status-bar')?.webSkelPresenter;
        if (!presenter?.setState) return;
        const message = state.lastStatusLine || '';
        presenter.setState({
            text: message,
            isError: Boolean(state.lastStatusIsError),
            showResolve: Boolean(state.hasConflicts)
        });
    };

    const updateConflictBanner = () => {
        const presenter = getConflictBannerPresenter();
        if (!presenter?.setState) return;
        presenter.setState({
            visible: Boolean(state.hasConflicts) && !state.conflictFocus,
            count: Number(state.conflictCount || 0)
        });
    };

    const updateRepoTree = () => {
        const presenter = getRepoTreePresenter();
        if (!presenter?.setState) return;
        presenter.setState({
            reposRoot: state.reposRoot || '',
            repos: Array.isArray(state.repoOverviews) ? state.repoOverviews : [],
            loading: Boolean(state.repoOverviewsLoading),
            repoTreeExpanded: state.repoTreeExpanded || {},
            repoChangesExpanded: state.repoChangesExpanded || {},
            treeExpandedByRepo: state.treeExpandedByRepo || {},
            selectionState: state.selectedFilesByRepo || {},
            selectedPath: state.selectedPath || '',
            selectedRepoPath: state.selectedRepoPath || state.repoPath || ''
        });
    };

    const getSelectedReposForBatch = () => {
        return Array.from(new Set([
            ...Object.entries(state.selectedFilesByRepo || {})
                .filter(([, entry]) => (entry?.files && entry.files.size > 0) || (entry?.prefixes && entry.prefixes.size > 0))
                .map(([repoPath]) => repoPath)
        ]));
    };

    const collectConflictItems = (repoPaths) => {
        const repos = Array.isArray(state.repoOverviews) ? state.repoOverviews : [];
        const targetSet = Array.isArray(repoPaths) && repoPaths.length ? new Set(repoPaths) : null;
        const items = [];
        const manual = Array.isArray(state.manualConflicts) ? state.manualConflicts : [];
        if (!repos.length && !manual.length) return [];
        for (const repo of repos) {
            if (!repo?.path) continue;
            if (targetSet && !targetSet.has(repo.path)) continue;
            const conflicted = Array.isArray(repo?.changes?.conflicted) ? repo.changes.conflicted : [];
            for (const filePath of conflicted) {
                if (!filePath) continue;
                items.push({
                    repoPath: repo.path,
                    filePath,
                    repoLabel: repo.name || repo.path.split('/').filter(Boolean).slice(-1)[0] || repo.path
                });
            }
        }
        items.sort((a, b) => {
            const repoCompare = a.repoPath.localeCompare(b.repoPath);
            if (repoCompare !== 0) return repoCompare;
            return a.filePath.localeCompare(b.filePath);
        });
        if (manual.length) {
            const seen = new Set(items.map((item) => `${item.repoPath}::${item.filePath}`));
            for (const entry of manual) {
                if (!entry?.repoPath || !entry?.filePath) continue;
                if (targetSet && !targetSet.has(entry.repoPath)) continue;
                const key = `${entry.repoPath}::${entry.filePath}`;
                if (seen.has(key)) continue;
                items.push({
                    repoPath: entry.repoPath,
                    filePath: entry.filePath,
                    repoLabel: entry.repoPath.split('/').filter(Boolean).slice(-1)[0] || entry.repoPath
                });
                seen.add(key);
            }
        }
        return items;
    };

    const resolveConflictTargets = () => {
        const manual = Array.isArray(state.manualConflicts) ? state.manualConflicts : [];
        if (manual.length) {
            return Array.from(new Set(manual.map((entry) => entry?.repoPath).filter(Boolean)));
        }
        const selectedRepo = state.selectedRepoPath;
        if (selectedRepo && !isReposRootPath(selectedRepo, state.reposRoot)) {
            return [selectedRepo];
        }
        const selected = getSelectedReposForBatch();
        if (selected.length) return selected;
        if (state.repoPath && !isReposRootPath(state.repoPath, state.reposRoot)) {
            return [state.repoPath];
        }
        return null;
    };

    const updateConflictHelper = () => {
        const allItems = collectConflictItems(null);
        state.hasConflicts = allItems.length > 0;
        state.conflictCount = allItems.length;
        const helper = element.querySelector('git-conflict-helper');
        if (!helper) return;
        const targetRepos = resolveConflictTargets();
        const items = targetRepos ? collectConflictItems(targetRepos) : allItems;
        if (!items.length) {
            if (state.conflictFocus) {
                state.conflictFocus = false;
            }
            state.manualConflicts = [];
            state.conflictHelper = {
                selected: null,
                ours: '',
                theirs: '',
                status: '',
                loading: false,
                requestKey: null
            };
            const detail = {
                visible: false,
                files: [],
                selected: null,
                ours: '',
                theirs: '',
                status: '',
                loading: false
            };
            const presenter = getConflictHelperPresenter();
            presenter?.setState?.(detail);
            return;
        }
        const hasMultipleRepos = new Set(items.map((item) => item.repoPath)).size > 1;
        const files = items.map((item) => ({
            repoPath: item.repoPath,
            filePath: item.filePath,
            label: hasMultipleRepos ? `${item.repoLabel}: ${item.filePath}` : item.filePath
        }));

        let helperState = state.conflictHelper || {};
        let selected = helperState.selected;
        const selectedValid = selected && files.some((file) => file.repoPath === selected.repoPath && file.filePath === selected.filePath);
        if (!selectedValid) {
            selected = null;
        }
        let selectionChanged = false;
        if (!selected && files.length) {
            selected = { repoPath: files[0].repoPath, filePath: files[0].filePath };
            selectionChanged = true;
            helperState = {
                ...helperState,
                selected,
                ours: '',
                theirs: '',
                status: '',
                loading: false,
                requestKey: null
            };
            state.conflictHelper = helperState;
        }

        const detail = {
            visible: true,
            files,
            selected: helperState.selected || selected,
            ours: helperState.ours || '',
            theirs: helperState.theirs || '',
            status: helperState.status || '',
            loading: Boolean(helperState.loading)
        };
        const presenter = getConflictHelperPresenter();
        presenter?.setState?.(detail);

        if (selectionChanged && typeof selectConflictFile === 'function') {
            selectConflictFile(selected);
        }
    };

    const getRepoLabel = (repoPath) => {
        if (!repoPath) return '';
        const repo = Array.isArray(state.repoOverviews)
            ? state.repoOverviews.find((entry) => entry?.path === repoPath)
            : null;
        return repo?.name || repoPath.split('/').filter(Boolean).slice(-1)[0] || repoPath;
    };

    const updatePullBlockedPanel = () => {
        const presenter = element.querySelector('git-pull-blocked-panel')?.webSkelPresenter;
        if (!presenter) return;
        const blocked = state.pullBlocked;
        const files = Array.isArray(blocked?.files) ? blocked.files : [];
        if (!blocked || !files.length) {
            presenter.setState({ visible: false, files: [] });
            return;
        }
        const repoLabel = getRepoLabel(blocked.repoPath);
        const showRepo = Boolean(repoLabel);
        const list = files.filter(Boolean).map((filePath) => ({
            repoPath: blocked.repoPath || '',
            filePath,
            label: showRepo ? `${repoLabel}: ${filePath}` : filePath
        }));
        presenter.setState({
            visible: true,
            repoLabel,
            files: list
        });
    };

    const hasConflictsForRepos = (repoPaths) => {
        return collectConflictItems(repoPaths).length > 0;
    };

    const hasPullBlockedForRepos = (repoPaths) => {
        const blocked = state.pullBlocked;
        if (!blocked?.files?.length) return false;
        const repoPath = blocked.repoPath;
        if (!repoPath) return true;
        const list = Array.isArray(repoPaths) ? repoPaths : [];
        return list.includes(repoPath);
    };

    const updateCommitButtons = () => {
        const actionsButton = element.querySelector('#gitActionsButton');
        const messageOk = Boolean((state.commitMessage || '').trim());
        const selectedRepos = Array.from(new Set([
            ...Object.entries(state.selectedFilesByRepo || {})
                .filter(([, entry]) => (entry?.files && entry.files.size > 0) || (entry?.prefixes && entry.prefixes.size > 0))
                .map(([repoPath]) => repoPath)
        ]));
        const repoOk = state.repoInfoOk !== false;
        const identityBlocking = Boolean(state.identityPrompt?.visible);
        const authBlocking = Boolean(state.authPrompt?.visible);
        const ignoreBlocking = Boolean(state.ignorePrompt?.visible);
        const hasSelection = selectedRepos.length > 0;
        const conflictBlocking = hasConflictsForRepos(selectedRepos);
        const pullBlocked = hasPullBlockedForRepos(selectedRepos);
        const commitAllowed = !identityBlocking && !authBlocking && !ignoreBlocking && !conflictBlocking && !pullBlocked && hasSelection && messageOk;
        const pushAllowed = !identityBlocking && !authBlocking && !ignoreBlocking && (repoOk || hasSelection);
        const pullAllowed = !identityBlocking && !authBlocking && !ignoreBlocking && hasSelection;
        const disabled = !commitAllowed && !pushAllowed && !pullAllowed;
        const presenter = getCommitActionsPresenter();
        if (presenter?.setState) {
            presenter.setState({ actionsDisabled: disabled });
        } else if (actionsButton) {
            actionsButton.disabled = disabled;
        }
    };

    const updateCommitMessage = (input) => {
        const value = typeof input === 'string' ? input : (input?.value || '');
        state.commitMessage = value;
        const presenter = getCommitActionsPresenter();
        presenter?.setState?.({ commitMessage: value });
        updateCommitButtons();
    };

    const toggleActionsMenu = () => {
        const presenter = getCommitActionsPresenter();
        presenter?.toggleActionsMenu?.();
    };

    const closeActionsMenu = () => {
        const presenter = getCommitActionsPresenter();
        presenter?.closeActionsMenu?.();
    };

    const closeFileMenus = () => {
        const presenter = getRepoTreePresenter();
        presenter?.closeFileMenus?.();
    };

    const focusCommitMessage = () => {
        const presenter = getCommitActionsPresenter();
        presenter?.focusCommitMessage?.();
    };

    const toggleCredentials = () => {
        if (state.credentialsGate) {
            syncStaticUI();
            return;
        }
        state.credentialsOpen = !state.credentialsOpen;
        if (state.credentialsOpen) {
            closeActionsMenu();
        }
        syncStaticUI();
    };

    const closeCredentials = () => {
        if (!state.credentialsOpen) return;
        state.credentialsOpen = false;
        syncStaticUI();
    };

    return {
        bindEvents,
        syncStaticUI,
        updateIdentityPrompt,
        updateAuthPrompt,
        updateIgnorePrompt,
        updateCommitButtons,
        updateCommitMessage,
        toggleActionsMenu,
        closeActionsMenu,
        closeFileMenus,
        toggleCredentials,
        closeCredentials,
        focusCommitMessage,
        updateStatusBar,
        updateRepoTree
    };
}
