export class GitBranchCreateModal {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.branches = this.parseJsonAttribute('data-branches');
        this.currentBranch = this.element.getAttribute('data-currentBranch') || '';
        this.startPointOptionsHTML = '';
        this.boundSubmit = (event) => {
            event.preventDefault();
            this.submit();
        };
        this.invalidate();
    }

    decodeAttribute(name) {
        const raw = this.element.getAttribute(name) || '';
        if (!raw) return '';
        try {
            return decodeURIComponent(escape(atob(raw)));
        } catch {
            try {
                return atob(raw);
            } catch {
                return '';
            }
        }
    }

    parseJsonAttribute(name) {
        const decoded = this.decodeAttribute(name);
        if (!decoded) return [];
        try {
            const parsed = JSON.parse(decoded);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    beforeRender() {
        const names = [...new Set(this.branches.map((branch) => branch?.name).filter(Boolean))];
        const preferred = this.currentBranch || names[0] || '';
        this.startPointOptionsHTML = names.map((name) => {
            const escaped = this.escapeHtml(name);
            const selected = name === preferred ? ' selected' : '';
            return `<option value="${escaped}"${selected}>${escaped}</option>`;
        }).join('');
        if (!this.startPointOptionsHTML && preferred) {
            const escaped = this.escapeHtml(preferred);
            this.startPointOptionsHTML = `<option value="${escaped}" selected>${escaped}</option>`;
        }
    }

    afterRender() {
        const form = this.element.querySelector('.git-branch-create-modal');
        form?.removeEventListener('submit', this.boundSubmit);
        form?.addEventListener('submit', this.boundSubmit);
        this.element.querySelector('#gitBranchCreateName')?.focus();
    }

    afterUnload() {
        const form = this.element.querySelector('.git-branch-create-modal');
        form?.removeEventListener('submit', this.boundSubmit);
    }

    setError(message) {
        const node = this.element.querySelector('[data-git-branch-create-error]');
        if (!node) return;
        node.textContent = message;
        node.hidden = !message;
    }

    cancel() {
        assistOS.UI.closeModal(this.element, null);
    }

    submit() {
        const form = this.element.querySelector('.git-branch-create-modal');
        const name = String(form?.elements?.name?.value || '').trim();
        const startPoint = String(form?.elements?.startPoint?.value || '').trim();
        const checkout = Boolean(form?.elements?.checkout?.checked);
        if (!name) {
            this.setError('Branch name is required.');
            return;
        }
        this.setError('');
        assistOS.UI.closeModal(this.element, { name, startPoint, checkout });
    }
}
