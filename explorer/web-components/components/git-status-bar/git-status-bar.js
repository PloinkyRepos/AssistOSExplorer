export class GitStatusBar {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.state = {
            text: '',
            isError: false
        };
        this.onUpdate = this.onUpdate.bind(this);
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.root = this.element.querySelector('.git-status') || this.element;
        this.textNode = this.element.querySelector('.git-status-text');
        if (!this.element.dataset.boundStatusUpdate) {
            this.element.addEventListener('git-status-update', this.onUpdate);
            this.element.dataset.boundStatusUpdate = 'true';
        }
        this.applyState(this.state);
    }

    setState(next = {}) {
        this.applyState(next);
    }

    onUpdate(event) {
        this.applyState(event?.detail || {});
    }

    applyState(next = {}) {
        if (!next || typeof next !== 'object') return;
        if (Object.prototype.hasOwnProperty.call(next, 'text')) {
            this.state.text = String(next.text || '');
        }
        if (Object.prototype.hasOwnProperty.call(next, 'isError')) {
            this.state.isError = Boolean(next.isError);
        }
        if (this.textNode) {
            this.textNode.textContent = this.state.text;
        } else if (this.root) {
            this.root.textContent = this.state.text;
        }
        if (this.root) {
            this.root.classList.toggle('error', this.state.isError);
        }
    }

    emit(name, detail = {}) {
        this.element.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
    }
}
