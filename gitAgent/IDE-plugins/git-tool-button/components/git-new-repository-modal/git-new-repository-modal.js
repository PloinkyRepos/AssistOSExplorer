import { callAgentTool, parseToolResult } from "/explorer/services/infrastructure/explorerApi.js";
import { createGitCommitService } from "../git-commit-modal/git-commit-modal-service.js";

const MODES = ['create-github', 'clone-github', 'manual'];

async function callGitTool(name, args = {}) {
    const raw = await callAgentTool('gitAgent', name, args, { raw: true });
    return parseToolResult(raw);
}

export class GitNewRepositoryModal {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.form = null;
        this.errorNode = null;
        this.mode = 'create-github';
        this.targets = [];
        this.repositories = [];
        this.selectedTarget = '';
        this.selectedRepository = null;
        this.targetsLoaded = false;
        this.repositoriesLoaded = false;
        this.loadingGithub = false;
        this.githubAuthPending = null;
        this.githubAuthError = '';
        this.githubPollTimer = null;
        this.githubAuthRenderKey = '';
        this.githubAuthStartPromise = null;
        this.service = createGitCommitService({
            callTool: async () => {
                throw new Error('Explorer tool calls are not available in this modal.');
            },
            callAgentTool
        });
        this.boundSubmit = (event) => {
            event.preventDefault();
            this.confirm();
        };
        this.boundInput = (event) => this.handleInput(event);
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.form = this.element.querySelector('[data-git-new-repository-form]');
        this.errorNode = this.element.querySelector('[data-git-new-repository-error]');
        this.form?.removeEventListener('submit', this.boundSubmit);
        this.form?.addEventListener('submit', this.boundSubmit);
        this.element.removeEventListener('input', this.boundInput);
        this.element.addEventListener('input', this.boundInput);
        this.syncModeUi();
        this.loadGithubData();
    }

    afterUnload() {
        this.form?.removeEventListener('submit', this.boundSubmit);
        this.element.removeEventListener('input', this.boundInput);
        this.clearGithubPollTimer();
    }

    closeModal() {
        assistOS.UI.closeModal(this.element);
    }

    setError(message) {
        if (!this.errorNode) return;
        this.errorNode.textContent = message;
        this.errorNode.hidden = !message;
    }

    readValue(name) {
        const input = this.form?.elements?.[name];
        return String(input?.value || '').trim();
    }

    setValue(name, value) {
        const input = this.form?.elements?.[name];
        if (input) input.value = value;
    }

    handleInput(event) {
        if (event.target?.matches?.('[name="githubName"]')) {
            const value = String(event.target.value || '').trim();
            const localInput = this.form?.elements?.githubLocalName;
            if (localInput && (!localInput.value || localInput.dataset.syncedFromName === 'true')) {
                localInput.value = value;
                localInput.dataset.syncedFromName = 'true';
            }
        }
        if (event.target?.matches?.('[name="githubLocalName"]')) {
            event.target.dataset.syncedFromName = 'false';
        }
        if (event.target?.matches?.('[name="repositorySearch"]')) {
            this.renderRepositories();
        }
    }

    setMode(elementOrMode, maybeMode) {
        const mode = String(maybeMode || elementOrMode || '').trim();
        if (!MODES.includes(mode)) return;
        this.mode = mode;
        this.setError('');
        this.syncModeUi();
        if (mode !== 'manual') {
            if (this.githubAuthPending) {
                this.renderGithubAuthPending();
                this.scheduleGithubPoll(this.githubAuthPending?.interval);
                return;
            }
            this.loadGithubData();
        }
    }

    reloadGithubData() {
        this.loadGithubData({ force: true });
    }

    syncModeUi() {
        for (const button of this.element.querySelectorAll('[data-git-new-repository-mode]')) {
            const active = button.getAttribute('data-git-new-repository-mode') === this.mode;
            button.classList.toggle('active', active);
            button.setAttribute('aria-selected', active ? 'true' : 'false');
        }
        for (const panel of this.element.querySelectorAll('[data-git-new-repository-panel]')) {
            panel.hidden = panel.getAttribute('data-git-new-repository-panel') !== this.mode;
        }
        const submit = this.element.querySelector('[data-git-new-repository-submit]');
        if (submit) {
            submit.textContent = this.mode === 'clone-github' ? 'Clone' : 'Create';
        }
        const focusSelector = this.mode === 'manual'
            ? '#gitNewRepositoryName'
            : this.mode === 'clone-github'
                ? '#gitNewRepositorySearch'
                : '#gitNewRepositoryGithubName';
        this.element.querySelector(focusSelector)?.focus();
    }

    async loadGithubData({ force = false } = {}) {
        const needsTargets = !this.targetsLoaded || force;
        const needsRepositories = this.mode === 'clone-github' && (!this.repositoriesLoaded || force);
        if (this.githubAuthPending) {
            this.renderGithubAuthPending();
            this.scheduleGithubPoll(this.githubAuthPending?.interval);
            return;
        }
        if (this.mode === 'manual' || this.loadingGithub || (!needsTargets && !needsRepositories)) {
            return;
        }
        this.loadingGithub = true;
        this.renderGithubLoading({ targets: needsTargets, repositories: needsRepositories });
        if (!needsTargets) {
            this.renderTargets();
        }
        try {
            if (needsTargets) {
                const targetsResult = await callGitTool('git_github_repository_targets');
                if (targetsResult?.ok === false) {
                    await this.handleGithubToolFailure(targetsResult, 'GitHub authorization is required to load organizations.');
                    return;
                }
                this.targets = Array.isArray(targetsResult?.targets) ? targetsResult.targets : [];
                this.selectedTarget = this.selectedTarget || this.targets[0]?.login || '';
                this.targetsLoaded = true;
                this.renderTargets();
            }
            if (needsRepositories) {
                const repositoriesResult = await callGitTool('git_github_repositories');
                if (repositoriesResult?.ok === false) {
                    await this.handleGithubToolFailure(repositoriesResult, 'GitHub authorization is required to load repositories.');
                    return;
                }
                this.repositories = Array.isArray(repositoriesResult?.repositories) ? repositoriesResult.repositories : [];
                this.repositoriesLoaded = true;
                this.renderRepositories();
            }
        } catch (error) {
            this.renderGithubError(error?.message || 'Unable to load GitHub repositories.');
        } finally {
            this.loadingGithub = false;
        }
    }

    async handleGithubToolFailure(result, fallbackMessage) {
        const message = String(result?.error || result?.message || fallbackMessage || 'GitHub request failed.').trim();
        if (result?.code === 'github_auth_required') {
            await this.startGithubAuth();
            return;
        }
        throw new Error(message);
    }

    renderGithubLoading({ targets = true, repositories = this.mode === 'clone-github' } = {}) {
        const targetsNode = this.element.querySelector('[data-github-targets]');
        if (targets && targetsNode) this.setGithubContainerHtml(targetsNode, this.renderLoadingState('Loading GitHub organizations...'));
        if (repositories && this.mode === 'clone-github') {
            const reposNode = this.element.querySelector('[data-github-repositories]');
            if (reposNode) this.setGithubContainerHtml(reposNode, this.renderLoadingState('Loading repositories...'));
        }
    }

    renderLoadingState(message) {
        return `
            <div class="git-new-repository-state git-new-repository-loading">
                <span class="git-new-repository-spinner" aria-hidden="true"></span>
                <span>${this.escapeHtml(message)}</span>
            </div>
        `.trim();
    }

    renderGithubError(message) {
        const html = `
            <div class="git-new-repository-state git-new-repository-state-error">
                <span>${this.escapeHtml(message)}</span>
                <button type="button" class="gray-button" data-local-action="reloadGithubData">Retry</button>
            </div>
        `;
        const targetsNode = this.element.querySelector('[data-github-targets]');
        const reposNode = this.element.querySelector('[data-github-repositories]');
        if (targetsNode && !(this.mode === 'clone-github' && this.targetsLoaded)) this.setGithubContainerHtml(targetsNode, html);
        if (reposNode) this.setGithubContainerHtml(reposNode, html);
        if (this.mode === 'clone-github' && this.targetsLoaded) {
            this.renderTargets();
        }
    }

    renderGithubAuthPending() {
        const pending = this.githubAuthPending || {};
        const code = String(pending.userCode || '').trim();
        const renderKey = [
            'pending',
            this.mode,
            code,
            String(pending.verificationUri || ''),
            String(pending.verificationUriComplete || ''),
            String(this.githubAuthError || '')
        ].join('|');
        if (renderKey === this.githubAuthRenderKey) {
            return;
        }
        this.githubAuthRenderKey = renderKey;
        const html = `
            <div class="git-new-repository-auth-state">
                <div class="git-new-repository-auth-title">Complete sign-in in GitHub.</div>
                <div class="git-github-warning">Enter this code in GitHub. This dialog will continue automatically after approval.</div>
                <div class="git-github-pending">
                    <div class="git-github-code-row">
                        <div class="git-github-code-card">
                            <strong class="git-github-code-value">${this.escapeHtml(code || 'Waiting')}</strong>
                        </div>
                    </div>
                    <div class="git-github-pending-actions">
                        <button type="button" class="gray-button" data-local-action="continueGithubAuth" ${code ? '' : 'disabled'}>Copy code and open GitHub</button>
                    </div>
                </div>
                ${this.githubAuthError ? `<div class="git-github-warning">${this.escapeHtml(this.githubAuthError)}</div>` : ''}
            </div>
        `;
        this.renderGithubAuthHtml(html);
    }

    renderGithubAuthStarting() {
        const html = `
            <div class="git-new-repository-auth-state">
                <div class="git-new-repository-auth-title">Starting GitHub sign-in...</div>
                <div class="git-github-pending">
                    <div class="git-new-repository-state git-new-repository-loading">
                        <span class="git-new-repository-spinner" aria-hidden="true"></span>
                        <span>Preparing GitHub authorization...</span>
                    </div>
                </div>
            </div>
        `;
        this.renderGithubAuthHtml(html);
    }

    renderGithubAuthHtml(html) {
        const targetsNode = this.element.querySelector('[data-github-targets]');
        const reposNode = this.element.querySelector('[data-github-repositories]');
        if (targetsNode) this.setGithubContainerHtml(targetsNode, html, { auth: true });
        if (this.mode === 'clone-github' && reposNode) this.setGithubContainerHtml(reposNode, html, { auth: true });
    }

    setGithubContainerHtml(node, html, { auth = false } = {}) {
        if (!node) return;
        node.classList.toggle('is-auth-state', auth);
        const nextHtml = String(html || '').trim();
        if (node.innerHTML.trim() !== nextHtml) {
            node.innerHTML = nextHtml;
        }
    }

    async startGithubAuth() {
        if (this.githubAuthPending) {
            this.renderGithubAuthPending();
            this.scheduleGithubPoll(this.githubAuthPending?.interval);
            return this.githubAuthPending;
        }
        if (this.githubAuthStartPromise) {
            return this.githubAuthStartPromise;
        }
        this.githubAuthError = '';
        this.githubAuthRenderKey = '';
        this.renderGithubAuthStarting();
        this.githubAuthStartPromise = (async () => {
            const status = await this.service.githubAuthStatus();
            const currentGithub = status?.github || {};
            if (currentGithub?.connected) {
                this.githubAuthPending = null;
                this.targetsLoaded = false;
                this.repositoriesLoaded = false;
                await this.loadGithubData({ force: true });
                return;
            }
            if (currentGithub?.pending) {
                this.githubAuthPending = currentGithub.pending;
                this.renderGithubAuthPending();
                this.scheduleGithubPoll(this.githubAuthPending?.interval);
                return this.githubAuthPending;
            }
            const result = await this.service.startGithubDeviceFlow();
            const github = result?.github || {};
            if (github?.connected) {
                this.githubAuthPending = null;
                this.targetsLoaded = false;
                this.repositoriesLoaded = false;
                await this.loadGithubData({ force: true });
                return;
            }
            this.githubAuthPending = github.pending || null;
            if (!this.githubAuthPending) {
                throw new Error('GitHub sign-in did not return a verification code.');
            }
            this.renderGithubAuthPending();
            this.scheduleGithubPoll(this.githubAuthPending?.interval);
            return this.githubAuthPending;
        })();
        try {
            return await this.githubAuthStartPromise;
        } catch (error) {
            this.githubAuthError = error?.message || 'Could not start GitHub sign-in.';
            this.renderGithubError(this.githubAuthError);
            throw error;
        } finally {
            this.githubAuthStartPromise = null;
        }
    }

    async continueGithubAuth() {
        const pending = this.githubAuthPending || {};
        const code = String(pending.userCode || '').trim();
        const url = String(pending.verificationUriComplete || pending.verificationUri || 'https://github.com/login/device').trim();
        if (code) {
            await this.copyText(code);
        }
        if (url) {
            window.open(url, '_blank', 'noopener,noreferrer');
        }
    }

    async pollGithubAuth() {
        this.githubAuthError = '';
        try {
            const result = await this.service.pollGithubDeviceFlow();
            const github = result?.github || {};
            if (!github.connected) {
                this.githubAuthPending = github.pending || this.githubAuthPending;
                this.githubAuthError = github.pending ? '' : 'GitHub sign-in was not completed.';
                this.renderGithubAuthPending();
                this.scheduleGithubPoll(this.githubAuthPending?.interval);
                return;
            }
            this.clearGithubPollTimer();
            this.githubAuthPending = null;
            this.targetsLoaded = false;
            this.repositoriesLoaded = false;
            await this.loadGithubData({ force: true });
        } catch (error) {
            this.githubAuthError = error?.message || 'Could not verify GitHub sign-in.';
            this.renderGithubAuthPending();
            this.scheduleGithubPoll(this.githubAuthPending?.interval);
        }
    }

    scheduleGithubPoll(intervalSeconds) {
        this.clearGithubPollTimer();
        const interval = Math.max(5, Number.parseInt(String(intervalSeconds || '5'), 10) || 5);
        this.githubPollTimer = setTimeout(() => {
            this.githubPollTimer = null;
            this.pollGithubAuth();
        }, interval * 1000);
    }

    clearGithubPollTimer() {
        if (this.githubPollTimer) {
            clearTimeout(this.githubPollTimer);
            this.githubPollTimer = null;
        }
    }

    async copyText(value) {
        try {
            if (globalThis.navigator?.clipboard?.writeText) {
                await globalThis.navigator.clipboard.writeText(value);
                return true;
            }
        } catch {}
        try {
            const textarea = document.createElement('textarea');
            textarea.value = value;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            textarea.remove();
            return true;
        } catch {
            return false;
        }
    }

    renderTargets() {
        const node = this.element.querySelector('[data-github-targets]');
        if (!node) return;
        if (!this.targets.length) {
            this.setGithubContainerHtml(node, '<div class="git-new-repository-state">No GitHub organizations found.</div>');
            return;
        }
        this.setGithubContainerHtml(node, this.targets.map((target) => {
            const active = target.login === this.selectedTarget ? ' active' : '';
            const organizationUrl = target.repositoryUrl || `https://github.com/${target.login}`;
            return `
                <button type="button" class="git-new-repository-target${active}" data-local-action="selectTarget ${this.escapeHtml(target.login)}">
                    <span class="git-new-repository-target-name">${this.escapeHtml(target.login)}</span>
                    <span class="git-new-repository-target-type">${this.escapeHtml(organizationUrl)}</span>
                </button>
            `.trim();
        }).join(''));
    }

    renderRepositories() {
        const node = this.element.querySelector('[data-github-repositories]');
        if (!node) return;
        const query = this.readValue('repositorySearch').toLowerCase();
        const repositories = this.repositories.filter((repo) => {
            if (!query) return true;
            return String(repo.fullName || '').toLowerCase().includes(query)
                || String(repo.description || '').toLowerCase().includes(query);
        });
        if (!repositories.length) {
            this.setGithubContainerHtml(node, '<div class="git-new-repository-state">No repositories match this search.</div>');
            return;
        }
        this.setGithubContainerHtml(node, repositories.map((repo) => {
            const index = this.repositories.indexOf(repo);
            const selected = this.selectedRepository?.fullName === repo.fullName ? ' selected' : '';
            const visibility = repo.private ? 'Private' : 'Public';
            return `
                <button type="button" class="git-new-repository-repo${selected}" data-local-action="selectRepository ${index}">
                    <span class="git-new-repository-repo-main">
                        <span class="git-new-repository-repo-name">${this.escapeHtml(repo.fullName)}</span>
                        <span class="git-new-repository-repo-visibility">${visibility}</span>
                    </span>
                    <span class="git-new-repository-repo-description">${this.escapeHtml(repo.description || repo.defaultBranch || 'No description')}</span>
                </button>
            `.trim();
        }).join(''));
    }

    selectTarget(elementOrLogin, maybeLogin) {
        const login = maybeLogin || elementOrLogin;
        this.selectedTarget = String(login || '').trim();
        this.renderTargets();
    }

    selectRepository(elementOrIndex, maybeIndex) {
        const index = Number(maybeIndex ?? elementOrIndex);
        const repo = this.repositories[index];
        if (!repo) return;
        this.selectedRepository = repo;
        this.setValue('cloneLocalName', repo.name || '');
        this.renderRepositories();
    }

    confirm() {
        if (this.mode === 'create-github') {
            const name = this.readValue('githubName');
            const localName = this.readValue('githubLocalName') || name;
            if (!this.selectedTarget) {
                this.setError('Select a GitHub organization.');
                return;
            }
            if (!name) {
                this.setError('Repository name is required.');
                return;
            }
            this.setError('');
            assistOS.UI.closeModal(this.element, {
                mode: 'create-github',
                owner: this.selectedTarget,
                name,
                localName,
                visibility: this.readValue('visibility') === 'public' ? 'public' : 'private',
                remote: 'origin'
            });
            return;
        }

        if (this.mode === 'clone-github') {
            if (!this.selectedRepository) {
                this.setError('Select a GitHub repository to clone.');
                return;
            }
            const localName = this.readValue('cloneLocalName') || this.selectedRepository.name;
            if (!localName) {
                this.setError('Local folder name is required.');
                return;
            }
            this.setError('');
            assistOS.UI.closeModal(this.element, {
                mode: 'clone-github',
                name: this.selectedRepository.name,
                localName,
                remote: 'origin',
                remoteUrl: this.selectedRepository.cloneUrl,
                repository: this.selectedRepository
            });
            return;
        }

        const name = this.readValue('name');
        const remoteUrl = this.readValue('remoteUrl');
        if (!name) {
            this.setError('Repository name is required.');
            return;
        }
        if (!remoteUrl) {
            this.setError('Remote URL is required.');
            return;
        }
        this.setError('');
        assistOS.UI.closeModal(this.element, { mode: 'manual', name, remote: 'origin', remoteUrl });
    }

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}
