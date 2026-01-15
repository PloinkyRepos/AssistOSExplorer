export class GitCredentialsPrompt {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.state = {
            visible: false,
            name: '',
            email: '',
            token: '',
            remember: false,
            autocommitIntervalMinutes: 15,
            autocommitRepos: [],
            autocommitSelected: null
        };
        this.onUpdate = this.onUpdate.bind(this);
        this.onIdentityInput = this.onIdentityInput.bind(this);
        this.onTokenInput = this.onTokenInput.bind(this);
        this.onTokenKeydown = this.onTokenKeydown.bind(this);
        this.onRememberChange = this.onRememberChange.bind(this);
        this.onAutocommitChange = this.onAutocommitChange.bind(this);
        this.onAutocommitReposChange = this.onAutocommitReposChange.bind(this);
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
        const intervalRaw = this.autocommitIntervalInput?.value;
        const autocommitIntervalMinutes = Math.max(1, Math.floor(Number(intervalRaw || 15)));
        const autocommitRepos = this.getSelectedAutocommitRepos();
        this.state.name = name;
        this.state.email = email;
        this.state.token = token;
        this.state.remember = remember;
        this.state.autocommitIntervalMinutes = autocommitIntervalMinutes;
        this.state.autocommitSelected = autocommitRepos;
        this.emit('git-credentials-submit', { name, email, token, remember, autocommitIntervalMinutes, autocommitRepos });
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
            autocommitIntervalMinutes: this.state.autocommitIntervalMinutes,
            autocommitRepos: this.state.autocommitSelected
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
            autocommitIntervalMinutes: this.state.autocommitIntervalMinutes,
            autocommitRepos: this.state.autocommitSelected
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
            autocommitIntervalMinutes: this.state.autocommitIntervalMinutes,
            autocommitRepos: this.state.autocommitSelected
        });
    }

    onAutocommitChange() {
        const intervalRaw = this.autocommitIntervalInput?.value;
        const autocommitIntervalMinutes = Math.max(1, Math.floor(Number(intervalRaw || 15)));
        this.state.autocommitIntervalMinutes = autocommitIntervalMinutes;
        this.emit('git-credentials-change', {
            name: this.state.name,
            email: this.state.email,
            token: this.state.token,
            remember: this.state.remember,
            autocommitIntervalMinutes,
            autocommitRepos: this.state.autocommitSelected
        });
    }

    onAutocommitReposChange(event) {
        const target = event?.target;
        if (!target || target.type !== 'checkbox' || !target.dataset?.repoPath) return;
        const autocommitRepos = this.getSelectedAutocommitRepos();
        this.state.autocommitSelected = autocommitRepos;
        this.emit('git-credentials-change', {
            name: this.state.name,
            email: this.state.email,
            token: this.state.token,
            remember: this.state.remember,
            autocommitIntervalMinutes: this.state.autocommitIntervalMinutes,
            autocommitRepos
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
        if (this.autocommitIntervalInput) {
            const nextValue = String(this.state.autocommitIntervalMinutes || 15);
            if (this.autocommitIntervalInput.value !== nextValue) {
                this.autocommitIntervalInput.value = nextValue;
            }
        }
        this.renderAutocommitRepos();

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

    renderAutocommitRepos() {
        const container = this.autocommitReposContainer;
        if (!container) return;
        const repos = Array.isArray(this.state.autocommitRepos) ? this.state.autocommitRepos : [];
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
