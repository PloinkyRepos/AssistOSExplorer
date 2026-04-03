export class GitIgnorePrompt {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.state = {
            visible: false,
            repoLabel: '',
            patterns: '',
            mode: 'file',
            anchor: true,
            count: 0,
            preview: [],
            source: 'manual',
            stopTracking: false
        };
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.root = this.element.querySelector('#gitIgnorePrompt') || this.element;
        this.patternsInput = this.element.querySelector('#gitIgnorePatterns');
        this.anchorInput = this.element.querySelector('#gitIgnoreAnchor');
        this.preview = this.element.querySelector('#gitIgnorePreview');
        this.repoLabel = this.element.querySelector('#gitIgnoreRepo');
        this.hint = this.element.querySelector('#gitIgnoreHint');
        this.modeFile = this.element.querySelector('#gitIgnoreModeFile');
        this.modeFolder = this.element.querySelector('#gitIgnoreModeFolder');
        this.saveButton = this.element.querySelector('[data-local-action="saveGitIgnore"]');
        this.attachDelegatedListeners();
        this.applyState(this.state);
    }

    afterUnload() {
        this.detachDelegatedListeners();
    }

    onInput(event) {
        const target = event?.target;
        if (!target) return;
        if (target.id === 'gitIgnorePatterns') {
            this.handlePatternsInput();
        }
    }

    onChange(event) {
        const target = event?.target;
        if (!target) return;
        if (target.id === 'gitIgnoreAnchor') {
            this.handleAnchorChange();
        }
    }

    attachDelegatedListeners() {
        if (this.delegatedListenersAttached || !this.element) return;
        this.handleDelegatedInput = (event) => this.onInput(event);
        this.handleDelegatedChange = (event) => this.onChange(event);
        this.element.addEventListener('input', this.handleDelegatedInput);
        this.element.addEventListener('change', this.handleDelegatedChange);
        this.delegatedListenersAttached = true;
    }

    detachDelegatedListeners() {
        if (!this.delegatedListenersAttached || !this.element) return;
        this.element.removeEventListener('input', this.handleDelegatedInput);
        this.element.removeEventListener('change', this.handleDelegatedChange);
        this.handleDelegatedInput = null;
        this.handleDelegatedChange = null;
        this.delegatedListenersAttached = false;
    }

    cancelGitIgnore() {
        this.getParentPresenter()?.cancelGitIgnore?.();
    }

    saveGitIgnore() {
        const patterns = (this.patternsInput?.value || '').trim();
        this.state.patterns = patterns;
        this.getParentPresenter()?.saveGitIgnore?.({ patterns });
    }

    setIgnoreMode(element, mode) {
        const next = (mode || element?.dataset?.mode || '').trim();
        if (next !== 'file' && next !== 'folder') return;
        this.getParentPresenter()?.setIgnoreMode?.({ mode: next });
    }

    setState(next = {}) {
        this.applyState(next);
    }

    applyState(next) {
        if (!next || typeof next !== 'object') return;
        if (Object.prototype.hasOwnProperty.call(next, 'visible')) {
            this.state.visible = Boolean(next.visible);
        }
        if (Object.prototype.hasOwnProperty.call(next, 'repoLabel')) {
            this.state.repoLabel = String(next.repoLabel || '');
        }
        if (Object.prototype.hasOwnProperty.call(next, 'patterns')) {
            this.state.patterns = String(next.patterns || '');
        }
        if (Object.prototype.hasOwnProperty.call(next, 'mode')) {
            this.state.mode = String(next.mode || 'file');
        }
        if (Object.prototype.hasOwnProperty.call(next, 'anchor')) {
            this.state.anchor = Boolean(next.anchor);
        }
        if (Object.prototype.hasOwnProperty.call(next, 'count')) {
            this.state.count = Number(next.count || 0);
        }
        if (Object.prototype.hasOwnProperty.call(next, 'preview')) {
            this.state.preview = Array.isArray(next.preview) ? next.preview : [];
        }
        if (Object.prototype.hasOwnProperty.call(next, 'source')) {
            this.state.source = String(next.source || 'manual');
        }
        if (Object.prototype.hasOwnProperty.call(next, 'stopTracking')) {
            this.state.stopTracking = Boolean(next.stopTracking);
        }

        this.element.classList.toggle('is-visible', this.state.visible);
        if (this.repoLabel) {
            this.repoLabel.textContent = this.state.repoLabel ? `Repo: ${this.state.repoLabel}` : '';
            this.repoLabel.title = this.state.repoLabel || '';
        }
        if (this.patternsInput && this.patternsInput.value !== this.state.patterns) {
            this.patternsInput.value = this.state.patterns;
        }
        if (this.anchorInput) {
            this.anchorInput.checked = this.state.anchor;
        }
        if (this.modeFile) {
            this.modeFile.classList.toggle('active', this.state.mode === 'file');
        }
        if (this.modeFolder) {
            this.modeFolder.classList.toggle('active', this.state.mode === 'folder');
        }
        if (this.saveButton) {
            this.saveButton.textContent = this.state.stopTracking
                ? 'Stop tracking & ignore'
                : 'Add to .gitignore';
        }

        if (this.preview) {
            this.preview.innerHTML = '';
            if (this.state.count <= 0) {
                const empty = document.createElement('div');
                empty.className = 'git-ignore-empty';
                empty.textContent = 'No files selected.';
                this.preview.appendChild(empty);
            } else {
                const countChip = document.createElement('span');
                countChip.className = 'git-ignore-chip git-ignore-chip-count';
                countChip.textContent = `Selected: ${this.state.count}`;
                this.preview.appendChild(countChip);
                for (const item of this.state.preview) {
                    const chip = document.createElement('span');
                    chip.className = 'git-ignore-chip';
                    chip.textContent = String(item);
                    this.preview.appendChild(chip);
                }
                if (this.state.count > this.state.preview.length) {
                    const more = document.createElement('span');
                    more.className = 'git-ignore-chip git-ignore-chip-more';
                    more.textContent = `+${this.state.count - this.state.preview.length} more`;
                    this.preview.appendChild(more);
                }
            }
        }

        if (this.hint) {
            if (this.state.count > 0) {
                const sourceLabel = this.state.source === 'selection'
                    ? 'Using selected files.'
                    : (this.state.source === 'untracked' ? 'Using untracked files.' : '');
                const base = sourceLabel || 'Edit patterns if needed.';
                if (this.state.stopTracking) {
                    this.hint.textContent = `${base} This will stage removal; commit to finalize.`;
                } else {
                    this.hint.textContent = `${base} .gitignore will not untrack committed files.`;
                }
            } else {
                this.hint.textContent = 'Add one pattern per line.';
            }
        }

        if (next.focus === 'patterns') {
            setTimeout(() => this.patternsInput?.focus?.(), 0);
        }
    }

    handlePatternsInput() {
        const patterns = (this.patternsInput?.value || '').trim();
        this.state.patterns = patterns;
        this.getParentPresenter()?.updateIgnorePatterns?.(patterns);
    }

    handleAnchorChange() {
        const anchor = Boolean(this.anchorInput?.checked);
        this.state.anchor = anchor;
        this.getParentPresenter()?.setIgnoreAnchor?.({ anchor });
    }

    getParentPresenter() {
        return this.element.closest('git-commit-modal')?.webSkelPresenter || null;
    }
}
