import { unifiedToSplitHtml, stripUnifiedDiffHeaders, stripUnifiedDiffFileHeaders, summarizeUnifiedDiffMeta } from "../../modals/git-commit-modal/git-commit-modal-diff.js";

export class GitDiffViewer {
    constructor(element, invalidate, props = {}) {
        this.element = element;
        this.invalidate = invalidate;
        this.props = props || {};
        this.state = {
            diffText: '',
            filePath: '',
            loading: false,
            isError: false,
            mode: 'split'
        };
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.bindEvents();
        this.render();
    }

    bindEvents() {
        const left = this.element.querySelector('#gitDiffLeft');
        const right = this.element.querySelector('#gitDiffRight');
        if (left && right && !this.element.dataset.boundDiffScroll) {
            let syncing = false;
            const sync = (source, target) => {
                if (syncing) return;
                syncing = true;
                target.scrollTop = source.scrollTop;
                target.scrollLeft = source.scrollLeft;
                syncing = false;
            };
            left.addEventListener('scroll', () => sync(left, right), { passive: true });
            right.addEventListener('scroll', () => sync(right, left), { passive: true });
            this.element.dataset.boundDiffScroll = 'true';
        }
    }

    setDiffMode(element, mode) {
        const next = (mode || element?.dataset?.mode || '').trim();
        if (next !== 'split' && next !== 'unified') return;
        this.state.mode = next;
        this.render();
    }

    setDiff(text, { filePath = null, loading = false, isError = false } = {}) {
        this.state.diffText = text || '';
        this.state.filePath = filePath || '';
        this.state.loading = Boolean(loading);
        this.state.isError = Boolean(isError);
        this.render();
    }

    render() {
        const title = this.element.querySelector('#gitDiffTitle');
        const meta = this.element.querySelector('#gitDiffMeta');
        const body = this.element.querySelector('#gitDiffBody');
        const split = this.element.querySelector('#gitDiffSplit');
        const left = this.element.querySelector('#gitDiffLeft');
        const right = this.element.querySelector('#gitDiffRight');
        if (title) title.textContent = 'Diff';

        const mode = this.state.mode || 'split';
        if (split) split.style.display = mode === 'split' ? '' : 'none';
        if (body) body.style.display = mode === 'unified' ? '' : 'none';

        if (mode === 'split') {
            const stripped = stripUnifiedDiffFileHeaders(this.state.diffText);
            const { leftHtml, rightHtml, meta: diffMeta } = unifiedToSplitHtml(stripped);
            if (meta) {
                const parts = [];
                if (this.state.filePath) parts.push(this.state.filePath);
                const summary = summarizeUnifiedDiffMeta(diffMeta);
                if (summary) parts.push(summary);
                if (this.state.loading) parts.push('loading…');
                meta.textContent = parts.join(' · ');
            }
            if (left) left.innerHTML = leftHtml;
            if (right) right.innerHTML = rightHtml;
            left?.classList.toggle('error', this.state.isError);
            right?.classList.toggle('error', this.state.isError);
        } else if (body) {
            body.textContent = stripUnifiedDiffHeaders(this.state.diffText);
            if (meta) {
                const parts = [];
                if (this.state.filePath) parts.push(this.state.filePath);
                if (this.state.loading) parts.push('loading…');
                meta.textContent = parts.join(' · ');
            }
            body.classList.toggle('error', this.state.isError);
        }
    }
}
