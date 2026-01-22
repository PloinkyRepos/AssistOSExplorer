export class BacklogCreateModal {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.props = element?.props || element?._componentProxy?.props || {};
        this.state = {
            statuses: {},
            priorities: {},
            types: {},
            defaultStatus: '',
            defaultPriority: '',
            defaultType: ''
        };
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.cacheElements();
        this.loadProps();
        this.renderSelects();
        this.bindEvents();
    }

    cacheElements() {
        this.typeSelect = this.element.querySelector('#backlogModalType');
        this.statusSelect = this.element.querySelector('#backlogModalStatus');
        this.prioritySelect = this.element.querySelector('#backlogModalPriority');
        this.descInput = this.element.querySelector('#backlogModalDescription');
        this.proposedSolutionInput = this.element.querySelector('#backlogModalProposedSolution');
        this.observationsInput = this.element.querySelector('#backlogModalObservations');
    }

    loadProps() {
        const props = this.props || {};
        this.state.statuses = this.parsePayload(props.statuses) || {};
        this.state.priorities = this.parsePayload(props.priorities) || {};
        this.state.types = this.parsePayload(props.types) || {};
        this.state.defaultStatus = String(props.defaultStatus || '');
        this.state.defaultPriority = String(props.defaultPriority || '');
        this.state.defaultType = String(props.defaultType || '');
    }

    parsePayload(raw) {
        if (!raw) return null;
        try {
            return JSON.parse(decodeURIComponent(raw));
        } catch {
            return null;
        }
    }

    renderSelects() {
        if (this.typeSelect) {
            this.typeSelect.innerHTML = '';
            for (const [key, label] of Object.entries(this.state.types || {})) {
                this.typeSelect.appendChild(new Option(label, key));
            }
            if (this.state.defaultType) {
                this.typeSelect.value = this.state.defaultType;
            }
        }
        if (this.statusSelect) {
            this.statusSelect.innerHTML = '';
            for (const [key, label] of Object.entries(this.state.statuses || {})) {
                this.statusSelect.appendChild(new Option(label, key));
            }
            if (this.state.defaultStatus) {
                this.statusSelect.value = this.state.defaultStatus;
            }
        }
        if (this.prioritySelect) {
            this.prioritySelect.innerHTML = '';
            for (const [key, label] of Object.entries(this.state.priorities || {})) {
                this.prioritySelect.appendChild(new Option(label, key));
            }
            if (this.state.defaultPriority) {
                this.prioritySelect.value = this.state.defaultPriority;
            }
        }
    }

    bindEvents() {
        if (!this.element.dataset.boundBacklogCreate) {
            this.element.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    this.closeModal();
                }
            });
            this.element.dataset.boundBacklogCreate = 'true';
        }
    }

    createTask() {
        const description = String(this.descInput?.value || '').trim();
        if (!description) {
            alert('Description is required.');
            return;
        }
        const payload = {
            description,
            proposedSolution: this.proposedSolutionInput?.value || '',
            observations: this.observationsInput?.value || '',
            type: this.typeSelect?.value || '',
            status: this.statusSelect?.value || '',
            priority: this.prioritySelect?.value || '',
        };
        window.dispatchEvent(new CustomEvent('backlog-task-create', { detail: payload }));
        this.closeModal();
    }

    closeModal() {
        assistOS.UI.closeModal(this.element);
    }
}
