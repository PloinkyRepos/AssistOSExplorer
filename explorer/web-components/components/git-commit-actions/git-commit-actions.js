export class GitCommitActions {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.state = {
            commitMessage: '',
            actionsMenuOpen: false,
            actionsDisabled: false
        };
        this.boundActions = false;
        this.onKeydown = this.onKeydown.bind(this);
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.commitMessageInput = this.element.querySelector('#gitCommitMessage');
        this.actionsMenu = this.element.querySelector('#gitActionsMenu');
        this.actionsButton = this.element.querySelector('#gitActionsButton');
        this.actionsSplit = this.element.querySelector('#gitActionsSplit');

        this.bindEvents();
        this.applyState(this.state);
    }

    bindEvents() {
        if (this.boundActions) return;
        this.element.addEventListener('keydown', this.onKeydown);
        this.element.addEventListener('click', (event) => {
            const info = event.target?.closest?.('.git-menu-info');
            if (!info) return;
            event.preventDefault();
            event.stopPropagation();
        }, true);
        this.element.addEventListener('keydown', (event) => {
            const info = event.target?.closest?.('.git-menu-info');
            if (!info) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            event.stopPropagation();
        }, true);

        if (this.commitMessageInput) {
            this.commitMessageInput.addEventListener('input', (event) => {
                const value = event?.target?.value || '';
                this.updateCommitMessage(null, value);
            });
        }

        this.boundActions = true;
    }

    onKeydown(event) {
        const key = event.key;
        if (key !== 'Enter' && key !== ' ') return;
        const target = event.target?.closest?.('.git-menu-item[data-local-action^="runGitAction"]');
        if (!target) return;
        event.preventDefault();
        const action = target.getAttribute('data-local-action') || '';
        if (!action.startsWith('runGitAction')) return;
        const mode = action.split(/\s+/)[1] || '';
        this.runGitAction(target, mode);
    }

    setState(next = {}) {
        this.applyState(next);
    }

    applyState(next = {}) {
        if (Object.prototype.hasOwnProperty.call(next, 'commitMessage')) {
            this.state.commitMessage = String(next.commitMessage || '');
        }
        if (Object.prototype.hasOwnProperty.call(next, 'actionsMenuOpen')) {
            this.state.actionsMenuOpen = Boolean(next.actionsMenuOpen);
        }
        if (Object.prototype.hasOwnProperty.call(next, 'actionsDisabled')) {
            this.state.actionsDisabled = Boolean(next.actionsDisabled);
        }
        if (this.commitMessageInput && this.commitMessageInput.value !== this.state.commitMessage) {
            this.commitMessageInput.value = this.state.commitMessage;
        }
        if (this.actionsMenu) {
            this.actionsMenu.style.display = this.state.actionsMenuOpen ? '' : 'none';
        }
        if (this.actionsButton) {
            this.actionsButton.disabled = this.state.actionsDisabled;
        }
    }

    updateCommitMessage(_element, value) {
        const nextValue = typeof value === 'string' ? value : this.commitMessageInput?.value || '';
        this.state.commitMessage = nextValue;
        this.getParentPresenter()?.updateCommitMessageDraft?.(nextValue);
    }

    generateCommitMessage() {
        this.getParentPresenter()?.generateCommitMessage?.();
    }

    toggleActionsMenu() {
        this.state.actionsMenuOpen = !this.state.actionsMenuOpen;
        this.applyState(this.state);
        if (this.state.actionsMenuOpen) {
            setTimeout(() => this.actionsMenu?.querySelector?.('.git-menu-item')?.focus?.(), 0);
        }
    }

    closeActionsMenu() {
        if (!this.state.actionsMenuOpen) return;
        this.state.actionsMenuOpen = false;
        this.applyState(this.state);
    }

    runGitAction(element, mode) {
        this.closeActionsMenu();
        this.getParentPresenter()?.runGitAction?.(element, mode);
    }

    focusCommitMessage() {
        this.commitMessageInput?.focus?.();
    }

    getParentPresenter() {
        return this.element.closest('git-commit-modal')?.webSkelPresenter || null;
    }
}
