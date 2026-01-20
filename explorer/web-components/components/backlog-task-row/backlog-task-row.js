export class BacklogTaskRow {
    constructor(element, invalidate, props = {}) {
        this.element = element;
        this.invalidate = invalidate;
        this.props = props || {};
        this.state = {
            task: null,
            types: {},
            statuses: {},
            priorities: {},
            repos: []
        };
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.cacheElements();
        this.loadFromAttributes();
        this.bindEvents();
        this.applyState();
    }

    cacheElements() {
        this.root = this.element.querySelector('.backlog-task-row');
        this.descInput = this.element.querySelector('[data-field="description"]');
        this.typeSelect = this.element.querySelector('[data-field="type"]');
        this.statusSelect = this.element.querySelector('[data-field="status"]');
        this.prioritySelect = this.element.querySelector('[data-field="priority"]');
        this.assigneeInput = this.element.querySelector('[data-field="assignee"]');
        this.tagsInput = this.element.querySelector('[data-field="tags"]');
        this.repoSelect = this.element.querySelector('[data-field="repo"]');
        this.observationsInput = this.element.querySelector('[data-field="observations"]');
        this.metaLine = this.element.querySelector('[data-field="meta"]');
        this.assigneeLabel = this.element.querySelector('[data-field="assigneeLabel"]');
        this.typeIcon = this.element.querySelector('[data-field="typeIcon"]');
        this.details = this.element.querySelector('[data-field="details"]');
        this.toggleButtons = Array.from(this.element.querySelectorAll('[data-local-action="toggleMore"]'));
        if (this.toggleButtons.length > 1) {
            this.toggleButtons[0].remove();
            this.toggleButtons = this.toggleButtons.slice(1);
        }
        this.saveButton = this.element.querySelector('[data-local-action="saveTask"]');
        this.deleteButton = this.element.querySelector('[data-local-action="deleteTask"]');
    }

    loadFromAttributes() {
        const taskPayload = this.element.getAttribute('data-task');
        const typesPayload = this.element.getAttribute('data-types');
        const statusesPayload = this.element.getAttribute('data-statuses');
        const prioritiesPayload = this.element.getAttribute('data-priorities');
        const reposPayload = this.element.getAttribute('data-repos');
        this.state.task = this.parsePayload(taskPayload) || {};
        this.state.types = this.parsePayload(typesPayload) || {};
        this.state.statuses = this.parsePayload(statusesPayload) || {};
        this.state.priorities = this.parsePayload(prioritiesPayload) || {};
        this.state.repos = Array.isArray(this.parsePayload(reposPayload)) ? this.parsePayload(reposPayload) : [];
    }

    parsePayload(raw) {
        if (!raw) return null;
        try {
            return JSON.parse(decodeURIComponent(raw));
        } catch {
            return null;
        }
    }

    bindEvents() {
        const markDirty = () => {
            if (this.saveButton) this.saveButton.disabled = false;
            this.syncAssigneeLabel();
            this.syncTypeIcon();
        };
        for (const input of [this.descInput, this.typeSelect, this.statusSelect, this.prioritySelect, this.assigneeInput, this.tagsInput, this.repoSelect, this.observationsInput]) {
            if (!input) continue;
            input.addEventListener('input', markDirty);
            input.addEventListener('change', markDirty);
        }
        for (const button of this.toggleButtons) {
            if (!button || button.dataset.boundToggle) continue;
            button.dataset.boundToggle = 'true';
            button.addEventListener('click', () => this.toggleMore());
        }
    }

    applyState() {
        const task = this.state.task || {};
        if (this.descInput) this.descInput.value = task.description || '';
        if (this.observationsInput) this.observationsInput.value = task.observations || '';
        if (this.assigneeInput) this.assigneeInput.value = task.assignee || '';
        if (this.tagsInput) this.tagsInput.value = Array.isArray(task.tags) ? task.tags.join(', ') : '';
        this.syncAssigneeLabel();

        if (this.typeSelect) {
            this.typeSelect.innerHTML = '';
            for (const [key, label] of Object.entries(this.state.types || {})) {
                this.typeSelect.appendChild(new Option(label, key));
            }
            if (task.type) this.typeSelect.value = task.type;
        }
        this.syncTypeIcon();
        if (this.statusSelect) {
            this.statusSelect.innerHTML = '';
            for (const [key, label] of Object.entries(this.state.statuses || {})) {
                this.statusSelect.appendChild(new Option(label, key));
            }
            if (task.status) this.statusSelect.value = task.status;
        }
        if (this.prioritySelect) {
            this.prioritySelect.innerHTML = '';
            for (const [key, label] of Object.entries(this.state.priorities || {})) {
                this.prioritySelect.appendChild(new Option(label, key));
            }
            if (task.priority) this.prioritySelect.value = task.priority;
        }
        if (this.repoSelect) {
            this.repoSelect.innerHTML = '';
            this.repoSelect.appendChild(new Option('No repo', ''));
            for (const repo of this.state.repos || []) {
                this.repoSelect.appendChild(new Option(repo.name || repo.path, repo.path));
            }
            this.repoSelect.value = task.repoPath || '';
        }

        if (this.metaLine) {
            const updated = task.updatedAt ? new Date(task.updatedAt).toLocaleString() : '';
            this.metaLine.textContent = updated ? `Updated: ${updated}` : '';
        }
    }

    syncAssigneeLabel() {
        if (!this.assigneeLabel) return;
        const assignee = String(this.assigneeInput?.value || '').trim();
        this.assigneeLabel.textContent = assignee || 'Unassigned';
    }

    syncTypeIcon() {
        if (!this.typeIcon) return;
        const type = String(this.typeSelect?.value || '').trim();
        const label = this.state.types?.[type] || type || '';
        this.typeIcon.textContent = label ? label[0].toUpperCase() : '?';
        this.typeIcon.className = 'backlog-task-type-icon';
        if (type) {
            this.typeIcon.classList.add(`type-${type}`);
        }
        this.typeIcon.title = label || 'Type';
    }

    toggleMore() {
        const root = this.root || this.element;
        root.classList.toggle('is-expanded');
        for (const button of this.toggleButtons) {
            if (!button) continue;
            button.textContent = root.classList.contains('is-expanded')
                ? 'Show less'
                : 'Show more';
        }
    }

    saveTask() {
        const task = this.state.task || {};
        const payload = {
            id: task.id,
            description: this.descInput?.value || '',
            observations: this.observationsInput?.value || '',
            type: this.typeSelect?.value || '',
            status: this.statusSelect?.value || '',
            priority: this.prioritySelect?.value || '',
            assignee: this.assigneeInput?.value || '',
            repoPath: this.repoSelect?.value || '',
            tags: (this.tagsInput?.value || '').split(',').map((tag) => tag.trim()).filter(Boolean)
        };
        this.element.dispatchEvent(new CustomEvent('backlog-task-save', { detail: payload, bubbles: true }));
        if (this.saveButton) this.saveButton.disabled = true;
    }

    deleteTask() {
        const task = this.state.task || {};
        this.element.dispatchEvent(new CustomEvent('backlog-task-delete', { detail: { id: task.id }, bubbles: true }));
    }
}
