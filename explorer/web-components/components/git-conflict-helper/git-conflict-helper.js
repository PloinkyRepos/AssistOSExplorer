export class GitConflictHelper {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.state = {
            visible: false,
            files: [],
            selected: null,
            ours: '',
            theirs: '',
            choice: '',
            status: '',
            loading: false,
            source: ''
        };
        this.onUpdate = this.onUpdate.bind(this);
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.root = this.element.querySelector('#gitConflictHelper') || this.element;
        this.list = this.element.querySelector('#gitConflictHelperList');
        this.oursNode = this.element.querySelector('#gitConflictHelperOurs');
        this.theirsNode = this.element.querySelector('#gitConflictHelperTheirs');
        this.oursTitle = this.element.querySelector('#gitConflictHelperOursTitle');
        this.theirsTitle = this.element.querySelector('#gitConflictHelperTheirsTitle');
        this.statusNode = this.element.querySelector('#gitConflictHelperStatus');
        this.choiceButtons = Array.from(this.element.querySelectorAll('.git-conflict-choice'));
        this.saveButton = this.element.querySelector('.git-conflict-save');

        if (!this.element.dataset.boundConflictUpdate) {
            this.element.addEventListener('git-conflict-update', this.onUpdate);
            this.element.dataset.boundConflictUpdate = 'true';
        }

        this.applyState(this.state);
    }

    selectConflictFile(element) {
        const repoPath = element?.dataset?.repoPath || '';
        const filePath = element?.dataset?.filePath || '';
        if (!filePath) return;
        this.emit('git-conflict-select', { repoPath, filePath });
    }

    applyConflictChoice(_element, source) {
        const selected = this.state.selected || {};
        if (!selected.filePath || !selected.repoPath) return;
        const side = String(source || '').trim();
        if (side !== 'ours' && side !== 'theirs') return;
        this.emit('git-conflict-apply', {
            repoPath: selected.repoPath,
            filePath: selected.filePath,
            source: side
        });
    }

    saveConflictResolution() {
        const selected = this.state.selected || {};
        if (!selected.filePath || !selected.repoPath) return;
        this.emit('git-conflict-save', {
            repoPath: selected.repoPath,
            filePath: selected.filePath,
            choice: this.state.choice || ''
        });
    }

    cancelConflictResolution() {
        this.emit('git-conflict-cancel');
    }

    setState(next = {}) {
        this.applyState(next);
    }

    onUpdate(event) {
        this.applyState(event?.detail || {});
    }

    applyState(next) {
        if (!next || typeof next !== 'object') return;
        if (Object.prototype.hasOwnProperty.call(next, 'visible')) {
            this.state.visible = Boolean(next.visible);
        }
        if (Array.isArray(next.files)) {
            this.state.files = next.files;
        }
        if (Object.prototype.hasOwnProperty.call(next, 'selected')) {
            this.state.selected = next.selected || null;
        }
        if (Object.prototype.hasOwnProperty.call(next, 'ours')) {
            this.state.ours = String(next.ours || '');
        }
        if (Object.prototype.hasOwnProperty.call(next, 'theirs')) {
            this.state.theirs = String(next.theirs || '');
        }
        if (Object.prototype.hasOwnProperty.call(next, 'choice')) {
            this.state.choice = String(next.choice || '');
        }
        if (Object.prototype.hasOwnProperty.call(next, 'status')) {
            this.state.status = String(next.status || '');
        }
        if (Object.prototype.hasOwnProperty.call(next, 'loading')) {
            this.state.loading = Boolean(next.loading);
        }
        if (Object.prototype.hasOwnProperty.call(next, 'source')) {
            this.state.source = String(next.source || '');
        }

        this.element.classList.toggle('is-visible', this.state.visible);
        if (this.list) {
            this.list.textContent = '';
            for (const file of this.state.files || []) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'git-conflict-helper-file';
                if (this.state.selected && this.state.selected.filePath === file.filePath && this.state.selected.repoPath === file.repoPath) {
                    button.classList.add('active');
                }
                button.dataset.repoPath = file.repoPath || '';
                button.dataset.filePath = file.filePath || '';
                button.setAttribute('data-local-action', 'selectConflictFile');
                button.textContent = file.label || file.filePath || '';
                this.list.appendChild(button);
            }
        }
        if (this.oursNode) {
            this.oursNode.textContent = this.state.loading ? 'Loading local version...' : (this.state.ours || '');
        }
        if (this.theirsNode) {
            this.theirsNode.textContent = this.state.loading ? 'Loading remote version...' : (this.state.theirs || '');
        }
        if (this.oursTitle || this.theirsTitle) {
            const source = (this.state.source || '').toLowerCase();
            if (source === 'stash') {
                if (this.oursTitle) this.oursTitle.textContent = 'Working tree (ours)';
                if (this.theirsTitle) this.theirsTitle.textContent = 'Stash (theirs)';
            } else {
                if (this.oursTitle) this.oursTitle.textContent = 'Local (ours)';
                if (this.theirsTitle) this.theirsTitle.textContent = 'Remote (theirs)';
            }
        }
        if (this.statusNode) {
            this.statusNode.textContent = this.state.status || '';
        }
        if (this.choiceButtons?.length) {
            const disableChoices = Boolean(this.state.loading);
            for (const button of this.choiceButtons) {
                const action = button.getAttribute('data-local-action') || '';
                const selected = action.includes('ours') ? 'ours' : action.includes('theirs') ? 'theirs' : '';
                button.classList.toggle('is-selected', Boolean(selected && selected === this.state.choice));
                button.disabled = disableChoices;
                button.classList.toggle('is-disabled', disableChoices);
            }
        }
        if (this.saveButton) {
            const canSave = Boolean(this.state.choice) && !this.state.loading;
            this.saveButton.disabled = !canSave;
            this.saveButton.classList.toggle('is-ready', canSave);
        }
    }

    emit(name, detail = {}) {
        this.element.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
    }
}
