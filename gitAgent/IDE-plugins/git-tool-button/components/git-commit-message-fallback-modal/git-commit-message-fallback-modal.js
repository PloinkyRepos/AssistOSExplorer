export class GitCommitMessageFallbackModal {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.files = this.parseJsonAttribute('data-files');
        this.messageText = this.escapeTextarea(this.decodeAttribute('data-message'));
        this.filesHTML = '';
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

    escapeTextarea(value) {
        return this.escapeHtml(value);
    }

    beforeRender() {
        const files = Array.isArray(this.files) ? this.files.filter(Boolean) : [];
        if (!files.length) {
            this.filesHTML = '<div class="git-commit-message-fallback-file">No files selected.</div>';
            return;
        }
        this.filesHTML = files
            .map((file) => `<div class="git-commit-message-fallback-file">${this.escapeHtml(file)}</div>`)
            .join('');
    }

    afterRender() {
        this.textarea = this.element.querySelector('#gitCommitMessageFallbackText');
        this.errorNode = this.element.querySelector('#gitCommitMessageFallbackError');
        this.textarea?.focus();
        this.textarea?.setSelectionRange?.(0, 0);
    }

    setError(message) {
        if (!this.errorNode) return;
        this.errorNode.textContent = message;
        this.errorNode.hidden = !message;
    }

    cancel() {
        assistOS.UI.closeModal(this.element, null);
    }

    continueWithMessage() {
        const message = String(this.textarea?.value || '').trim();
        if (!message) {
            this.setError('Commit message is required.');
            return;
        }
        this.setError('');
        assistOS.UI.closeModal(this.element, { message });
    }
}
