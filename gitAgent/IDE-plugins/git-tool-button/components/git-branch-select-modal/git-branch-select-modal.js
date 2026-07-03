export class GitBranchSelectModal {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.titleText = this.escapeHtml(this.element.getAttribute('data-title') || 'Select branch');
        this.branches = this.parseJsonAttribute('data-branches');
        this.filterValue = '';
        this.branchesHTML = '';
        this.boundInput = (event) => {
            if (event.target?.matches?.('#gitBranchSelectFilter')) {
                this.filterValue = String(event.target.value || '');
                this.renderBranches();
            }
        };
        this.boundClick = (event) => {
            const item = event.target?.closest?.('[data-branch-name]');
            if (item && this.element.contains(item)) {
                this.selectBranch(item);
            }
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

    getVisibleBranches() {
        const filter = this.filterValue.trim().toLowerCase();
        return this.branches.filter((branch) => {
            const name = String(branch?.name || '');
            if (!name) return false;
            return !filter || name.toLowerCase().includes(filter);
        });
    }

    renderBranchItem(branch) {
        const name = this.escapeHtml(branch.name);
        const type = branch.type === 'remote' ? 'remote' : 'local';
        const current = branch.current ? ' current' : '';
        const meta = this.escapeHtml(`${type}${current}`);
        return `
            <button type="button" class="git-branch-select-item" data-branch-name="${name}" role="option">
                <span class="git-branch-select-name">${name}</span>
                <span class="git-branch-select-meta">${meta}</span>
            </button>
        `.trim();
    }

    beforeRender() {
        const visible = this.getVisibleBranches();
        this.branchesHTML = visible.length
            ? visible.map((branch) => this.renderBranchItem(branch)).join('')
            : '<div class="git-branch-select-empty">No branches found.</div>';
    }

    afterRender() {
        this.element.removeEventListener('input', this.boundInput);
        this.element.addEventListener('input', this.boundInput);
        this.element.removeEventListener('click', this.boundClick);
        this.element.addEventListener('click', this.boundClick);
        const filter = this.element.querySelector('#gitBranchSelectFilter');
        if (filter) {
            filter.value = this.filterValue;
            filter.focus();
        }
    }

    afterUnload() {
        this.element.removeEventListener('input', this.boundInput);
        this.element.removeEventListener('click', this.boundClick);
    }

    renderBranches() {
        const list = this.element.querySelector('.git-branch-select-list');
        if (!list) return;
        const visible = this.getVisibleBranches();
        list.innerHTML = visible.length
            ? visible.map((branch) => this.renderBranchItem(branch)).join('')
            : '<div class="git-branch-select-empty">No branches found.</div>';
    }

    cancel() {
        assistOS.UI.closeModal(this.element, null);
    }

    selectBranch(element) {
        const name = String(element?.dataset?.branchName || '').trim();
        if (!name) return;
        const branch = this.branches.find((entry) => entry?.name === name) || { name };
        assistOS.UI.closeModal(this.element, { branch });
    }
}
