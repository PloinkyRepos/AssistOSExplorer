export class GitAuthPrompt {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.state = { visible: false, token: '', remember: false };
        this.onUpdate = this.onUpdate.bind(this);
        this.onTokenKeydown = this.onTokenKeydown.bind(this);
        this.onTokenInput = this.onTokenInput.bind(this);
        this.onRememberChange = this.onRememberChange.bind(this);
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.root = this.element.querySelector('#gitAuthPrompt') || this.element;
        this.tokenInput = this.element.querySelector('#gitAuthToken');
        this.rememberInput = this.element.querySelector('#gitAuthRemember');

        if (this.tokenInput && !this.tokenInput.dataset.boundAuthInput) {
            this.tokenInput.addEventListener('input', this.onTokenInput);
            this.tokenInput.dataset.boundAuthInput = 'true';
        }
        if (this.rememberInput && !this.rememberInput.dataset.boundAuthInput) {
            this.rememberInput.addEventListener('change', this.onRememberChange);
            this.rememberInput.dataset.boundAuthInput = 'true';
        }

        if (this.tokenInput && !this.tokenInput.dataset.boundAuthKeydown) {
            this.tokenInput.addEventListener('keydown', this.onTokenKeydown);
            this.tokenInput.dataset.boundAuthKeydown = 'true';
        }

        if (!this.element.dataset.boundAuthUpdate) {
            this.element.addEventListener('git-auth-update', this.onUpdate);
            this.element.dataset.boundAuthUpdate = 'true';
        }

        this.applyState(this.state);
    }

    cancelGitToken() {
        this.emit('git-auth-cancel');
    }

    saveGitToken() {
        const token = (this.tokenInput?.value || '').trim();
        const remember = Boolean(this.rememberInput?.checked);
        this.state.token = token;
        this.state.remember = remember;
        this.emit('git-auth-submit', { token, remember });
    }

    setState(next = {}) {
        this.applyState(next);
    }

    onUpdate(event) {
        this.applyState(event?.detail || {});
    }

    applyState(next) {
        if (!next || typeof next !== 'object') return;
        if (Object.prototype.hasOwnProperty.call(next, 'visible')) {
            this.state.visible = Boolean(next.visible);
        }
        if (Object.prototype.hasOwnProperty.call(next, 'token')) {
            this.state.token = String(next.token || '');
        }
        if (Object.prototype.hasOwnProperty.call(next, 'remember')) {
            this.state.remember = Boolean(next.remember);
        }

        if (this.root) {
            this.root.style.display = this.state.visible ? '' : 'none';
        }
        if (this.tokenInput && this.tokenInput.value !== this.state.token) {
            this.tokenInput.value = this.state.token;
        }
        if (this.rememberInput) {
            this.rememberInput.checked = this.state.remember;
        }

        if (next.focus === 'token') {
            setTimeout(() => this.tokenInput?.focus?.(), 0);
        }
    }

    onTokenKeydown(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            this.saveGitToken();
        }
    }

    onTokenInput() {
        const token = (this.tokenInput?.value || '').trim();
        this.state.token = token;
        this.emit('git-auth-change', { token, remember: Boolean(this.rememberInput?.checked) });
    }

    onRememberChange() {
        const remember = Boolean(this.rememberInput?.checked);
        this.state.remember = remember;
        this.emit('git-auth-change', { token: (this.tokenInput?.value || '').trim(), remember });
    }

    emit(name, detail = {}) {
        this.element.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
    }
}
