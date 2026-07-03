export class GitBranchDirtyModal {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.actionLabel = this.escapeHtml(this.element.getAttribute('data-actionLabel') || 'the branch operation');
        this.counts = this.parseJsonAttribute('data-counts') || {};
        this.countsHTML = '';
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
        if (!decoded) return {};
        try {
            const parsed = JSON.parse(decoded);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
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
        const entries = [
            ['Staged', this.counts.staged || 0],
            ['Unstaged', this.counts.unstaged || 0],
            ['Untracked', this.counts.untracked || 0],
            ['Conflicted', this.counts.conflicted || 0]
        ].filter(([, value]) => value > 0);
        this.countsHTML = entries.length
            ? entries.map(([label, value]) => `<span class="git-branch-dirty-count">${label}: ${value}</span>`).join('')
            : '<span class="git-branch-dirty-count">No local changes</span>';
    }

    cancel() {
        assistOS.UI.closeModal(this.element, { policy: 'cancel' });
    }

    stashAndContinue() {
        assistOS.UI.closeModal(this.element, { policy: 'stash' });
    }

    runWithoutStash() {
        assistOS.UI.closeModal(this.element, { policy: 'run' });
    }
}
