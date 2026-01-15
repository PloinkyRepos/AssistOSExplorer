export class GitCredentialsPrompt {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.state = { visible: false, name: '', email: '', token: '', remember: false, autocommitEnabled: true, autocommitIntervalMinutes: 15 };
        this.onUpdate = this.onUpdate.bind(this);
        this.onIdentityInput = this.onIdentityInput.bind(this);
        this.onTokenInput = this.onTokenInput.bind(this);
        this.onTokenKeydown = this.onTokenKeydown.bind(this);
        this.onRememberChange = this.onRememberChange.bind(this);
        this.onAutocommitChange = this.onAutocommitChange.bind(this);
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.root = this.element.querySelector('#gitCredentialsPrompt') || this.element;
        this.nameInput = this.element.querySelector('#gitCredentialsName');
        this.emailInput = this.element.querySelector('#gitCredentialsEmail');
        this.tokenInput = this.element.querySelector('#gitCredentialsToken');
        this.rememberInput = this.element.querySelector('#gitCredentialsRemember');
        this.autocommitEnabledInput = this.element.querySelector('#gitCredentialsAutocommitEnabled');
        this.autocommitIntervalInput = this.element.querySelector('#gitCredentialsAutocommitInterval');

        if (this.nameInput && !this.nameInput.dataset.boundCredentialsInput) {
            this.nameInput.addEventListener('input', this.onIdentityInput);
            this.nameInput.dataset.boundCredentialsInput = 'true';
        }
        if (this.emailInput && !this.emailInput.dataset.boundCredentialsInput) {
            this.emailInput.addEventListener('input', this.onIdentityInput);
            this.emailInput.dataset.boundCredentialsInput = 'true';
        }
        if (this.tokenInput && !this.tokenInput.dataset.boundCredentialsInput) {
            this.tokenInput.addEventListener('input', this.onTokenInput);
            this.tokenInput.dataset.boundCredentialsInput = 'true';
        }
        if (this.rememberInput && !this.rememberInput.dataset.boundCredentialsInput) {
            this.rememberInput.addEventListener('change', this.onRememberChange);
            this.rememberInput.dataset.boundCredentialsInput = 'true';
        }
        if (this.autocommitEnabledInput && !this.autocommitEnabledInput.dataset.boundCredentialsInput) {
            this.autocommitEnabledInput.addEventListener('change', this.onAutocommitChange);
            this.autocommitEnabledInput.dataset.boundCredentialsInput = 'true';
        }
        if (this.autocommitIntervalInput && !this.autocommitIntervalInput.dataset.boundCredentialsInput) {
            this.autocommitIntervalInput.addEventListener('input', this.onAutocommitChange);
            this.autocommitIntervalInput.dataset.boundCredentialsInput = 'true';
        }
        if (this.tokenInput && !this.tokenInput.dataset.boundCredentialsKeydown) {
            this.tokenInput.addEventListener('keydown', this.onTokenKeydown);
            this.tokenInput.dataset.boundCredentialsKeydown = 'true';
        }

        if (!this.element.dataset.boundCredentialsUpdate) {
            this.element.addEventListener('git-credentials-update', this.onUpdate);
            this.element.dataset.boundCredentialsUpdate = 'true';
        }

        this.applyState(this.state);
    }

    saveGitCredentials() {
        const name = (this.nameInput?.value || '').trim();
        const email = (this.emailInput?.value || '').trim();
        const token = (this.tokenInput?.value || '').trim();
        const remember = Boolean(this.rememberInput?.checked);
        const autocommitEnabled = Boolean(this.autocommitEnabledInput?.checked);
        const intervalRaw = this.autocommitIntervalInput?.value;
        const autocommitIntervalMinutes = Math.max(1, Math.floor(Number(intervalRaw || 15)));
        this.state.name = name;
        this.state.email = email;
        this.state.token = token;
        this.state.remember = remember;
        this.state.autocommitEnabled = autocommitEnabled;
        this.state.autocommitIntervalMinutes = autocommitIntervalMinutes;
        this.emit('git-credentials-submit', { name, email, token, remember, autocommitEnabled, autocommitIntervalMinutes });
    }

    cancelGitCredentials() {
        this.emit('git-credentials-cancel');
    }

    setState(next = {}) {
        this.applyState(next);
    }

    onUpdate(event) {
        this.applyState(event?.detail || {});
    }

    onIdentityInput() {
        const name = (this.nameInput?.value || '').trim();
        const email = (this.emailInput?.value || '').trim();
        this.state.name = name;
        this.state.email = email;
        this.emit('git-credentials-change', {
            name,
            email,
            token: this.state.token,
            remember: this.state.remember,
            autocommitEnabled: this.state.autocommitEnabled,
            autocommitIntervalMinutes: this.state.autocommitIntervalMinutes
        });
    }

    onTokenInput() {
        const token = (this.tokenInput?.value || '').trim();
        const remember = Boolean(this.rememberInput?.checked);
        this.state.token = token;
        this.state.remember = remember;
        this.emit('git-credentials-change', {
            name: this.state.name,
            email: this.state.email,
            token,
            remember,
            autocommitEnabled: this.state.autocommitEnabled,
            autocommitIntervalMinutes: this.state.autocommitIntervalMinutes
        });
    }

    onRememberChange() {
        const remember = Boolean(this.rememberInput?.checked);
        this.state.remember = remember;
        this.emit('git-credentials-change', {
            name: this.state.name,
            email: this.state.email,
            token: this.state.token,
            remember,
            autocommitEnabled: this.state.autocommitEnabled,
            autocommitIntervalMinutes: this.state.autocommitIntervalMinutes
        });
    }

    onAutocommitChange() {
        const autocommitEnabled = Boolean(this.autocommitEnabledInput?.checked);
        const intervalRaw = this.autocommitIntervalInput?.value;
        const autocommitIntervalMinutes = Math.max(1, Math.floor(Number(intervalRaw || 15)));
        this.state.autocommitEnabled = autocommitEnabled;
        this.state.autocommitIntervalMinutes = autocommitIntervalMinutes;
        this.emit('git-credentials-change', {
            name: this.state.name,
            email: this.state.email,
            token: this.state.token,
            remember: this.state.remember,
            autocommitEnabled,
            autocommitIntervalMinutes
        });
    }

    onTokenKeydown(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            this.saveGitCredentials();
        }
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
        if (Object.prototype.hasOwnProperty.call(next, 'token')) {
            this.state.token = String(next.token || '');
        }
        if (Object.prototype.hasOwnProperty.call(next, 'remember')) {
            this.state.remember = Boolean(next.remember);
        }
        if (Object.prototype.hasOwnProperty.call(next, 'autocommitEnabled')) {
            this.state.autocommitEnabled = Boolean(next.autocommitEnabled);
        }
        if (Object.prototype.hasOwnProperty.call(next, 'autocommitIntervalMinutes')) {
            const parsed = Number(next.autocommitIntervalMinutes);
            if (Number.isFinite(parsed)) {
                this.state.autocommitIntervalMinutes = Math.max(1, Math.floor(parsed));
            }
        }

        this.element.classList.toggle('is-visible', this.state.visible);
        if (this.nameInput && this.nameInput.value !== this.state.name) {
            this.nameInput.value = this.state.name;
        }
        if (this.emailInput && this.emailInput.value !== this.state.email) {
            this.emailInput.value = this.state.email;
        }
        if (this.tokenInput && this.tokenInput.value !== this.state.token) {
            this.tokenInput.value = this.state.token;
        }
        if (this.rememberInput) {
            this.rememberInput.checked = this.state.remember;
        }
        if (this.autocommitEnabledInput) {
            this.autocommitEnabledInput.checked = this.state.autocommitEnabled;
        }
        if (this.autocommitIntervalInput) {
            const nextValue = String(this.state.autocommitIntervalMinutes || 15);
            if (this.autocommitIntervalInput.value !== nextValue) {
                this.autocommitIntervalInput.value = nextValue;
            }
        }

        if (next.focus === 'name') {
            setTimeout(() => this.nameInput?.focus?.(), 0);
        } else if (next.focus === 'email') {
            setTimeout(() => this.emailInput?.focus?.(), 0);
        } else if (next.focus === 'token') {
            setTimeout(() => this.tokenInput?.focus?.(), 0);
        }
    }

    emit(name, detail = {}) {
        this.element.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
    }
}
