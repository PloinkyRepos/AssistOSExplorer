export class GitCredentialsPrompt {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.state = {
            visible: false,
            name: '',
            email: '',
            token: '',
            remember: true,
            credentialsValidated: false,
            credentialsDirty: false,
            autocommitDirty: false,
            tokenStored: false,
            autocommitIntervalMinutes: 15,
            autocommitRepos: [],
            autocommitSelected: null,
            autoresolveConflicts: false,
            autoresolveDirty: false
        };
        this.onIdentityInput = this.onIdentityInput.bind(this);
        this.onTokenInput = this.onTokenInput.bind(this);
        this.onTokenKeydown = this.onTokenKeydown.bind(this);
        this.onRememberChange = this.onRememberChange.bind(this);
        this.onAutocommitChange = this.onAutocommitChange.bind(this);
        this.onAutocommitReposChange = this.onAutocommitReposChange.bind(this);
        this.onAutoresolveChange = this.onAutoresolveChange.bind(this);
        this.scheduleValidation = this.scheduleValidation.bind(this);
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.root = this.element.querySelector('#gitCredentialsPrompt') || this.element;
        this.nameInput = this.element.querySelector('#gitCredentialsName');
        this.emailInput = this.element.querySelector('#gitCredentialsEmail');
        this.tokenInput = this.element.querySelector('#gitCredentialsToken');
        this.rememberInput = this.element.querySelector('#gitCredentialsRemember');
        this.autocommitIntervalInput = this.element.querySelector('#gitCredentialsAutocommitInterval');
        this.autocommitReposContainer = this.element.querySelector('#gitCredentialsAutocommitRepos');
        this.autoresolveInput = this.element.querySelector('#gitCredentialsAutoresolve');
        this.saveButton = this.element.querySelector('[data-local-action="saveGitCredentials"]');

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
        if (this.autocommitIntervalInput && !this.autocommitIntervalInput.dataset.boundCredentialsInput) {
            this.autocommitIntervalInput.addEventListener('input', this.onAutocommitChange);
            this.autocommitIntervalInput.dataset.boundCredentialsInput = 'true';
        }
        if (this.autocommitReposContainer && !this.autocommitReposContainer.dataset.boundCredentialsInput) {
            this.autocommitReposContainer.addEventListener('change', this.onAutocommitReposChange);
            this.autocommitReposContainer.dataset.boundCredentialsInput = 'true';
        }
        if (this.autoresolveInput && !this.autoresolveInput.dataset.boundCredentialsInput) {
            this.autoresolveInput.addEventListener('change', this.onAutoresolveChange);
            this.autoresolveInput.dataset.boundCredentialsInput = 'true';
        }
        if (this.tokenInput && !this.tokenInput.dataset.boundCredentialsKeydown) {
            this.tokenInput.addEventListener('keydown', this.onTokenKeydown);
            this.tokenInput.dataset.boundCredentialsKeydown = 'true';
        }
        this.applyState(this.state);
    }

    saveGitCredentials() {
        if (!this.isCredentialsValid()) return;
        const name = (this.nameInput?.value || '').trim();
        const email = (this.emailInput?.value || '').trim();
        const token = (this.tokenInput?.value || '').trim();
        const remember = Boolean(this.rememberInput?.checked);
        const intervalRaw = this.autocommitIntervalInput?.value;
        const autocommitIntervalMinutes = Math.max(1, Math.floor(Number(intervalRaw || 15)));
        const autocommitRepos = this.getSelectedAutocommitRepos();
        const autoresolveConflicts = Boolean(this.autoresolveInput?.checked);
        this.state.name = name;
        this.state.email = email;
        this.state.token = token;
        this.state.remember = remember;
        this.state.autocommitIntervalMinutes = autocommitIntervalMinutes;
        this.state.autocommitSelected = autocommitRepos;
        this.state.autoresolveConflicts = autoresolveConflicts;
        this.getParentPresenter()?.saveGitCredentials?.({
            name,
            email,
            token,
            remember,
            autocommitIntervalMinutes,
            autocommitRepos,
            autoresolveConflicts
        });
    }

    cancelGitCredentials() {
        this.getParentPresenter()?.cancelGitCredentials?.();
    }

    setState(next = {}) {
        this.applyState(next);
    }

    onIdentityInput() {
        const name = (this.nameInput?.value || '').trim();
        const email = (this.emailInput?.value || '').trim();
        this.state.name = name;
        this.state.email = email;
        this.state.credentialsValidated = false;
        this.state.credentialsDirty = true;
        this.updateValidationState();
        this.renderAutocommitRepos();
        this.scheduleValidation();
        this.getParentPresenter()?.handleCredentialsChange?.({
            name,
            email,
            token: this.state.token,
            remember: this.state.remember,
            autocommitIntervalMinutes: this.state.autocommitIntervalMinutes,
            autocommitRepos: this.state.autocommitSelected,
            autoresolveConflicts: this.state.autoresolveConflicts,
            credentialsDirty: true
        });
    }

    onTokenInput() {
        const token = (this.tokenInput?.value || '').trim();
        const remember = Boolean(this.rememberInput?.checked);
        this.state.token = token;
        this.state.remember = remember;
        this.state.credentialsValidated = false;
        this.state.credentialsDirty = true;
        this.updateValidationState();
        this.renderAutocommitRepos();
        this.scheduleValidation();
        this.getParentPresenter()?.handleCredentialsChange?.({
            name: this.state.name,
            email: this.state.email,
            token,
            remember,
            autocommitIntervalMinutes: this.state.autocommitIntervalMinutes,
            autocommitRepos: this.state.autocommitSelected,
            autoresolveConflicts: this.state.autoresolveConflicts,
            credentialsDirty: true
        });
    }

    onRememberChange() {
        const remember = Boolean(this.rememberInput?.checked);
        this.state.remember = remember;
        this.state.credentialsValidated = false;
        this.state.credentialsDirty = true;
        this.updateValidationState();
        this.renderAutocommitRepos();
        this.scheduleValidation();
        this.getParentPresenter()?.handleCredentialsChange?.({
            name: this.state.name,
            email: this.state.email,
            token: this.state.token,
            remember,
            autocommitIntervalMinutes: this.state.autocommitIntervalMinutes,
            autocommitRepos: this.state.autocommitSelected,
            autoresolveConflicts: this.state.autoresolveConflicts,
            credentialsDirty: true
        });
    }

    onAutocommitChange() {
        const intervalRaw = this.autocommitIntervalInput?.value;
        const autocommitIntervalMinutes = Math.max(1, Math.floor(Number(intervalRaw || 15)));
        this.state.autocommitIntervalMinutes = autocommitIntervalMinutes;
        this.state.autocommitDirty = true;
        this.updateValidationState();
        this.getParentPresenter()?.handleCredentialsChange?.({
            name: this.state.name,
            email: this.state.email,
            token: this.state.token,
            remember: this.state.remember,
            autocommitIntervalMinutes,
            autocommitRepos: this.state.autocommitSelected,
            autoresolveConflicts: this.state.autoresolveConflicts,
            autocommitDirty: true
        });
    }

    onAutocommitReposChange(event) {
        const target = event?.target;
        if (!target || target.type !== 'checkbox' || !target.dataset?.repoPath) return;
        const autocommitRepos = this.getSelectedAutocommitRepos();
        this.state.autocommitSelected = autocommitRepos;
        this.state.autocommitDirty = true;
        this.updateValidationState();
        this.getParentPresenter()?.handleCredentialsChange?.({
            name: this.state.name,
            email: this.state.email,
            token: this.state.token,
            remember: this.state.remember,
            autocommitIntervalMinutes: this.state.autocommitIntervalMinutes,
            autocommitRepos,
            autoresolveConflicts: this.state.autoresolveConflicts,
            autocommitDirty: true
        });
    }

    onAutoresolveChange() {
        const autoresolveConflicts = Boolean(this.autoresolveInput?.checked);
        this.state.autoresolveConflicts = autoresolveConflicts;
        this.state.autoresolveDirty = true;
        this.updateValidationState();
        this.getParentPresenter()?.handleCredentialsChange?.({
            name: this.state.name,
            email: this.state.email,
            token: this.state.token,
            remember: this.state.remember,
            autocommitIntervalMinutes: this.state.autocommitIntervalMinutes,
            autocommitRepos: this.state.autocommitSelected,
            autoresolveConflicts,
            autoresolveDirty: true
        });
    }
    onTokenKeydown(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            this.saveGitCredentials();
        }
    }

    scheduleValidation() {
        if (this.validateTimer) {
            clearTimeout(this.validateTimer);
        }
        if (!this.state.visible) return;
        const name = String(this.state.name || '').trim();
        const email = String(this.state.email || '').trim();
        const token = String(this.state.token || '').trim();
        if (!name || !email) return;
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
        if (!token) return;
        if (this.state.credentialsValidated) return;
        this.validateTimer = setTimeout(() => {
            this.getParentPresenter()?.saveGitCredentials?.({
                name,
                email,
                token,
                remember: this.state.remember,
                autocommitIntervalMinutes: this.state.autocommitIntervalMinutes,
                autocommitRepos: this.state.autocommitSelected,
                autoresolveConflicts: this.state.autoresolveConflicts,
                validateOnly: true
            });
        }, 400);
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
        if (Object.prototype.hasOwnProperty.call(next, 'credentialsValidated')) {
            this.state.credentialsValidated = Boolean(next.credentialsValidated);
        }
        if (Object.prototype.hasOwnProperty.call(next, 'credentialsDirty')) {
            this.state.credentialsDirty = Boolean(next.credentialsDirty);
        }
        if (Object.prototype.hasOwnProperty.call(next, 'autocommitDirty')) {
            this.state.autocommitDirty = Boolean(next.autocommitDirty);
        }
        if (Object.prototype.hasOwnProperty.call(next, 'tokenStored')) {
            this.state.tokenStored = Boolean(next.tokenStored);
        }
        if (Object.prototype.hasOwnProperty.call(next, 'autocommitIntervalMinutes')) {
            const parsed = Number(next.autocommitIntervalMinutes);
            if (Number.isFinite(parsed)) {
                this.state.autocommitIntervalMinutes = Math.max(1, Math.floor(parsed));
            }
        }
        if (Object.prototype.hasOwnProperty.call(next, 'autocommitRepos')) {
            this.state.autocommitRepos = this.normalizeRepoList(next.autocommitRepos);
        }
        if (Object.prototype.hasOwnProperty.call(next, 'autocommitSelected')) {
            this.state.autocommitSelected = this.normalizeRepoSelection(next.autocommitSelected);
        }
        if (Object.prototype.hasOwnProperty.call(next, 'autoresolveConflicts')) {
            this.state.autoresolveConflicts = Boolean(next.autoresolveConflicts);
        }
        if (Object.prototype.hasOwnProperty.call(next, 'autoresolveDirty')) {
            this.state.autoresolveDirty = Boolean(next.autoresolveDirty);
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
        if (this.autoresolveInput) {
            this.autoresolveInput.checked = this.state.autoresolveConflicts;
        }
        if (this.autocommitIntervalInput) {
            const nextValue = String(this.state.autocommitIntervalMinutes || 15);
            if (this.autocommitIntervalInput.value !== nextValue) {
                this.autocommitIntervalInput.value = nextValue;
            }
        }
        this.updateValidationState();
        this.renderAutocommitRepos();

        if (next.focus === 'name') {
            setTimeout(() => this.nameInput?.focus?.(), 0);
        } else if (next.focus === 'email') {
            setTimeout(() => this.emailInput?.focus?.(), 0);
        } else if (next.focus === 'token') {
            setTimeout(() => this.tokenInput?.focus?.(), 0);
        }
    }

    getParentPresenter() {
        return this.element.closest('git-commit-modal')?.webSkelPresenter || null;
    }

    normalizeRepoList(list) {
        const repos = Array.isArray(list) ? list : [];
        const seen = new Set();
        const normalized = [];
        for (const entry of repos) {
            if (!entry || typeof entry !== 'object') continue;
            const path = String(entry.path || '').trim();
            const name = String(entry.name || entry.path || '').trim();
            if (!path || !name || seen.has(path)) continue;
            seen.add(path);
            normalized.push({ path, name });
        }
        return normalized;
    }

    normalizeRepoSelection(list) {
        if (list === null || list === undefined) return null;
        const selected = Array.isArray(list) ? list : [];
        return selected.map((entry) => String(entry || '').trim()).filter(Boolean);
    }

    getSelectedAutocommitRepos() {
        const selected = [];
        if (!this.autocommitReposContainer) return selected;
        const inputs = this.autocommitReposContainer.querySelectorAll('input[data-repo-path]');
        for (const input of inputs) {
            if (input.checked) {
                const path = String(input.dataset.repoPath || '').trim();
                if (path) selected.push(path);
            }
        }
        return selected;
    }

    isCredentialsValid() {
        const name = String(this.state.name || '').trim();
        const email = String(this.state.email || '').trim();
        if (!name || !email) return false;
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return false;
        if (this.state.remember && !String(this.state.token || '').trim() && !this.state.tokenStored) {
            return false;
        }
        return true;
    }

    getValidationMessage() {
        const name = String(this.state.name || '').trim();
        const email = String(this.state.email || '').trim();
        if (!name || !email) {
            return 'Enter name and email to continue.';
        }
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            return 'Enter a valid email address.';
        }
        if (this.state.remember && !String(this.state.token || '').trim() && !this.state.tokenStored) {
            return 'Enter a token or disable “Remember token”.';
        }
        return '';
    }

    updateValidationState() {
        const valid = this.isCredentialsValid();
        const canSave = valid && (
            this.state.credentialsValidated
            || this.state.credentialsDirty
            || this.state.autocommitDirty
            || this.state.autoresolveDirty
        );
        if (this.saveButton) {
            this.saveButton.disabled = !canSave;
            const message = valid
                ? (this.state.credentialsDirty || this.state.autocommitDirty || this.state.autoresolveDirty
                    ? ''
                    : (this.state.credentialsValidated ? '' : 'Validate credentials to load repositories.'))
                : this.getValidationMessage();
            if (message) {
                this.saveButton.title = message;
            } else {
                this.saveButton.removeAttribute('title');
            }
        }
    }

    renderAutocommitRepos() {
        const container = this.autocommitReposContainer;
        if (!container) return;
        const repos = Array.isArray(this.state.autocommitRepos) ? this.state.autocommitRepos : [];
        if (!this.state.credentialsValidated && repos.length === 0) {
            container.textContent = 'Validate credentials to load repositories.';
            return;
        }
        container.innerHTML = '';
        if (!repos.length) {
            container.textContent = 'No repositories loaded.';
            return;
        }
        const selectedList = Array.isArray(this.state.autocommitSelected)
            ? this.state.autocommitSelected
            : null;
        const selected = new Set(
            selectedList === null ? repos.map((repo) => repo.path) : selectedList
        );
        this.state.autocommitSelected = selectedList === null ? null : Array.from(selected);
        const fragment = document.createDocumentFragment();
        for (const repo of repos) {
            const label = document.createElement('label');
            label.className = 'autocommit-repo';
            const row = document.createElement('div');
            row.className = 'autocommit-repo-row';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = selected.has(repo.path);
            checkbox.dataset.repoPath = repo.path;
            const nameSpan = document.createElement('span');
            nameSpan.textContent = repo.name || repo.path;
            row.appendChild(checkbox);
            row.appendChild(nameSpan);

            if (repo.path && repo.name && repo.name !== repo.path) {
                const pathSpan = document.createElement('span');
                pathSpan.className = 'autocommit-repo-path';
                pathSpan.textContent = repo.path;
                row.appendChild(pathSpan);
            }
            label.appendChild(row);
            fragment.appendChild(label);
        }
        container.appendChild(fragment);
    }
}
