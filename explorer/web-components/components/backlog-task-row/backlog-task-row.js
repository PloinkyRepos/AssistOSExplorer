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
        this.proposedSolutionInput = this.element.querySelector('[data-field="proposedSolution"]');
        this.typeSelect = this.element.querySelector('[data-field="type"]');
        this.typeLabel = this.element.querySelector('[data-field="typeLabel"]');
        this.typeTrigger = this.element.querySelector('[data-local-action="toggleTypeMenu"]');
        this.typeMenu = this.element.querySelector('[data-field="typeMenu"]');
        this.prioritySelect = this.element.querySelector('[data-field="priority"]');
        this.priorityLabel = this.element.querySelector('[data-field="priorityLabel"]');
        this.priorityDot = this.element.querySelector('[data-field="priorityDot"]');
        this.priorityTrigger = this.element.querySelector('[data-local-action="togglePriorityMenu"]');
        this.priorityMenu = this.element.querySelector('[data-field="priorityMenu"]');
        this.observationsInput = this.element.querySelector('[data-field="observations"]');
        this.metaLine = this.element.querySelector('[data-field="meta"]');
        this.typeIcon = this.element.querySelector('[data-field="typeIcon"]');
        this.statusIcon = this.element.querySelector('[data-field="statusIcon"]');
        this.statusLabel = this.element.querySelector('[data-field="statusLabel"]');
        this.quickActions = this.element.querySelector('[data-field="quickActions"]');
        this.deleteButton = this.element.querySelector('[data-local-action="deleteTask"]');
    }

    loadFromAttributes() {
        const taskPayload = this.element.getAttribute('data-task');
        const typesPayload = this.element.getAttribute('data-types');
        const statusesPayload = this.element.getAttribute('data-statuses');
        const prioritiesPayload = this.element.getAttribute('data-priorities');
        this.state.task = this.parsePayload(taskPayload) || {};
        this.state.types = this.parsePayload(typesPayload) || {};
        this.state.statuses = this.parsePayload(statusesPayload) || {};
        this.state.priorities = this.parsePayload(prioritiesPayload) || {};
        this.state.repos = [];
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
            this.syncTypeIcon();
            this.resizeDescription();
            this.resizeProposedSolution();
            this.resizeObservations();
        };
        for (const input of [this.descInput, this.proposedSolutionInput, this.typeSelect, this.prioritySelect, this.observationsInput]) {
            if (!input) continue;
            input.addEventListener('input', markDirty);
            input.addEventListener('change', markDirty);
        }
    }

    applyState() {
        const task = this.state.task || {};
        if (this.descInput) this.descInput.value = task.description || '';
        if (this.proposedSolutionInput) this.proposedSolutionInput.value = task.proposedSolution || '';
        if (this.observationsInput) this.observationsInput.value = task.observations || '';

        if (this.typeSelect) {
            this.typeSelect.innerHTML = '';
            for (const [key, label] of Object.entries(this.state.types || {})) {
                this.typeSelect.appendChild(new Option(label, key));
            }
            if (task.type) this.typeSelect.value = task.type;
        }
        this.syncTypeIcon();
        this.renderTypeMenu();
        this.syncStatusIcon();
        if (this.prioritySelect) {
            this.prioritySelect.innerHTML = '';
            for (const [key, label] of Object.entries(this.state.priorities || {})) {
                this.prioritySelect.appendChild(new Option(label, key));
            }
            if (task.priority) this.prioritySelect.value = task.priority;
        }
        this.syncPriorityDisplay();
        this.renderPriorityMenu();
        this.updateQuickActions();
        this.updateFieldAccess();
        this.syncStatusIcon();

        if (this.metaLine) {
            const updated = task.updatedAt ? new Date(task.updatedAt).toLocaleString() : '';
            this.metaLine.textContent = updated ? `Updated: ${updated}` : '';
        }
        this.resizeDescription();
        this.resizeProposedSolution();
        this.resizeObservations();
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
        if (this.typeLabel) {
            this.typeLabel.textContent = label || 'Type';
        }
    }

    syncPriorityDisplay() {
        const priority = String(this.prioritySelect?.value || '').trim();
        const label = this.state.priorities?.[priority] || priority || 'Priority';
        if (this.priorityLabel) {
            this.priorityLabel.textContent = label || 'Priority';
        }
        if (this.priorityDot) {
            this.priorityDot.className = 'backlog-task-priority-dot';
            if (priority) {
                this.priorityDot.classList.add(`priority-${priority}`);
            }
        }
    }

    renderTypeMenu() {
        if (!this.typeMenu) return;
        const items = Object.entries(this.state.types || {});
        this.typeMenu.innerHTML = '';
        for (const [key, label] of items) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'backlog-task-type-option';
            button.setAttribute('data-local-action', `selectType ${key}`);
            button.innerHTML = `<span class="backlog-task-type-icon type-${key}">${label ? label[0].toUpperCase() : '?'}</span><span>${label}</span>`;
            this.typeMenu.appendChild(button);
        }
    }

    renderPriorityMenu() {
        if (!this.priorityMenu) return;
        const items = Object.entries(this.state.priorities || {});
        this.priorityMenu.innerHTML = '';
        for (const [key, label] of items) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'backlog-task-priority-option';
            button.setAttribute('data-local-action', `selectPriority ${key}`);
            button.innerHTML = `<span class="backlog-task-priority-dot priority-${key}"></span><span>${label}</span>`;
            this.priorityMenu.appendChild(button);
        }
    }

    toggleTypeMenu(_element) {
        if (!this.typeMenu) return;
        const isOpen = this.typeMenu.classList.contains('is-open');
        this.typeMenu.classList.toggle('is-open', !isOpen);
        if (!isOpen) {
            this.bindOutsideTypeMenu();
        } else {
            this.unbindOutsideTypeMenu();
        }
    }

    bindOutsideTypeMenu() {
        if (this.typeMenuController) return;
        this.typeMenuController = new AbortController();
        const close = (event) => {
            if (!this.typeMenu?.contains(event.target) && !event.target.closest?.('[data-local-action="toggleTypeMenu"]')) {
                this.typeMenu?.classList.remove('is-open');
                this.unbindOutsideTypeMenu();
            }
        };
        const onKeydown = (event) => {
            if (event.key === 'Escape') {
                this.typeMenu?.classList.remove('is-open');
                this.unbindOutsideTypeMenu();
            }
        };
        document.addEventListener('click', close, { signal: this.typeMenuController.signal, capture: true });
        document.addEventListener('keydown', onKeydown, { signal: this.typeMenuController.signal });
    }

    togglePriorityMenu(_element) {
        if (!this.priorityMenu) return;
        const isOpen = this.priorityMenu.classList.contains('is-open');
        this.priorityMenu.classList.toggle('is-open', !isOpen);
        if (!isOpen) {
            this.bindOutsidePriorityMenu();
        } else {
            this.unbindOutsidePriorityMenu();
        }
    }

    bindOutsidePriorityMenu() {
        if (this.priorityMenuController) return;
        this.priorityMenuController = new AbortController();
        const close = (event) => {
            if (!this.priorityMenu?.contains(event.target) && !event.target.closest?.('[data-local-action="togglePriorityMenu"]')) {
                this.priorityMenu?.classList.remove('is-open');
                this.unbindOutsidePriorityMenu();
            }
        };
        const onKeydown = (event) => {
            if (event.key === 'Escape') {
                this.priorityMenu?.classList.remove('is-open');
                this.unbindOutsidePriorityMenu();
            }
        };
        document.addEventListener('click', close, { signal: this.priorityMenuController.signal, capture: true });
        document.addEventListener('keydown', onKeydown, { signal: this.priorityMenuController.signal });
    }

    unbindOutsidePriorityMenu() {
        if (this.priorityMenuController) {
            this.priorityMenuController.abort();
            this.priorityMenuController = null;
        }
    }

    unbindOutsideTypeMenu() {
        if (this.typeMenuController) {
            this.typeMenuController.abort();
            this.typeMenuController = null;
        }
    }

    selectType(_element, type) {
        if (!this.typeSelect) return;
        const nextType = String(type || '').trim();
        if (!nextType) return;
        this.typeSelect.value = nextType;
        this.syncTypeIcon();
        if (this.typeMenu) this.typeMenu.classList.remove('is-open');
        this.unbindOutsideTypeMenu();
        this.getParentPresenter()?.saveTask?.({
            id: this.state.task?.id,
            type: nextType,
            taskHash: this.state.task?.taskHash,
            sourcePath: this.state.task?.sourcePath
        });
    }

    selectPriority(_element, priority) {
        if (!this.prioritySelect) return;
        const nextPriority = String(priority || '').trim();
        if (!nextPriority) return;
        this.prioritySelect.value = nextPriority;
        this.syncPriorityDisplay();
        if (this.priorityMenu) this.priorityMenu.classList.remove('is-open');
        this.unbindOutsidePriorityMenu();
        this.getParentPresenter()?.saveTask?.({
            id: this.state.task?.id,
            priority: nextPriority,
            taskHash: this.state.task?.taskHash,
            sourcePath: this.state.task?.sourcePath
        });
    }

    syncStatusIcon() {
        if (!this.statusIcon) return;
        const status = String(this.state.task?.status || '').trim();
        const label = this.state.statuses?.[status] || status || '';
        this.statusIcon.className = 'backlog-task-status';
        if (status) {
            this.statusIcon.classList.add(`status-${status}`);
        }
        this.statusIcon.title = label || 'Status';
        this.statusIcon.setAttribute('aria-label', label || 'Status');
        if (this.statusLabel) {
            this.statusLabel.textContent = label || 'Status';
        }
    }

    updateFieldAccess() {
        const status = String(this.state.task?.status || '').trim();
        const editableStatuses = new Set(['new', 'rejected', 'test-ready', 'testing', 'done']);
        const canEditAll = editableStatuses.has(status);
        if (this.descInput) this.descInput.disabled = !canEditAll;
        if (this.proposedSolutionInput) this.proposedSolutionInput.disabled = !canEditAll;
        if (this.typeSelect) this.typeSelect.disabled = !canEditAll;
        if (this.prioritySelect) this.prioritySelect.disabled = !canEditAll;
        if (this.observationsInput) this.observationsInput.disabled = false;
        if (this.typeTrigger) this.typeTrigger.disabled = !canEditAll;
        if (this.priorityTrigger) this.priorityTrigger.disabled = !canEditAll;
    }

    updateQuickActions() {
        if (!this.quickActions) return;
        const status = String(this.state.task?.status || '').trim();
        const visibility = {
            approveTask: status === 'new',
            rejectTask: status === 'new',
            reopenTask: status === 'rejected' || status === 'test-ready' || status === 'testing' || status === 'done',
            markTestReady: status === 'approved' || status === 'reopened',
            markDone: status === 'test-ready' || status === 'testing'
        };
        for (const button of Array.from(this.quickActions.querySelectorAll('button[data-local-action]'))) {
            const action = button.getAttribute('data-local-action');
            const show = Boolean(visibility[action]);
            button.style.display = show ? '' : 'none';
        }
    }

    resizeDescription() {
        if (!this.descInput) return;
        this.descInput.style.height = 'auto';
        this.descInput.style.height = `${this.descInput.scrollHeight}px`;
    }

    resizeProposedSolution() {
        if (!this.proposedSolutionInput) return;
        this.proposedSolutionInput.style.height = 'auto';
        this.proposedSolutionInput.style.height = `${this.proposedSolutionInput.scrollHeight}px`;
    }

    resizeObservations() {
        if (!this.observationsInput) return;
        this.observationsInput.style.height = 'auto';
        this.observationsInput.style.height = `${this.observationsInput.scrollHeight}px`;
    }


    saveTask() {
        const task = this.state.task || {};
        const payload = {
            id: task.id,
            description: this.descInput?.value || '',
            proposedSolution: this.proposedSolutionInput?.value || '',
            observations: this.observationsInput?.value || '',
            type: this.typeSelect?.value || '',
            priority: this.prioritySelect?.value || '',
            taskHash: task.taskHash,
            sourcePath: task.sourcePath
        };
        this.getParentPresenter()?.saveTask?.(payload);
    }

    approveTask() {
        this.dispatchStatus('approved');
    }

    rejectTask() {
        this.dispatchStatus('rejected');
    }

    reopenTask() {
        this.dispatchStatus('reopened');
    }

    markTestReady() {
        this.dispatchStatus('test-ready');
    }

    markDone() {
        this.dispatchStatus('done');
    }

    dispatchStatus(status) {
        const task = this.state.task || {};
        const payload = {
            id: task.id,
            status,
            description: this.descInput?.value || '',
            proposedSolution: this.proposedSolutionInput?.value || '',
            observations: this.observationsInput?.value || '',
            type: this.typeSelect?.value || '',
            priority: this.prioritySelect?.value || '',
            taskHash: task.taskHash,
            sourcePath: task.sourcePath
        };
        this.getParentPresenter()?.updateTaskStatus?.(payload);
    }

    deleteTask() {
        const task = this.state.task || {};
        this.getParentPresenter()?.deleteTask?.({ id: task.id, sourcePath: task.sourcePath });
    }

    getParentPresenter() {
        return this.element.closest('backlog-panel')?.webSkelPresenter || null;
    }
}
