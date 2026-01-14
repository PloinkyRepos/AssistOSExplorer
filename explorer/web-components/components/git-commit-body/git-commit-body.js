export class GitCommitBody {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.state = {
            visible: true,
            repoPath: ''
        };
        this.boundActions = false;
        this.onUpdate = this.onUpdate.bind(this);
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.repoPathInput = this.element.querySelector('#gitRepoPathInput');
        this.bindEvents();
        if (!this.element.dataset.boundCommitBody) {
            this.element.addEventListener('git-commit-body-update', this.onUpdate);
            this.element.dataset.boundCommitBody = 'true';
        }
        this.applyState(this.state);
        this.emit('git-commit-body-ready');
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
        this.boundActions = true;
    }


    setState(next = {}) {
        this.applyState(next);
    }

    onUpdate(event) {
        this.applyState(event?.detail || {});
    }

    applyState(next = {}) {
        if (Object.prototype.hasOwnProperty.call(next, 'visible')) {
            this.state.visible = Boolean(next.visible);
        }
        if (Object.prototype.hasOwnProperty.call(next, 'repoPath')) {
            this.state.repoPath = String(next.repoPath || '');
        }
        this.element.classList.toggle('is-hidden', !this.state.visible);
        if (this.repoPathInput && this.repoPathInput.value !== this.state.repoPath) {
            this.repoPathInput.value = this.state.repoPath;
        }
    }

    applyRepoPathFromInput() {
        const value = String(this.repoPathInput?.value || '').trim();
        this.emitAction('applyRepoPathFromInput', { value });
    }

    refreshAction() {
        this.emitAction('refreshAction');
    }


    emit(name, detail = {}) {
        this.element.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
    }

    emitAction(action, payload = {}) {
        this.emit('git-commit-body-action', { action, ...payload });
    }
}
