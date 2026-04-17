import {
    callAgentTool,
    ensureSuccess,
    parseToolResult
} from "/explorer/services/infrastructure/explorerApi.js";

const AUDIT_PATH = '/Confidential/Audit';

async function callDpu(toolName, args = {}) {
    const raw = await callAgentTool('dpuAgent', toolName, args, { raw: true });
    ensureSuccess(raw);
    return parseToolResult(raw) || {};
}

export class AuditAccountMenu {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.hostContext = {};
        this.state = {
            canViewFiles: false,
            loading: true
        };
        this.invalidate();
    }

    beforeRender() {}

    async afterRender() {
        this.openButton = this.element.querySelector('#auditOpenButton');
        await this.refreshState();
    }

    afterUnload() {}

    updateHostContext(context = {}) {
        this.hostContext = context;
    }

    getHostPresenter() {
        return this.element.closest('main')?.querySelector('file-exp')?.webSkelPresenter
            || document.querySelector('file-exp')?.webSkelPresenter
            || null;
    }

    async refreshState() {
        this.state.loading = true;
        this.renderState();
        try {
            const payload = await callDpu('dpu_audit_config_get');
            const audit = payload?.audit && typeof payload.audit === 'object' ? payload.audit : {};
            this.state.canViewFiles = Boolean(audit.canViewFiles);
        } catch (_) {
            this.state.canViewFiles = false;
        } finally {
            this.state.loading = false;
            this.renderState();
        }
    }

    renderState() {
        if (!this.openButton) {
            return;
        }
        if (this.state.loading) {
            this.openButton.hidden = true;
            return;
        }
        if (!this.state.canViewFiles) {
            this.element.hidden = true;
            return;
        }
        this.element.hidden = false;
        this.openButton.hidden = !this.state.canViewFiles;
    }

    async handleOpenClick(event) {
        if (!this.state.canViewFiles) {
            return;
        }
        const host = this.getHostPresenter();
        if (!host) {
            window.location.hash = `#file-exp${AUDIT_PATH}`;
            return;
        }
        try {
            await host.loadDirectory(AUDIT_PATH);
            host.state.selectedPath = '';
            host.invalidate?.();
            window.history.pushState(null, '', `#file-exp${AUDIT_PATH}`);
        } catch (error) {
            host.showStatus?.(error?.message || 'Failed to open audit logs.', true);
        }
    }
}
