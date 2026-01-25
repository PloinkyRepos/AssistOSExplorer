export class GitCommitBody {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.state = {
            visible: true,
            repoPath: '',
            advancedMode: false
        };
        this.boundActions = false;
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.repoPathInput = this.element.querySelector('#gitRepoPathInput');
        this.advancedModeInput = this.element.querySelector('#gitAdvancedMode');
        this.bindEvents();
        this.applyState(this.state);
        const parent = this.getParentPresenter();
        parent?.updateCommitButtons?.();
        parent?.syncStaticUI?.();
    }

    bindEvents() {
        if (this.boundActions) return;
        if (this.repoPathInput) {
            this.repoPathInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    this.applyRepoPathFromInput();
                }
            });
        }
        if (this.advancedModeInput) {
            this.advancedModeInput.addEventListener('change', () => {
                this.toggleAdvancedMode();
            });
        }
        this.boundActions = true;
    }


    setState(next = {}) {
        this.applyState(next);
    }

    applyState(next = {}) {
        if (Object.prototype.hasOwnProperty.call(next, 'visible')) {
            this.state.visible = Boolean(next.visible);
        }
        if (Object.prototype.hasOwnProperty.call(next, 'repoPath')) {
            this.state.repoPath = String(next.repoPath || '');
        }
        if (Object.prototype.hasOwnProperty.call(next, 'advancedMode')) {
            this.state.advancedMode = Boolean(next.advancedMode);
        }
        this.element.classList.toggle('is-hidden', !this.state.visible);
        const commitSection = this.element.querySelector('.git-commit');
        if (commitSection) {
            commitSection.classList.toggle('advanced-mode', this.state.advancedMode);
        }
        if (this.repoPathInput && this.repoPathInput.value !== this.state.repoPath) {
            this.repoPathInput.value = this.state.repoPath;
        }
        if (this.advancedModeInput) {
            this.advancedModeInput.checked = this.state.advancedMode;
        }
    }

    applyRepoPathFromInput() {
        const value = String(this.repoPathInput?.value || '').trim();
        this.getParentPresenter()?.applyRepoPathFromInput?.(value);
    }

    refreshAction() {
        this.getParentPresenter()?.refreshAction?.();
    }

    toggleAdvancedMode() {
        const next = Boolean(this.advancedModeInput?.checked);
        this.state.advancedMode = next;
        const commitSection = this.element.querySelector('.git-commit');
        if (commitSection) {
            commitSection.classList.toggle('advanced-mode', next);
        }
    }

    getParentPresenter() {
        return this.element.closest('git-commit-modal')?.webSkelPresenter || null;
    }
}
