import {
    callAgentTool,
    ensureSuccess,
    parseToolResult
} from "/explorer/services/infrastructure/explorerApi.js";

const METHOD_LABELS = {
    password: 'Username and password',
    emailCode: 'Email authentication code',
    passkey: 'Passkey',
    totp: 'TOTP verification'
};

async function callUserPersisto(toolName, args = {}) {
    const raw = await callAgentTool('userPersistoAgent', toolName, args, { raw: true });
    ensureSuccess(raw);
    return parseToolResult(raw) || {};
}

export class UserpersistoAccountMenu {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.state = {
            user: null,
            authMethods: [],
            enrollments: {},
            loading: true
        };
        this.invalidate();
    }

    beforeRender() {}

    async afterRender() {
        this.selectEl = this.element.querySelector('#userpersistoPreferredAuthMethod');
        this.preferredAuthField = this.element.querySelector('[data-role="preferredAuthField"]');
        this.setupTotpButton = this.element.querySelector('[data-role="setupTotpButton"]');
        await this.refreshProfile();
    }

    updateHostContext() {}

    async refreshProfile() {
        this.state.loading = true;
        this.renderState();
        try {
            const payload = await callUserPersisto('userpersisto_profile_get');
            this.state.user = payload.user || null;
            this.state.authMethods = [];
            this.state.enrollments = {};
        } catch (_) {
            this.state.user = null;
            this.state.authMethods = [];
            this.state.enrollments = {};
        } finally {
            this.state.loading = false;
            this.renderState();
        }
    }

    renderState() {
        if (!this.selectEl) return;
        const canChoose = Boolean(this.state.user) && this.state.authMethods.length > 1;
        const totpEnrollment = this.state.enrollments?.totp || {};
        const canSetupTotp = Boolean(this.state.user) && Boolean(totpEnrollment.allowed) && !totpEnrollment.configured;
        this.element.hidden = !canChoose && !canSetupTotp;
        if (this.preferredAuthField) {
            this.preferredAuthField.hidden = !canChoose;
        }
        if (this.setupTotpButton) {
            this.setupTotpButton.hidden = !canSetupTotp;
        }
        if (!canChoose) {
            this.selectEl.replaceChildren();
        } else {
            const preferred = String(this.state.user?.preferredAuthMethod || '').trim();
            this.selectEl.replaceChildren(...this.state.authMethods.map((method) => {
                const option = document.createElement('option');
                option.value = method.type;
                option.textContent = method.name || METHOD_LABELS[method.type] || method.type;
                return option;
            }));
            const available = this.state.authMethods.map((method) => method.type);
            this.selectEl.value = available.includes(preferred) ? preferred : available[0];
        }
    }

    async changePreferredAuthMethod(target) {
        const preferredAuthMethod = String(target?.value || '').trim();
        if (!preferredAuthMethod) return;
        try {
            this.renderState();
        } catch (error) {
            await this.refreshProfile();
            const message = error?.message || 'Failed to update preferred sign-in method.';
            window.webSkel?.notificationHandler?.reportUserRelevantError?.(message);
        }
    }

    async setupTotp() {
        try {
            const result = await assistOS.UI.showModal('userpersisto-totp-setup-modal', {}, true);
            if (result?.verified) {
                await this.refreshProfile();
            }
        } catch (error) {
            const message = error?.message || 'Failed to set up authenticator app.';
            window.webSkel?.notificationHandler?.reportUserRelevantError?.(message);
        }
    }
}
