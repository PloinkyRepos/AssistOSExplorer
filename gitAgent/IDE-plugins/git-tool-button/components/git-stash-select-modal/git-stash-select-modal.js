export class GitStashSelectModal {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.repoLabel = this.element.getAttribute('data-repoLabel') || 'this repository';
        this.stashes = this.parseStashes(this.element.getAttribute('data-stashes'));
        this.stashesHTML = '';
        this.invalidate();
    }

    parseStashes(raw) {
        if (!raw) return [];
        let decoded = '';
        try {
            decoded = decodeURIComponent(escape(atob(raw)));
        } catch {
            try {
                decoded = atob(raw);
            } catch {
                decoded = '';
            }
        }
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
        const items = Array.isArray(this.stashes) ? this.stashes : [];
        if (!items.length) {
            this.stashesHTML = '<div class="stash-item">No stashes found.</div>';
            return;
        }
        const rows = items.map((stash, index) => {
            const ref = this.escapeHtml(stash?.ref || '');
            const summary = this.escapeHtml(stash?.summary || stash?.message || stash?.raw || '');
            const checked = index === 0 ? 'checked' : '';
            return `
                <label class="stash-item">
                    <input type="radio" name="stashRef" value="${ref}" ${checked}>
                    <span class="stash-text">
                        <span class="stash-ref">${ref || 'stash'}</span>
                        <span class="stash-summary">${summary || 'No summary'}</span>
                    </span>
                </label>
            `.trim();
        });
        this.stashesHTML = rows.join('');
    }

    closeModal() {
        assistOS.UI.closeModal(this.element);
    }

    confirmSelection() {
        const selected = this.element.querySelector('input[name="stashRef"]:checked');
        const ref = selected?.value || '';
        assistOS.UI.closeModal(this.element, { ref });
    }
}
