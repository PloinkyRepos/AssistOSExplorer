export function createGitCommitUI(ctx) {
    const {
        element,
        state,
        setMenuAbortController,
        runGitAction,
        openDiff,
        applyRepoPathFromInput,
        saveGitCredentials,
        cancelGitCredentials,
        saveGitIgnore,
        cancelGitIgnore,
        setIgnoreMode,
        setIgnoreAnchor,
        openIgnoreForDiff,
        closeFileMenus,
        closeModal
    } = ctx;

    const bindEvents = () => {
        if (!element.dataset.boundDiffKeys) {
            element.addEventListener('keydown', (event) => {
                const key = event.key;
                if (key !== 'Enter' && key !== ' ') return;
                const target = event.target?.closest?.(
                    '.git-tree-file[data-local-action="openDiff"], ' +
                    '.git-menu-item[data-local-action^="runGitAction"], ' +
                    '.git-file-menu-item[data-local-action]'
                );
                if (!target) return;
                event.preventDefault();
                const action = target.getAttribute('data-local-action') || '';
                if (action.startsWith('runGitAction')) {
                    const mode = action.split(/\s+/)[1] || '';
                    runGitAction(target, mode);
                    return;
                }
                if (target.classList.contains('git-file-menu-item')) {
                    target.click();
                    return;
                }
                openDiff(target);
            });
            element.dataset.boundDiffKeys = 'true';
        }

        const repoPathInput = element.querySelector('#gitRepoPathInput');
        if (repoPathInput && !repoPathInput.dataset.bound) {
            repoPathInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    applyRepoPathFromInput();
                }
            });
            repoPathInput.dataset.bound = 'true';
        }

        const commitMessage = element.querySelector('#gitCommitMessage');
        if (commitMessage && !commitMessage.dataset.bound) {
            commitMessage.addEventListener('input', (event) => {
                updateCommitMessage(event.target);
            });
            commitMessage.dataset.bound = 'true';
        }

        if (!element.dataset.boundCommitMenu) {
            const closeIfOutside = (event) => {
                const closeMenuIfOutside = (isOpen, rootSelector, closeFn) => {
                    if (!isOpen) return;
                    const root = element.querySelector(rootSelector);
                    const inside = root && (event.target === root || root.contains(event.target));
                    if (!inside) closeFn();
                };
                closeMenuIfOutside(state.actionsMenuOpen, '#gitActionsSplit', () => closeActionsMenu());
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
        const repoPathInput = element.querySelector('#gitRepoPathInput');
        if (repoPathInput && repoPathInput.value !== state.repoPath) {
            repoPathInput.value = state.repoPath;
        }

        const actionsMenu = element.querySelector('#gitActionsMenu');
        if (actionsMenu) {
            actionsMenu.style.display = state.actionsMenuOpen ? '' : 'none';
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
        updateIgnorePrompt();
    };

    const getCredentialsPromptPresenter = () => element.querySelector('git-credentials-prompt')?.webSkelPresenter || null;
    const getIgnorePromptPresenter = () => element.querySelector('git-ignore-prompt')?.webSkelPresenter || null;

    const updateCredentialsPrompt = (options = {}) => {
        const identityState = state.identityPrompt || {};
        const authState = state.authPrompt || {};
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
            remember: Boolean(authState.remember)
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
        const commitAllowed = !identityBlocking && !authBlocking && !ignoreBlocking && hasSelection && messageOk;
        const pushAllowed = !identityBlocking && !authBlocking && !ignoreBlocking && (repoOk || hasSelection);
        const pullAllowed = !identityBlocking && !authBlocking && !ignoreBlocking && hasSelection;
        if (actionsButton) {
            actionsButton.disabled = !commitAllowed && !pushAllowed && !pullAllowed;
        }
    };

    const updateCommitMessage = (input) => {
        state.commitMessage = input?.value || '';
        updateCommitButtons();
    };

    const toggleActionsMenu = () => {
        state.actionsMenuOpen = !state.actionsMenuOpen;
        syncStaticUI();
        if (state.actionsMenuOpen) {
            setTimeout(() => element.querySelector('#gitActionsMenu .git-menu-item')?.focus?.(), 0);
        }
    };

    const closeActionsMenu = () => {
        if (!state.actionsMenuOpen) return;
        state.actionsMenuOpen = false;
        syncStaticUI();
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
        toggleCredentials,
        closeCredentials
    };
}
