export function createGitCommitUI(ctx) {
    const {
        element,
        state,
        setMenuAbortController,
        runGitAction,
        openDiff,
        applyRepoPathFromInput,
        saveGitToken,
        cancelGitToken,
        saveGitIdentity,
        cancelGitIdentity,
        closeModal
    } = ctx;

    const bindEvents = () => {
        if (!element.dataset.boundDiffKeys) {
            element.addEventListener('keydown', (event) => {
                const key = event.key;
                if (key !== 'Enter' && key !== ' ') return;
                const target = event.target?.closest?.(
                    '.git-tree-file[data-local-action="openDiff"], ' +
                    '.git-menu-item[data-local-action^="runGitAction"]'
                );
                if (!target) return;
                event.preventDefault();
                const action = target.getAttribute('data-local-action') || '';
                if (action.startsWith('runGitAction')) {
                    const mode = action.split(/\s+/)[1] || '';
                    runGitAction(target, mode);
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

        const amendInput = element.querySelector('#gitCommitAmend');
        if (amendInput && !amendInput.dataset.bound) {
            // WebSkel handles via `data-local-action="toggleAmend"`.
            amendInput.dataset.bound = 'true';
        }

        const signoffInput = element.querySelector('#gitCommitSignoff');
        if (signoffInput && !signoffInput.dataset.bound) {
            // WebSkel handles via `data-local-action="toggleSignoff"`.
            signoffInput.dataset.bound = 'true';
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
                closeMenuIfOutside(state.settingsMenuOpen, '#gitSettingsSplit', () => closeSettingsMenu());
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
            element.addEventListener('git-auth-submit', (event) => {
                saveGitToken(event?.detail || {});
            });
            element.addEventListener('git-auth-cancel', () => {
                cancelGitToken();
            });
            element.addEventListener('git-auth-change', (event) => {
                const detail = event?.detail || {};
                state.authPrompt = {
                    ...state.authPrompt,
                    token: String(detail.token ?? state.authPrompt?.token ?? ''),
                    remember: typeof detail.remember === 'boolean' ? detail.remember : Boolean(state.authPrompt?.remember)
                };
            });
            element.addEventListener('git-identity-submit', (event) => {
                saveGitIdentity(event?.detail || {});
            });
            element.addEventListener('git-identity-cancel', () => {
                cancelGitIdentity();
            });
            element.addEventListener('git-identity-change', (event) => {
                const detail = event?.detail || {};
                state.identityPrompt = {
                    ...state.identityPrompt,
                    name: String(detail.name ?? state.identityPrompt?.name ?? ''),
                    email: String(detail.email ?? state.identityPrompt?.email ?? '')
                };
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

        updateIdentityPrompt();

        const actionsMenu = element.querySelector('#gitActionsMenu');
        if (actionsMenu) {
            actionsMenu.style.display = state.actionsMenuOpen ? '' : 'none';
        }

        const settingsMenu = element.querySelector('#gitSettingsMenu');
        if (settingsMenu) {
            settingsMenu.style.display = state.settingsMenuOpen ? '' : 'none';
        }

        updateAuthPrompt();
    };

    const getIdentityPromptPresenter = () => element.querySelector('git-identity-prompt')?.webSkelPresenter || null;
    const getAuthPromptPresenter = () => element.querySelector('git-auth-prompt')?.webSkelPresenter || null;

    const updateIdentityPrompt = (options = {}) => {
        const promptState = state.identityPrompt || {};
        const detail = {
            visible: Boolean(promptState.visible),
            name: promptState.name || '',
            email: promptState.email || ''
        };
        if (options.focus) detail.focus = options.focus;
        const presenter = getIdentityPromptPresenter();
        if (presenter?.setState) {
            presenter.setState(detail);
            return;
        }
        const target = element.querySelector('git-identity-prompt');
        target?.dispatchEvent?.(new CustomEvent('git-identity-update', { detail }));
    };

    const updateAuthPrompt = (options = {}) => {
        const promptState = state.authPrompt || {};
        const detail = {
            visible: Boolean(promptState.visible),
            token: promptState.token || '',
            remember: Boolean(promptState.remember)
        };
        if (options.focus) detail.focus = options.focus;
        const presenter = getAuthPromptPresenter();
        if (presenter?.setState) {
            presenter.setState(detail);
            return;
        }
        const target = element.querySelector('git-auth-prompt');
        target?.dispatchEvent?.(new CustomEvent('git-auth-update', { detail }));
    };

    const updateCommitButtons = () => {
        const actionsButton = element.querySelector('#gitActionsButton');
        const messageOk = Boolean((state.commitMessage || '').trim()) || state.amend;
        const selectedRepos = Array.from(new Set([
            ...Object.entries(state.selectedFilesByRepo || {})
                .filter(([, entry]) => (entry?.files && entry.files.size > 0) || (entry?.prefixes && entry.prefixes.size > 0))
                .map(([repoPath]) => repoPath)
        ]));
        const repoOk = state.repoInfoOk !== false;
        const identityBlocking = Boolean(state.identityPrompt?.visible);
        const authBlocking = Boolean(state.authPrompt?.visible);
        const hasSelection = selectedRepos.length > 0;
        const commitAllowed = !identityBlocking && !authBlocking && hasSelection && messageOk;
        const pushAllowed = !identityBlocking && !authBlocking && (repoOk || hasSelection);
        const pullAllowed = !identityBlocking && !authBlocking && hasSelection;
        if (actionsButton) {
            actionsButton.disabled = !commitAllowed && !pushAllowed && !pullAllowed;
        }
    };

    const updateCommitMessage = (input) => {
        state.commitMessage = input?.value || '';
        updateCommitButtons();
    };

    const toggleAmend = (input) => {
        state.amend = Boolean(input?.checked);
        updateCommitButtons();
    };

    const toggleSignoff = (input) => {
        state.signoff = Boolean(input?.checked);
    };

    const toggleActionsMenu = () => {
        state.actionsMenuOpen = !state.actionsMenuOpen;
        if (state.actionsMenuOpen) {
            closeSettingsMenu();
        }
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

    const toggleSettingsMenu = () => {
        state.settingsMenuOpen = !state.settingsMenuOpen;
        if (state.settingsMenuOpen) {
            closeActionsMenu();
        }
        syncStaticUI();
        if (state.settingsMenuOpen) {
            setTimeout(() => element.querySelector('#gitSettingsMenu .git-menu-item')?.focus?.(), 0);
        }
    };

    const closeSettingsMenu = () => {
        if (!state.settingsMenuOpen) return;
        state.settingsMenuOpen = false;
        syncStaticUI();
    };

    return {
        bindEvents,
        syncStaticUI,
        updateIdentityPrompt,
        updateAuthPrompt,
        updateCommitButtons,
        updateCommitMessage,
        toggleAmend,
        toggleSignoff,
        toggleActionsMenu,
        closeActionsMenu,
        toggleSettingsMenu,
        closeSettingsMenu
    };
}
