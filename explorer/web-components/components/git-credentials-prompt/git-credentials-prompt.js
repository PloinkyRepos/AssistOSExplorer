export class GitCredentialsPrompt {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.state = {
            visible: false,
            name: '',
            email: '',
            authMethod: 'token',
            token: '',
            remember: true,
            authRequired: false,
            credentialsValidated: false,
            credentialsDirty: false,
            autocommitDirty: false,
            tokenStored: false,
            githubConfigured: false,
            githubConnected: false,
            githubUserLabel: '',
            githubScope: '',
            githubHasRepoScope: false,
            githubPending: false,
            githubVerificationUri: '',
            githubUserCode: '',
            autocommitReposLoading: false,
            autocommitReposLoaded: false,
            autocommitIntervalMinutes: 15,
            autocommitRepos: [],
            autocommitSelected: null,
            autoresolveConflicts: false,
            autoresolveDirty: false
        };
        this.onIdentityInput = this.onIdentityInput.bind(this);
        this.onAuthMethodChange = this.onAuthMethodChange.bind(this);
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
        this.authMethodInputs = Array.from(this.element.querySelectorAll('input[name="gitCredentialsAuthMethod"]'));
        this.tokenInput = this.element.querySelector('#gitCredentialsToken');
        this.rememberInput = this.element.querySelector('#gitCredentialsRemember');
        this.githubPanel = this.element.querySelector('#gitGithubPanel');
        this.tokenPanel = this.element.querySelector('#gitTokenPanel');
        this.githubAuth = this.element.querySelector('#gitGithubAuth');
        this.githubStatus = this.element.querySelector('#gitGithubStatus');
        this.githubScope = this.element.querySelector('#gitGithubScope');
        this.githubWarning = this.element.querySelector('#gitGithubWarning');
        this.githubPending = this.element.querySelector('#gitGithubPending');
        this.githubCode = this.element.querySelector('#gitGithubCode');
        this.githubContinueButton = this.element.querySelector('[data-local-action="continueGithubAuth"]');
        this.githubActions = this.element.querySelector('.git-github-actions');
        this.githubDisconnectButton = this.element.querySelector('[data-local-action="disconnectGithubAuth"]');
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
        for (const input of this.authMethodInputs) {
            if (!input.dataset.boundCredentialsInput) {
                input.addEventListener('change', this.onAuthMethodChange);
                input.dataset.boundCredentialsInput = 'true';
            }
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
        const name = (this.nameInput?.value || '').trim();
        const email = (this.emailInput?.value || '').trim();
        const authMethod = this.getSelectedAuthMethod();
        const token = (this.tokenInput?.value || '').trim();
        const remember = Boolean(this.rememberInput?.checked);
        const intervalRaw = this.autocommitIntervalInput?.value;
        const autocommitIntervalMinutes = Math.max(1, Math.floor(Number(intervalRaw || 15)));
        const autocommitRepos = this.getSelectedAutocommitRepos();
        const autoresolveConflicts = Boolean(this.autoresolveInput?.checked);
        this.state.name = name;
        this.state.email = email;
        this.state.authMethod = authMethod;
        this.state.token = token;
        this.state.remember = remember;
        this.state.autocommitIntervalMinutes = autocommitIntervalMinutes;
        this.state.autocommitSelected = autocommitRepos;
        this.state.autoresolveConflicts = autoresolveConflicts;
        this.getParentPresenter()?.saveGitCredentials?.({
            name,
            email,
            authMethod,
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

    disconnectGithubAuth() {
        this.getParentPresenter()?.disconnectGithubAuth?.();
    }

    async copyGithubCode() {
        const code = String(this.state.githubUserCode || '').trim();
        if (!code) return false;
        try {
            if (globalThis.navigator?.clipboard?.writeText) {
                await globalThis.navigator.clipboard.writeText(code);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = code;
                textarea.setAttribute('readonly', '');
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                textarea.remove();
            }
            return true;
        } catch {
            return false;
        }
    }

    openGithubVerification() {
        const url = String(this.state.githubVerificationUri || '').trim();
        if (!url) return false;
        window.open(url, '_blank', 'noopener,noreferrer');
        return true;
    }

    async continueGithubAuth() {
        const copied = await this.copyGithubCode();
        const opened = this.openGithubVerification();
        if (copied && opened) {
            await globalThis.assistOS?.showToast?.('Code copied. GitHub verification opened in a new tab.', 'success', 2500);
            return;
        }
        if (opened) {
            await globalThis.assistOS?.showToast?.('GitHub verification opened. Copy the code manually if needed.', 'info', 3000);
            return;
        }
        if (copied) {
            await globalThis.assistOS?.showToast?.('Code copied. Open GitHub verification to continue.', 'info', 3000);
            return;
        }
        await globalThis.assistOS?.showToast?.('Could not start GitHub verification. Please try again.', 'error', 3000);
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
            authMethod: this.state.authMethod,
            token: this.state.token,
            remember: this.state.remember,
            autocommitIntervalMinutes: this.state.autocommitIntervalMinutes,
            autocommitRepos: this.state.autocommitSelected,
            autoresolveConflicts: this.state.autoresolveConflicts,
            credentialsDirty: true
        });
    }

    onAuthMethodChange() {
        const authMethod = this.getSelectedAuthMethod();
        this.state.authMethod = authMethod;
        this.state.credentialsValidated = false;
        this.state.credentialsDirty = true;
        this.updateAuthPanels();
        this.updateValidationState();
        this.renderAutocommitRepos();
        this.scheduleValidation();
        this.getParentPresenter()?.handleCredentialsChange?.({
            name: this.state.name,
            email: this.state.email,
            authMethod,
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
        if (!remember) {
            this.state.tokenStored = false;
        }
        this.state.credentialsValidated = false;
        this.state.credentialsDirty = true;
        this.updateValidationState();
        this.renderAutocommitRepos();
        this.scheduleValidation();
        this.getParentPresenter()?.handleCredentialsChange?.({
            name: this.state.name,
            email: this.state.email,
            authMethod: this.state.authMethod,
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
        if (!remember) {
            this.state.tokenStored = false;
        }
        this.state.credentialsValidated = false;
        this.state.credentialsDirty = true;
        this.updateValidationState();
        this.renderAutocommitRepos();
        this.scheduleValidation();
        this.getParentPresenter()?.handleCredentialsChange?.({
            name: this.state.name,
            email: this.state.email,
            authMethod: this.state.authMethod,
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
            authMethod: this.state.authMethod,
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
            authMethod: this.state.authMethod,
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
            authMethod: this.state.authMethod,
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
        const authMethod = this.state.authMethod === 'github' ? 'github' : 'token';
        if (!name || !email) return;
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
        if (authMethod === 'github' && !this.state.githubConnected) return;
        const hasStoredToken = this.state.remember && this.state.tokenStored;
        if (authMethod === 'token' && !token && !hasStoredToken) return;
        if (this.state.credentialsValidated) return;
        this.validateTimer = setTimeout(() => {
            this.getParentPresenter()?.saveGitCredentials?.({
                name,
                email,
                authMethod,
                token: authMethod === 'github' ? '' : token,
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
        if (Object.prototype.hasOwnProperty.call(next, 'authMethod')) {
            this.state.authMethod = String(next.authMethod || '').trim().toLowerCase() === 'github' ? 'github' : 'token';
        }
        if (Object.prototype.hasOwnProperty.call(next, 'token')) {
            this.state.token = String(next.token || '');
        }
        if (Object.prototype.hasOwnProperty.call(next, 'remember')) {
            this.state.remember = Boolean(next.remember);
        }
        if (Object.prototype.hasOwnProperty.call(next, 'authRequired')) {
            this.state.authRequired = Boolean(next.authRequired);
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
        if (Object.prototype.hasOwnProperty.call(next, 'githubConfigured')) {
            this.state.githubConfigured = Boolean(next.githubConfigured);
        }
        if (Object.prototype.hasOwnProperty.call(next, 'githubConnected')) {
            this.state.githubConnected = Boolean(next.githubConnected);
        }
        if (Object.prototype.hasOwnProperty.call(next, 'githubUserLabel')) {
            this.state.githubUserLabel = String(next.githubUserLabel || '');
        }
        if (Object.prototype.hasOwnProperty.call(next, 'githubScope')) {
            this.state.githubScope = String(next.githubScope || '').trim();
        }
        if (Object.prototype.hasOwnProperty.call(next, 'githubHasRepoScope')) {
            this.state.githubHasRepoScope = Boolean(next.githubHasRepoScope);
        }
        if (Object.prototype.hasOwnProperty.call(next, 'githubPending')) {
            this.state.githubPending = Boolean(next.githubPending);
        }
        if (Object.prototype.hasOwnProperty.call(next, 'githubVerificationUri')) {
            this.state.githubVerificationUri = String(next.githubVerificationUri || '');
        }
        if (Object.prototype.hasOwnProperty.call(next, 'githubUserCode')) {
            this.state.githubUserCode = String(next.githubUserCode || '');
        }
        if (Object.prototype.hasOwnProperty.call(next, 'autocommitReposLoading')) {
            this.state.autocommitReposLoading = Boolean(next.autocommitReposLoading);
        }
        if (Object.prototype.hasOwnProperty.call(next, 'autocommitReposLoaded')) {
            this.state.autocommitReposLoaded = Boolean(next.autocommitReposLoaded);
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

        // When pre-filled credentials arrive but haven't been validated yet,
        // mark dirty so the Save button becomes clickable for validation.
        if (
            !this.state.credentialsValidated
            && !this.state.credentialsDirty
            && this.isCredentialsValid()
        ) {
            this.state.credentialsDirty = true;
        }

        this.element.classList.toggle('is-visible', this.state.visible);
        if (this.nameInput && this.nameInput.value !== this.state.name) {
            this.nameInput.value = this.state.name;
        }
        if (this.emailInput && this.emailInput.value !== this.state.email) {
            this.emailInput.value = this.state.email;
        }
        for (const input of this.authMethodInputs || []) {
            input.checked = input.value === this.state.authMethod;
        }
        if (this.tokenInput && this.tokenInput.value !== this.state.token) {
            this.tokenInput.value = this.state.token;
        }
        if (this.rememberInput) {
            this.rememberInput.checked = this.state.remember;
        }
        if (this.githubStatus) {
            if (this.state.githubConnected) {
                this.githubStatus.textContent = this.state.githubUserLabel
                    ? `Connected as ${this.state.githubUserLabel}.`
                    : 'Connected.';
            } else if (!this.state.githubConfigured) {
                this.githubStatus.textContent = 'GitHub sign-in is unavailable.';
            } else if (this.state.githubPending) {
                this.githubStatus.textContent = 'Complete sign-in in GitHub.';
            } else {
                this.githubStatus.textContent = 'Preparing sign-in...';
            }
        }
        if (this.githubScope) {
            const hasScope = Boolean(this.state.githubConnected && this.state.githubScope);
            this.githubScope.hidden = !hasScope;
            if (hasScope) {
                this.githubScope.textContent = `Scopes: ${this.state.githubScope}`;
            } else {
                this.githubScope.textContent = '';
            }
        }
        if (this.githubWarning) {
            const showWarning = Boolean(this.state.githubConnected && this.state.githubScope && !this.state.githubHasRepoScope);
            this.githubWarning.hidden = !showWarning;
            if (showWarning) {
                this.githubWarning.textContent = 'This GitHub authorization does not include repo access. Push may fail with 403.';
            } else {
                this.githubWarning.textContent = '';
            }
        }
        if (this.githubAuth) {
            let githubState = 'idle';
            if (this.state.githubConnected) githubState = 'connected';
            else if (!this.state.githubConfigured) githubState = 'unavailable';
            else if (this.state.githubPending) githubState = 'pending';
            this.githubAuth.dataset.state = githubState;
        }
        if (this.githubPending) {
            this.githubPending.hidden = !this.state.githubPending;
        }
        if (this.githubCode) {
            this.githubCode.textContent = this.state.githubUserCode || '';
        }
        if (this.githubContinueButton) {
            this.githubContinueButton.disabled = !this.state.githubUserCode || !this.state.githubVerificationUri;
        }
        if (this.githubDisconnectButton) {
            this.githubDisconnectButton.hidden = !this.state.githubConnected;
        }
        if (this.githubActions) {
            this.githubActions.hidden = !this.state.githubConnected;
        }
        this.updateAuthPanels();
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

    getSelectedAuthMethod() {
        const selected = (this.authMethodInputs || []).find((input) => input.checked);
        return selected?.value === 'github' ? 'github' : 'token';
    }

    updateAuthPanels() {
        const useGithub = this.state.authMethod === 'github';
        if (this.githubPanel) {
            this.githubPanel.hidden = !useGithub;
        }
        if (this.tokenPanel) {
            this.tokenPanel.hidden = useGithub;
        }
    }

    hasValidIdentity() {
        const name = String(this.state.name || '').trim();
        const email = String(this.state.email || '').trim();
        if (!name || !email) return false;
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return false;
        return true;
    }

    canSaveCredentials() {
        if (!this.hasValidIdentity()) return false;
        if (this.state.authMethod === 'github' && !this.state.githubConnected) {
            return Boolean(this.state.githubConfigured);
        }
        if (this.state.authMethod === 'token'
            && !String(this.state.token || '').trim()
            && !(this.state.remember && this.state.tokenStored)) {
            return false;
        }
        return true;
    }

    isCredentialsValid() {
        if (!this.hasValidIdentity()) return false;
        if (this.state.authMethod === 'github' && !this.state.githubConnected) {
            return false;
        }
        if (this.state.authMethod === 'token'
            && !String(this.state.token || '').trim()
            && !(this.state.remember && this.state.tokenStored)) {
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
        if (this.state.authMethod === 'github' && !this.state.githubConnected) {
            if (!this.state.githubConfigured) {
                return 'GitHub sign-in is not available in this workspace.';
            }
            return '';
        }
        if (this.state.authMethod === 'token'
            && !String(this.state.token || '').trim()
            && !(this.state.remember && this.state.tokenStored)) {
            return 'Enter a token to continue.';
        }
        return '';
    }

    updateValidationState() {
        const valid = this.isCredentialsValid();
        const savable = this.canSaveCredentials();
        if (this.saveButton) {
            this.saveButton.disabled = false;
            const message = savable
                ? (this.state.credentialsDirty || this.state.autocommitDirty || this.state.autoresolveDirty
                    ? ''
                    : '')
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
        if ((!this.state.autocommitReposLoaded || this.state.autocommitReposLoading) && repos.length === 0) {
            container.textContent = 'Loading repositories...';
            return;
        }
        container.innerHTML = '';
        if (!repos.length) {
            container.textContent = 'No repositories found.';
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
