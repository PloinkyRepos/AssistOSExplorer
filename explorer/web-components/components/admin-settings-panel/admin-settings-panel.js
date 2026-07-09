import {
    normalizeAuditCapture,
    normalizeToolResult,
    parseRoles
} from './admin-settings-utils.js';

function getCurrentAgentName(win = globalThis.window) {
    try {
        const explicit = win?.ASSISTOS_AGENT_ID || win?.assistOS?.agentId;
        if (explicit) return String(explicit);
        const parts = win.location.pathname.split('/').filter(Boolean);
        return parts[0] || 'explorer';
    } catch (_) {
        return 'explorer';
    }
}

export class AdminSettingsPanel {
    constructor(element, invalidate, props = {}) {
        this.element = element;
        this.invalidate = invalidate;
        this.props = props || {};
        this.agent = this.element.getAttribute('data-agent') || this.props.agent || getCurrentAgentName();
        this.apiBase = `/api/agents/${encodeURIComponent(this.agent)}/users`;
        this.settingsApi = `/api/agents/${encodeURIComponent(this.agent)}/settings`;
        this.state = {
            activeTab: this.element.getAttribute('data-active-tab') || 'users',
            loaded: false,
            loading: false,
            users: [],
            availableRoles: [],
            loginBrandingName: 'Login',
            auditConfig: {
                enabled: false,
                canManage: false,
                error: '',
                capture: normalizeAuditCapture()
            }
        };
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.cacheElements();
        this.bindEvents();
        this.updateTabUI();
        this.pushChildState();
        if (this.element.getAttribute('data-auto-load') !== 'false') {
            this.loadPage().catch((error) => this.setStatus(error.message, 'error'));
        }
    }

    cacheElements() {
        this.statusEl = this.element.querySelector('[data-role="status"]');
        this.tabButtons = Array.from(this.element.querySelectorAll('.administration-tab'));
        this.tabPanels = Array.from(this.element.querySelectorAll('.administration-tab-panel'));
        this.usersComponent = this.element.querySelector('admin-users-settings');
        this.brandingComponent = this.element.querySelector('admin-branding-settings');
        this.auditComponent = this.element.querySelector('admin-audit-settings');
    }

    bindEvents() {
        if (this.element.dataset.boundAdminSettingsPanel) return;
        this.element.addEventListener('admin-users-create', (event) => {
            this.createUser(event.detail || {}).catch((error) => this.setStatus(error.message, 'error'));
        });
        this.element.addEventListener('admin-users-save', (event) => {
            this.saveUser(event.detail?.userId, event.detail?.body || {}).catch((error) => this.setStatus(error.message, 'error'));
        });
        this.element.addEventListener('admin-users-delete', (event) => {
            this.deleteUser(event.detail?.userId).catch((error) => this.setStatus(error.message, 'error'));
        });
        this.element.addEventListener('admin-branding-save', (event) => {
            this.saveBranding(event.detail || {}).catch((error) => this.setStatus(error.message, 'error'));
        });
        this.element.addEventListener('admin-audit-save', (event) => {
            this.saveAudit(event.detail || {}).catch((error) => this.setStatus(error.message, 'error'));
        });
        this.element.addEventListener('admin-settings-error', (event) => {
            this.setStatus(event.detail?.message || 'Administration action failed.', 'error');
        });
        this.element.dataset.boundAdminSettingsPanel = 'true';
    }

    async loadPage({ force = false } = {}) {
        if (this.state.loading) return;
        if (this.state.loaded && !force) {
            this.pushChildState();
            return;
        }
        this.state.loading = true;
        this.setStatus('Loading settings...');
        try {
            const [settingsPayload, usersPayload] = await Promise.all([
                this.request(this.settingsApi),
                this.request(this.apiBase)
            ]);
            this.state.loginBrandingName = settingsPayload.settings?.loginBrandingName || 'Login';
            this.state.users = Array.isArray(usersPayload.users) ? usersPayload.users : [];
            this.state.availableRoles = parseRoles(usersPayload.availableRoles);
            await this.loadAuditConfig();
            this.state.loaded = true;
            this.pushChildState();
            this.setStatus(
                this.state.auditConfig.error || `${this.state.users.length} user${this.state.users.length === 1 ? '' : 's'} loaded.`,
                this.state.auditConfig.error ? 'error' : 'ok'
            );
        } finally {
            this.state.loading = false;
        }
    }

    async loadAuditConfig() {
        try {
            const auditPayload = await this.callDpuTool('dpu_audit_config_get');
            this.state.auditConfig = {
                ...this.state.auditConfig,
                ...(auditPayload.audit || {}),
                error: '',
                capture: normalizeAuditCapture(auditPayload.audit?.capture)
            };
        } catch (error) {
            this.state.auditConfig = {
                ...this.state.auditConfig,
                error: error.message || 'Audit settings could not be loaded.'
            };
        }
    }

    async pushChildState() {
        await Promise.all([
            this.setChildState(this.usersComponent, {
                users: this.state.users,
                availableRoles: this.state.availableRoles
            }),
            this.setChildState(this.brandingComponent, {
                loginBrandingName: this.state.loginBrandingName
            }),
            this.setChildState(this.auditComponent, {
                auditConfig: this.state.auditConfig
            })
        ]);
    }

    async setChildState(component, state) {
        if (!component) return;
        if (component.presenterReadyPromise) {
            await component.presenterReadyPromise.catch(() => {});
        }
        component.webSkelPresenter?.setState?.(state);
    }

    async createUser(detail) {
        this.setStatus('Creating user...');
        await this.request(this.apiBase, {
            method: 'POST',
            body: JSON.stringify({
                username: detail.username,
                password: detail.password,
                name: detail.name,
                roles: parseRoles(detail.roles)
            })
        });
        await this.reloadAfterMutation();
    }

    async saveUser(userId, body) {
        if (!userId) return;
        this.setStatus('Saving user...');
        await this.request(`${this.apiBase}/${encodeURIComponent(userId)}`, {
            method: 'PATCH',
            body: JSON.stringify(body || {})
        });
        await this.reloadAfterMutation();
    }

    async deleteUser(userId) {
        if (!userId) return;
        this.setStatus('Deleting user...');
        await this.request(`${this.apiBase}/${encodeURIComponent(userId)}`, { method: 'DELETE' });
        await this.reloadAfterMutation();
    }

    async saveBranding(detail) {
        this.setStatus('Saving login branding...');
        const payload = await this.request(this.settingsApi, {
            method: 'PATCH',
            body: JSON.stringify({
                loginBrandingName: detail.loginBrandingName
            })
        });
        this.state.loginBrandingName = payload.settings?.loginBrandingName || 'Login';
        await this.setChildState(this.brandingComponent, {
            loginBrandingName: this.state.loginBrandingName
        });
        this.setStatus('Login branding saved.', 'ok');
    }

    async saveAudit(detail) {
        this.setStatus('Saving audit settings...');
        const payload = await this.callDpuTool('dpu_audit_config_set', {
            enabled: detail.enabled === true,
            capture: normalizeAuditCapture(detail.capture)
        });
        this.state.auditConfig = {
            ...this.state.auditConfig,
            ...(payload.audit || {}),
            error: '',
            capture: normalizeAuditCapture(payload.audit?.capture)
        };
        await this.setChildState(this.auditComponent, {
            auditConfig: this.state.auditConfig
        });
        this.setStatus('Audit settings saved.', 'ok');
    }

    async reloadAfterMutation() {
        this.state.loaded = false;
        await this.loadPage({ force: true });
    }

    switchAdministrationTab(_target, tab) {
        this.state.activeTab = ['users', 'branding', 'audit'].includes(tab) ? tab : 'users';
        this.updateTabUI();
    }

    updateTabUI() {
        this.tabButtons?.forEach((button) => {
            const active = button.dataset.tab === this.state.activeTab;
            button.classList.toggle('active', active);
            button.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        this.tabPanels?.forEach((panel) => {
            const active = panel.dataset.panel === this.state.activeTab;
            panel.classList.toggle('active', active);
            panel.hidden = !active;
        });
    }

    setStatus(message, kind = '') {
        if (!this.statusEl) return;
        this.statusEl.textContent = message || '';
        this.statusEl.className = `status${kind ? ` ${kind}` : ''}`;
    }

    async request(path, options = {}) {
        const response = await fetch(path, {
            credentials: 'include',
            headers: {
                Accept: 'application/json',
                ...(options.body ? { 'Content-Type': 'application/json' } : {})
            },
            ...options
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false) {
            throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
        }
        return payload;
    }

    async callDpuTool(name, args = {}) {
        const services = this.getAppServices();
        if (!services) {
            throw new Error('DPU MCP client is not available in this view.');
        }
        if (typeof services.callTool === 'function') {
            const result = await services.callTool('dpuAgent', name, args);
            return normalizeToolResult(result);
        }
        const client = services.getClient?.('dpuAgent');
        if (!client || typeof client.callTool !== 'function') {
            throw new Error('DPU MCP client is not available in this view.');
        }
        return normalizeToolResult(await client.callTool(name, args));
    }

    getAppServices() {
        const candidates = [
            () => window.webSkel?.appServices,
            () => window.assistOS?.appServices
        ];
        for (const resolve of candidates) {
            try {
                const services = resolve();
                if (services?.callTool || services?.getClient) return services;
            } catch (_) {
                // Ignore unavailable integration.
            }
        }
        return null;
    }
}
