import {
    escapeHtml,
    normalizeAuditCapture
} from '../admin-settings-panel/admin-settings-utils.js';

export class AdminAuditSettings {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.state = {
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
        this.host = this.element.querySelector('[data-role="auditHost"]') || this.element;
        this.render();
    }

    setState(next = {}) {
        if (next.auditConfig && typeof next.auditConfig === 'object') {
            this.state.auditConfig = {
                ...this.state.auditConfig,
                ...next.auditConfig,
                capture: normalizeAuditCapture(next.auditConfig.capture)
            };
        }
        this.render();
    }

    render() {
        if (!this.host) return;
        const config = this.state.auditConfig;
        const capture = normalizeAuditCapture(config.capture);
        if (config.error) {
            this.host.innerHTML = `<div class="audit-settings-error">${escapeHtml(config.error)}</div>`;
            return;
        }
        this.host.innerHTML = `
            <form class="audit-settings-form" data-role="auditSettingsForm">
                <label class="audit-toggle">
                    <input name="enabled" type="checkbox" ${config.enabled ? 'checked' : ''} ${config.canManage ? '' : 'disabled'}>
                    <span>Enable audit</span>
                </label>
                <div class="audit-capture-grid">
                    <label><input name="dpuOperations" type="checkbox" ${capture.dpuOperations ? 'checked' : ''} ${config.canManage ? '' : 'disabled'}> DPU operations</label>
                    <label><input name="fileAccess" type="checkbox" ${capture.fileAccess ? 'checked' : ''} ${config.canManage ? '' : 'disabled'}> File access</label>
                    <label><input name="explorerActions" type="checkbox" ${capture.explorerActions ? 'checked' : ''} ${config.canManage ? '' : 'disabled'}> Explorer actions</label>
                    <label><input name="pluginUsage" type="checkbox" ${capture.pluginUsage ? 'checked' : ''} ${config.canManage ? '' : 'disabled'}> Plugin usage</label>
                    <label><input name="aiActivity" type="checkbox" ${capture.aiActivity ? 'checked' : ''} ${config.canManage ? '' : 'disabled'}> AI activity metadata</label>
                </div>
                <button class="general-button" type="submit" ${config.canManage ? '' : 'disabled'}>Save</button>
            </form>
        `;
        this.host.querySelector('[data-role="auditSettingsForm"]')?.addEventListener('submit', (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            this.element.dispatchEvent(new CustomEvent('admin-audit-save', {
                bubbles: true,
                detail: {
                    enabled: data.get('enabled') === 'on',
                    capture: {
                        dpuOperations: data.get('dpuOperations') === 'on',
                        fileAccess: data.get('fileAccess') === 'on',
                        explorerActions: data.get('explorerActions') === 'on',
                        pluginUsage: data.get('pluginUsage') === 'on',
                        aiActivity: data.get('aiActivity') === 'on'
                    }
                }
            }));
        });
    }
}
