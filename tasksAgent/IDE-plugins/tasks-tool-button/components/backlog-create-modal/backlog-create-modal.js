export class BacklogCreateModal {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.props = element?.props || element?._componentProxy?.props || {};
        this.state = {
            options: []
        };
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.cacheElements();
        this.bindEvents();
    }

    cacheElements() {
        this.descInput = this.element.querySelector('#backlogModalDescription');
        this.optionsList = this.element.querySelector('#backlogModalOptionsList');
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
            this.element.addEventListener('input', (event) => {
                const optionIndex = Number(event.target?.dataset?.optionIndex);
                if (!Number.isInteger(optionIndex) || optionIndex < 0) {
                    return;
                }
                this.state.options[optionIndex] = String(event.target.value || '');
            });
            this.element.addEventListener('click', (event) => {
                const removeButton = event.target?.closest?.('[data-option-remove-index]');
                if (!removeButton) return;
                const optionIndex = Number(removeButton.dataset.optionRemoveIndex);
                if (!Number.isInteger(optionIndex) || optionIndex < 0) {
                    return;
                }
                event.preventDefault();
                this.removeOption(optionIndex);
            });
            this.element.dataset.boundBacklogCreate = 'true';
        }
        this.renderOptionRows();
    }

    renderOptionRows() {
        if (!this.optionsList) return;
        this.optionsList.innerHTML = '';
        if (!Array.isArray(this.state.options) || this.state.options.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'modal-options-empty';
            emptyState.textContent = 'No options yet — click "Add option" to define choices.';
            this.optionsList.appendChild(emptyState);
            return;
        }

        this.state.options.forEach((value, index) => {
            const item = document.createElement('div');
            item.className = 'modal-option-item';

            const header = document.createElement('div');
            header.className = 'modal-option-item-header';

            const label = document.createElement('label');
            label.className = 'modal-option-label';
            label.setAttribute('for', `backlogModalOption${index}`);
            label.textContent = `Option ${index + 1}`;

            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.className = 'modal-option-remove';
            removeButton.dataset.optionRemoveIndex = String(index);
            removeButton.textContent = 'Remove';

            const textarea = document.createElement('textarea');
            textarea.id = `backlogModalOption${index}`;
            textarea.className = 'backlog-option-input';
            textarea.rows = 2;
            textarea.spellcheck = false;
            textarea.dataset.optionIndex = String(index);
            textarea.value = String(value || '');
            textarea.placeholder = `Description for option ${index + 1}`;

            header.append(label, removeButton);
            item.append(header, textarea);
            this.optionsList.appendChild(item);
        });
    }

    addOption() {
        if (!Array.isArray(this.state.options)) {
            this.state.options = [];
        }
        this.state.options.push('');
        const nextIndex = this.state.options.length - 1;
        this.renderOptionRows();
        requestAnimationFrame(() => {
            const nextInput = this.element.querySelector(`#backlogModalOption${nextIndex}`);
            nextInput?.focus();
            nextInput?.select?.();
        });
    }

    removeOption(optionIndex) {
        if (!Array.isArray(this.state.options)) return;
        const item = this.element.querySelector(`[data-option-remove-index="${optionIndex}"]`)?.closest('.modal-option-item');
        if (item) {
            item.style.transition = 'opacity 0.15s ease, transform 0.15s ease';
            item.style.opacity = '0';
            item.style.transform = 'translateX(-8px)';
            setTimeout(() => {
                this.state.options.splice(optionIndex, 1);
                this.renderOptionRows();
            }, 150);
            return;
        }
        this.state.options.splice(optionIndex, 1);
        this.renderOptionRows();
    }

    createTask() {
        const description = String(this.descInput?.value || '').trim();
        if (!description) {
            this.descInput?.focus?.();
            this.descInput?.classList?.add?.('input-invalid');
            setTimeout(() => {
                this.descInput?.classList?.remove?.('input-invalid');
            }, 2000);
            return;
        }
        const options = (Array.isArray(this.state.options) ? this.state.options : [])
            .map((entry) => String(entry || '').trim())
            .filter(Boolean);
        this.closeModalWithPayload({ description, options });
    }

    closeModal(_element) {
        assistOS.UI.closeModal(this.element);
    }

    closeModalWithPayload(payload) {
        assistOS.UI.closeModal(this.element, payload);
    }
}
