import {
    callAgentTool,
    ensureSuccess,
    parseToolResult
} from "/explorer/services/infrastructure/explorerApi.js";

async function callUserPersistoTool(name, args = {}) {
    const raw = await callAgentTool('userPersistoAgent', name, args, { raw: true });
    ensureSuccess(raw);
    return parseToolResult(raw) || {};
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

export class UserpersistoSettings {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.state = {
            activePanel: 'users',
            status: '',
            statusType: '',
            settings: {},
            users: []
        };
        this.settingsRequestId = 0;
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.cacheElements();
        this.bindEvents();
        this.syncPanelFromAttributes();
        this.renderPanels();
        void this.loadSettings();
        if (this.state.activePanel === 'users') void this.refreshUsers();
    }

    cacheElements() {
        this.statusEl = this.element.querySelector('#userpersistoStatus');
        this.panelTabs = Array.from(this.element.querySelectorAll('[data-panel]'));
        this.usersListEl = this.element.querySelector('#usersList');
        this.userSearchInput = this.element.querySelector('#userSearchInput');
        this.createUserEmailInput = this.element.querySelector('#createUserEmail');
        this.createUserUsernameInput = this.element.querySelector('#createUserUsername');
        this.createUserPasswordInput = this.element.querySelector('#createUserPassword');
        this.createUserRoleInput = this.element.querySelector('#createUserRole');
        this.authMethodPasswordInput = this.element.querySelector('#authMethodPassword');
        this.authMethodEmailCodeInput = this.element.querySelector('#authMethodEmailCode');
        this.authMethodPasskeyInput = this.element.querySelector('#authMethodPasskey');
        this.authMethodTotpInput = this.element.querySelector('#authMethodTotp');
        this.inputs = {
            STRIPE_SECRET_KEY: this.element.querySelector('#stripeSecretKey'),
            STRIPE_WEBHOOK_SECRET: this.element.querySelector('#stripeWebhookSecret'),
            STRIPE_PRICE_CREDITS: this.element.querySelector('#stripePriceCredits'),
            STRIPE_PRICE_SUBSCRIPTION: this.element.querySelector('#stripePriceSubscription')
        };
    }

    bindEvents() {
        if (this.element.dataset.userpersistoBound === 'true') return;
        this.element.dataset.userpersistoBound = 'true';
        this.userSearchInput?.addEventListener('input', () => this.refreshUsers());
        [this.authMethodPasswordInput, this.authMethodEmailCodeInput].forEach((input) => {
            input?.addEventListener('change', () => this.enforcePrimaryAuthMethodSelection(input));
        });
        this.element.addEventListener('userpersisto-panel-change', (event) => {
            this.switchPanel(null, event.detail?.panel);
        });
    }

    syncPanelFromAttributes() {
        const panel = this.element.getAttribute('data-active-panel') || this.element.getAttribute('data-initial-panel');
        if (['users', 'auth', 'provider'].includes(panel)) {
            this.state.activePanel = panel;
        }
    }

    async callTool(name, args = {}) {
        const parsed = await callUserPersistoTool(name, args);
        if (parsed?.ok === false) {
            throw new Error(parsed.error || `${name} failed.`);
        }
        return parsed;
    }

    setStatus(message, type = '') {
        this.state.status = message;
        this.state.statusType = type;
        if (this.statusEl) {
            this.statusEl.textContent = message || '';
            this.statusEl.classList.toggle('error', type === 'error');
        }
    }

    switchPanel(_target, panel) {
        this.state.activePanel = ['users', 'auth', 'provider'].includes(panel) ? panel : 'users';
        this.renderPanels();
        if (this.state.activePanel === 'users') void this.refreshUsers();
    }

    renderPanels() {
        this.panelTabs?.forEach((tab) => {
            const isActive = tab.dataset.panel === this.state.activePanel;
            tab.classList.toggle('active', isActive);
            tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        this.element.querySelectorAll('[data-section]').forEach((section) => {
            section.classList.toggle('hidden', section.dataset.section !== this.state.activePanel);
        });
    }

    applySettings(payload) {
        this.state.settings = payload.settings || {};
        Object.entries(this.state.settings).forEach(([key, entry]) => {
            const mask = this.element.querySelector(`[data-mask-for="${key}"]`);
            if (mask) mask.textContent = entry?.maskedValue ? `Current: ${entry.maskedValue}` : 'Not configured';
        });
        this.renderAuthMethods();
    }

    async loadSettings() {
        const requestId = ++this.settingsRequestId;
        try {
            const payload = await this.callTool('userpersisto_get_agent_settings');
            if (requestId !== this.settingsRequestId) return;
            this.applySettings(payload);
            this.setStatus('');
        } catch (error) {
            if (requestId !== this.settingsRequestId) return;
            this.setStatus(error?.message || 'Failed to load settings.', 'error');
        }
    }

    renderAuthMethods() {
        const raw = String(this.state.settings?.USERPERSISTO_AUTH_METHODS?.value || 'password');
        const methods = new Set(raw.split(',').map((method) => method.trim()).filter(Boolean));
        if (this.authMethodPasswordInput) {
            this.authMethodPasswordInput.checked = methods.has('password') || !methods.size;
        }
        if (this.authMethodEmailCodeInput) {
            this.authMethodEmailCodeInput.checked = methods.has('emailCode');
        }
        if (this.authMethodPasskeyInput) {
            this.authMethodPasskeyInput.checked = methods.has('passkey');
        }
        if (this.authMethodTotpInput) {
            this.authMethodTotpInput.checked = methods.has('totp');
        }
        this.enforcePrimaryAuthMethodSelection();
    }

    enforcePrimaryAuthMethodSelection(changedInput = null) {
        const hasPrimaryMethod = Boolean(this.authMethodPasswordInput?.checked || this.authMethodEmailCodeInput?.checked);
        if (hasPrimaryMethod) return true;
        const primaryInput = changedInput || this.authMethodPasswordInput || this.authMethodEmailCodeInput;
        if (primaryInput) primaryInput.checked = true;
        this.setStatus('Keep Username and password or Email authentication code enabled.', 'error');
        return false;
    }

    async saveAuthMethods() {
        if (!this.enforcePrimaryAuthMethodSelection()) return;
        const methods = [];
        if (this.authMethodPasswordInput?.checked) methods.push('password');
        if (this.authMethodEmailCodeInput?.checked) methods.push('emailCode');
        if (this.authMethodPasskeyInput?.checked) methods.push('passkey');
        if (this.authMethodTotpInput?.checked) methods.push('totp');
        if (!methods.length) {
            this.setStatus('Select at least one authentication method.', 'error');
            return;
        }
        const requestId = ++this.settingsRequestId;
        const expectedValue = methods.join(',');
        try {
            const payload = await this.callTool('userpersisto_save_agent_settings', {
                settings: {
                    USERPERSISTO_AUTH_METHODS: expectedValue
                }
            });
            if (requestId !== this.settingsRequestId) return;
            const savedValue = String(payload.settings?.USERPERSISTO_AUTH_METHODS?.value || '');
            if (savedValue !== expectedValue) {
                throw new Error('Authentication methods were not saved.');
            }
            this.applySettings(payload);
            this.setStatus('Authentication methods saved.');
        } catch (error) {
            if (requestId !== this.settingsRequestId) return;
            this.setStatus(error?.message || 'Failed to save authentication methods.', 'error');
        }
    }

    async saveProviderSettings() {
        const settings = {};
        Object.entries(this.inputs).forEach(([key, input]) => {
            const value = String(input?.value || '').trim();
            if (value) settings[key] = value;
        });
        if (!Object.keys(settings).length) {
            this.setStatus('Enter at least one setting to save.');
            return;
        }
        const requestId = ++this.settingsRequestId;
        try {
            const payload = await this.callTool('userpersisto_save_agent_settings', { settings });
            Object.values(this.inputs).forEach((input) => { if (input) input.value = ''; });
            if (requestId !== this.settingsRequestId) return;
            this.applySettings(payload);
            this.setStatus('UserPersisto settings saved.');
        } catch (error) {
            if (requestId !== this.settingsRequestId) return;
            this.setStatus(error?.message || 'Failed to save settings.', 'error');
        }
    }

    async refreshUsers() {
        try {
            const payload = await this.callTool('userpersisto_list_users', {
                query: this.userSearchInput?.value || '',
                limit: 100
            });
            this.state.users = payload.users || [];
            this.renderUsers();
            this.setStatus(`${this.state.users.length} user${this.state.users.length === 1 ? '' : 's'} loaded.`);
        } catch (error) {
            this.setStatus(error?.message || 'Failed to load users.', 'error');
        }
    }

    async createUser() {
        try {
            const role = this.createUserRoleInput?.value || 'user';
            const payload = await this.callTool('userpersisto_create_user', {
                email: this.createUserEmailInput?.value || '',
                username: this.createUserUsernameInput?.value || '',
                password: this.createUserPasswordInput?.value || '',
                role,
                status: 'active'
            });
            [this.createUserEmailInput, this.createUserUsernameInput, this.createUserPasswordInput].forEach((input) => {
                if (input) input.value = '';
            });
            if (this.userSearchInput) {
                this.userSearchInput.value = '';
            }
            if (payload?.user) {
                this.state.users = [
                    payload.user,
                    ...this.state.users.filter((user) => user.id !== payload.user.id)
                ];
                this.renderUsers();
            }
            await this.refreshUsers();
            this.setStatus('User created.');
        } catch (error) {
            this.setStatus(error?.message || 'Failed to create user.', 'error');
        }
    }

    renderUsers() {
        if (!this.usersListEl) return;
        if (!this.state.users.length) {
            this.usersListEl.innerHTML = '<div class="userpersisto-result">No users found.</div>';
            return;
        }
        this.usersListEl.innerHTML = this.state.users.map((user) => `
            <div class="userpersisto-row">
                <div>
                    <div class="userpersisto-row-title">${escapeHtml(user.email)}</div>
                    <div class="userpersisto-row-meta">Username: ${escapeHtml(user.username || 'no username')} · Role: ${escapeHtml(user.role)} · Status: ${escapeHtml(user.status)}</div>
                    <div class="userpersisto-access">${user.explorerAccess ? 'Explorer access' : 'Self-registered app only'}</div>
                </div>
                <div class="userpersisto-row-controls">
                    <select class="form-input" data-user-role="${escapeHtml(user.id)}" data-local-action="changeUserRole ${escapeHtml(user.id)}">
                        ${['admin', 'user', 'selfRegistered'].map((role) => `<option value="${role}" ${role === user.role ? 'selected' : ''}>${role}</option>`).join('')}
                    </select>
                </div>
            </div>
        `).join('');
        this.usersListEl.querySelectorAll('[data-user-role]').forEach((select) => {
            select.addEventListener('change', () => this.changeUserRole(select, select.dataset.userRole));
        });
    }

    async changeUserRole(target, userId) {
        const role = target?.value;
        if (!userId || !role) return;
        try {
            await this.callTool('userpersisto_set_user_role', { userId, role });
            await this.refreshUsers();
            this.setStatus('User role updated.');
        } catch (error) {
            this.setStatus(error?.message || 'Failed to update role.', 'error');
        }
    }

    closeModal() {
        assistOS.UI.closeModal(this.element, null);
    }
}
