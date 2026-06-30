function extractToolText(result) {
    if (typeof result === 'string') return result;
    if (Array.isArray(result?.content)) {
        return result.content.filter((entry) => entry?.type === 'text').map((entry) => entry.text || '').join('\n');
    }
    return JSON.stringify(result || {});
}

function parseToolResult(result) {
    try {
        return JSON.parse(extractToolText(result));
    } catch {
        return {};
    }
}

export class EmailAgentSettings {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.state = { status: '', statusType: '', settings: {} };
        this.mcpClient = null;
        this.mcpClientPromise = null;
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.cacheElements();
        void this.loadSettings();
    }

    cacheElements() {
        this.statusEl = this.element.querySelector('#emailAgentSettingsStatus');
        this.inputs = {
            MAILJET_API_KEY: this.element.querySelector('#mailjetApiKey'),
            MAILJET_API_SECRET: this.element.querySelector('#mailjetApiSecret'),
            MAILJET_FROM_EMAIL: this.element.querySelector('#mailjetFromEmail'),
            MAILJET_FROM_NAME: this.element.querySelector('#mailjetFromName'),
            EMAIL_AUTH_CODE_TEMPLATE_ID: this.element.querySelector('#emailAuthCodeTemplateId')
        };
    }

    async ensureMcpClient() {
        if (this.mcpClient) return this.mcpClient;
        if (this.mcpClientPromise) return this.mcpClientPromise;
        this.mcpClientPromise = (async () => {
            const module = await import('/MCPBrowserClient.js');
            this.mcpClient = module.createAgentClient('/emailAgent/mcp');
            return this.mcpClient;
        })();
        try {
            return await this.mcpClientPromise;
        } finally {
            this.mcpClientPromise = null;
        }
    }

    async callTool(name, args = {}) {
        const client = await this.ensureMcpClient();
        const parsed = parseToolResult(await client.callTool(name, args));
        if (parsed?.ok === false) {
            throw new Error(parsed.error || `${name} failed.`);
        }
        return parsed;
    }

    setStatus(message, type = '') {
        if (!this.statusEl) return;
        this.statusEl.textContent = message || '';
        this.statusEl.classList.toggle('error', type === 'error');
    }

    async loadSettings() {
        try {
            const payload = await this.callTool('email_get_agent_settings');
            this.state.settings = payload.settings || {};
            Object.entries(this.state.settings).forEach(([key, entry]) => {
                const mask = this.element.querySelector(`[data-mask-for="${key}"]`);
                if (mask) mask.textContent = entry?.maskedValue ? `Current: ${entry.maskedValue}` : 'Not configured';
                const input = this.inputs[key];
                if (input && entry?.value && !input.value) {
                    input.value = entry.value;
                }
            });
            this.setStatus('');
        } catch (error) {
            this.setStatus(error?.message || 'Failed to load EmailAgent settings.', 'error');
        }
    }

    collectInputSettings() {
        const settings = {};
        Object.entries(this.inputs).forEach(([key, input]) => {
            const value = String(input?.value || '').trim();
            if (value) settings[key] = value;
        });
        return settings;
    }

    async saveSettings() {
        const settings = this.collectInputSettings();
        if (!Object.keys(settings).length) {
            this.setStatus('Enter at least one setting to save.');
            return;
        }
        try {
            await this.callTool('email_save_agent_settings', { settings });
            await this.loadSettings();
            this.setStatus('EmailAgent settings saved.');
        } catch (error) {
            this.setStatus(error?.message || 'Failed to save EmailAgent settings.', 'error');
        }
    }

    async testConfiguration() {
        try {
            const settings = this.collectInputSettings();
            if (Object.keys(settings).length) {
                await this.callTool('email_save_agent_settings', { settings });
                await this.loadSettings();
            }
            const result = await this.callTool('email_test_configuration');
            this.setStatus(result.ok ? 'EmailAgent configuration is complete.' : `Missing: ${(result.missing || []).join(', ')}`, result.ok ? '' : 'error');
        } catch (error) {
            this.setStatus(error?.message || 'Configuration test failed.', 'error');
        }
    }

    closeModal() {
        assistOS.UI.closeModal(this.element, null);
    }
}
