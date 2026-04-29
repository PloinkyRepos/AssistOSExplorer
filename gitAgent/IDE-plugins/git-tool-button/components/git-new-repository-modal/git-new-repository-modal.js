export class GitNewRepositoryModal {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.form = null;
        this.errorNode = null;
        this.boundSubmit = (event) => {
            event.preventDefault();
            this.confirm();
        };
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.form = this.element.querySelector('[data-git-new-repository-form]');
        this.errorNode = this.element.querySelector('[data-git-new-repository-error]');
        this.form?.removeEventListener('submit', this.boundSubmit);
        this.form?.addEventListener('submit', this.boundSubmit);
        this.element.querySelector('#gitNewRepositoryName')?.focus();
    }

    afterUnload() {
        this.form?.removeEventListener('submit', this.boundSubmit);
    }

    closeModal() {
        assistOS.UI.closeModal(this.element);
    }

    setError(message) {
        if (!this.errorNode) return;
        this.errorNode.textContent = message;
        this.errorNode.hidden = !message;
    }

    readValue(name) {
        const input = this.form?.elements?.[name];
        return String(input?.value || '').trim();
    }

    confirm() {
        if (!this.form?.reportValidity()) {
            return;
        }
        const name = this.readValue('name');
        const remote = this.readValue('remote') || 'origin';
        const remoteUrl = this.readValue('remoteUrl');
        if (!name) {
            this.setError('Repository name is required.');
            return;
        }
        if (!remote) {
            this.setError('Remote name is required.');
            return;
        }
        if (!remoteUrl) {
            this.setError('Remote URL is required.');
            return;
        }
        this.setError('');
        assistOS.UI.closeModal(this.element, { name, remote, remoteUrl });
    }
}
