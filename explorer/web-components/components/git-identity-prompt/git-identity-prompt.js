export class GitIdentityPrompt {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.state = { visible: false, name: '', email: '' };
        this.onUpdate = this.onUpdate.bind(this);
        this.onInputChange = this.onInputChange.bind(this);
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.root = this.element.querySelector('#gitIdentityPrompt') || this.element;
        this.nameInput = this.element.querySelector('#gitIdentityName');
        this.emailInput = this.element.querySelector('#gitIdentityEmail');

        if (this.nameInput && !this.nameInput.dataset.boundIdentityInput) {
            this.nameInput.addEventListener('input', this.onInputChange);
            this.nameInput.dataset.boundIdentityInput = 'true';
        }
        if (this.emailInput && !this.emailInput.dataset.boundIdentityInput) {
            this.emailInput.addEventListener('input', this.onInputChange);
            this.emailInput.dataset.boundIdentityInput = 'true';
        }

        if (!this.element.dataset.boundIdentityUpdate) {
            this.element.addEventListener('git-identity-update', this.onUpdate);
            this.element.dataset.boundIdentityUpdate = 'true';
        }

        this.applyState(this.state);
    }

    saveGitIdentity(_element, scope) {
        const name = (this.nameInput?.value || '').trim();
        const email = (this.emailInput?.value || '').trim();
        this.state.name = name;
        this.state.email = email;
        this.emit('git-identity-submit', { scope, name, email });
    }

    cancelGitIdentity() {
        this.emit('git-identity-cancel');
    }

    setState(next = {}) {
        this.applyState(next);
    }

    onUpdate(event) {
        this.applyState(event?.detail || {});
    }

    onInputChange() {
        const name = (this.nameInput?.value || '').trim();
        const email = (this.emailInput?.value || '').trim();
        this.state.name = name;
        this.state.email = email;
        this.emit('git-identity-change', { name, email });
    }

    applyState(next) {
        if (!next || typeof next !== 'object') return;
        if (Object.prototype.hasOwnProperty.call(next, 'visible')) {
            this.state.visible = Boolean(next.visible);
        }
        if (Object.prototype.hasOwnProperty.call(next, 'name')) {
            this.state.name = String(next.name || '');
        }
        if (Object.prototype.hasOwnProperty.call(next, 'email')) {
            this.state.email = String(next.email || '');
        }

        if (this.root) {
            this.root.style.display = this.state.visible ? '' : 'none';
        }
        if (this.nameInput && this.nameInput.value !== this.state.name) {
            this.nameInput.value = this.state.name;
        }
        if (this.emailInput && this.emailInput.value !== this.state.email) {
            this.emailInput.value = this.state.email;
        }

        if (next.focus === 'name') {
            setTimeout(() => this.nameInput?.focus?.(), 0);
        } else if (next.focus === 'email') {
            setTimeout(() => this.emailInput?.focus?.(), 0);
        }
    }

    emit(name, detail = {}) {
        this.element.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
    }
}
