function decodeAttribute(value) {
    if (typeof value !== 'string') return '';
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

export class PlanItem {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.isEditing = false;
        this.readAttributes();
        this.invalidate();
    }

    readAttributes() {
        this.id = decodeAttribute(this.element.getAttribute('data-id')) || '';
        this.description = decodeAttribute(this.element.getAttribute('data-description')) || '';
        this.status = decodeAttribute(this.element.getAttribute('data-status')) || 'proposed';
    }

    beforeRender() {
        this.readAttributes();
        this.statusLabel = this.status === 'accepted' ? 'Accepted' : 'Proposed';
        this.statusClass = this.status === 'accepted' ? 'is-accepted' : '';
        this.viewClass = this.isEditing ? 'is-hidden' : '';
        this.editClass = this.isEditing ? '' : 'is-hidden';
    }

    afterRender() {
        const textarea = this.element.querySelector('.plan-item__edit-input');
        if (textarea) {
            textarea.value = this.description;
        }
    }

    startEdit() {
        this.isEditing = true;
        this.invalidate();
    }

    cancelEdit() {
        this.isEditing = false;
        this.invalidate();
    }

    saveEdit() {
        const textarea = this.element.querySelector('.plan-item__edit-input');
        const updated = textarea ? textarea.value.trim() : '';
        if (updated) {
            this.description = updated;
            this.emit('update-item', { id: this.id, description: updated });
        }
        this.isEditing = false;
        this.invalidate();
    }

    acceptItem() {
        this.status = 'accepted';
        this.emit('accept-item', { id: this.id, accepted: true });
        this.invalidate();
    }

    regenerateItem() {
        const feedback = prompt('Add feedback for regeneration (optional):', '');
        this.emit('regenerate-item', { id: this.id, feedback: feedback || '' });
    }

    emit(name, detail) {
        this.element.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
    }
}
