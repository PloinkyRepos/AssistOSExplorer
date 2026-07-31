import {
    buildMarkdownLink,
    validateMarkdownLinkDestination
} from "../../components/markdown-editor/markdown-editor-media.js";

export class MarkdownLinkModal {
    constructor(element, invalidate, props = {}) {
        this.element = element;
        this.invalidate = invalidate;
        this.initialLabel = String(props.label || '');
        this.boundHandleSubmit = this.handleSubmit.bind(this);
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.form = this.element.querySelector('.markdown-link-form');
        this.labelInput = this.element.querySelector('#markdown-link-label');
        this.urlInput = this.element.querySelector('#markdown-link-url');
        this.titleInput = this.element.querySelector('#markdown-link-title');
        this.errorElement = this.element.querySelector('[data-role="link-error"]');
        this.previewElement = this.element.querySelector('[data-role="link-preview"]');

        if (this.labelInput) this.labelInput.value = this.initialLabel;
        this.form?.addEventListener('submit', this.boundHandleSubmit);
        for (const input of [this.labelInput, this.urlInput, this.titleInput]) {
            input?.addEventListener('input', () => {
                this.setError('');
                this.updatePreview();
            });
        }
        this.updatePreview();
        window.setTimeout(() => this.urlInput?.focus(), 0);
    }

    getValues() {
        return {
            label: this.labelInput?.value || '',
            url: this.urlInput?.value || '',
            title: this.titleInput?.value || ''
        };
    }

    updatePreview() {
        if (!this.previewElement) return;
        const values = this.getValues();
        if (!String(values.url || '').trim()) {
            this.previewElement.textContent = '[Link text](https://example.com)';
            this.previewElement.classList.add('is-placeholder');
            return;
        }
        try {
            this.previewElement.textContent = buildMarkdownLink(values);
            this.previewElement.classList.remove('is-placeholder');
        } catch {
            this.previewElement.textContent = 'Complete a valid URL to preview the Markdown link.';
            this.previewElement.classList.add('is-placeholder');
        }
    }

    setError(message) {
        if (!this.errorElement) return;
        this.errorElement.textContent = String(message || '');
        this.errorElement.hidden = !message;
        this.urlInput?.setAttribute('aria-invalid', message ? 'true' : 'false');
    }

    handleSubmit(event) {
        event.preventDefault();
        this.insertLink(this.element);
    }

    insertLink(target) {
        const values = this.getValues();
        try {
            validateMarkdownLinkDestination(values.url);
            assistOS.UI.closeModal(target, values);
        } catch (error) {
            this.setError(error?.message || 'Enter a valid link.');
            this.urlInput?.focus();
        }
    }

    closeModal(target) {
        assistOS.UI.closeModal(target);
    }

    afterUnload() {
        this.form?.removeEventListener('submit', this.boundHandleSubmit);
    }
}
