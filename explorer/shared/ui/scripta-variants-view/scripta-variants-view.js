function escapeHtml(value = '') {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function reactionIcon(type) {
    const path = type === 'dislike'
        ? 'M10 15v4.4c0 .9.7 1.6 1.6 1.6.6 0 1.1-.3 1.4-.8l3.5-5.2H20a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-3.2c-.6 0-1.1.2-1.5.6L14 5H5.8a2 2 0 0 0-2 1.7l-1 6A2 2 0 0 0 4.8 15H10Z'
        : 'M14 9V4.6c0-.9-.7-1.6-1.6-1.6-.6 0-1.1.3-1.4.8L7.5 9H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3.2c.6 0 1.1-.2 1.5-.6L10 19h8.2a2 2 0 0 0 2-1.7l1-6A2 2 0 0 0 19.2 9H14Z';
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"></path></svg>`;
}

function normalizeVariant(variant = {}, index = 0) {
    const likes = Number(variant.likes ?? variant.stats?.likes ?? 0) || 0;
    const dislikes = Number(variant.dislikes ?? variant.stats?.dislikes ?? 0) || 0;
    return {
        ...variant,
        id: String(variant.id || ''),
        text: String(variant.text || ''),
        ordinal: Number(variant.ordinal || index + 1),
        likes,
        dislikes,
        canEdit: variant.canEdit === true,
        canDelete: variant.canDelete === true,
        voters: variant.voters && typeof variant.voters === 'object' ? variant.voters : null
    };
}

export class ScriptaVariantsView {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.state = {
            variants: [],
            activeVariantId: '',
            selectedVariantId: '',
            editingVariantId: '',
            viewerVote: null,
            editable: false,
            disabled: false,
            showVoters: false,
            allowAdd: true,
            allowReformulate: false
        };
        this.onClick = (event) => this.handleClick(event);
        this.onChange = (event) => this.handleChange(event);
        this.onInput = (event) => this.handleInput(event);
        this.onKeydown = (event) => this.handleKeydown(event);
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.root = this.element.querySelector('.scripta-variants-view-root');
        this.element.removeEventListener('click', this.onClick);
        this.element.removeEventListener('change', this.onChange);
        this.element.removeEventListener('input', this.onInput);
        this.element.removeEventListener('keydown', this.onKeydown);
        this.element.addEventListener('click', this.onClick);
        this.element.addEventListener('change', this.onChange);
        this.element.addEventListener('input', this.onInput);
        this.element.addEventListener('keydown', this.onKeydown);
        this.render();
    }

    setData(data = {}) {
        const variants = (Array.isArray(data.variants) ? data.variants : []).map(normalizeVariant);
        const selectedCandidate = String(data.selectedVariantId || this.state.selectedVariantId || data.activeVariantId || '');
        const editingCandidate = Object.prototype.hasOwnProperty.call(data, 'editingVariantId')
            ? String(data.editingVariantId || '')
            : this.state.editingVariantId;
        this.state = {
            ...this.state,
            ...data,
            variants,
            activeVariantId: String(data.activeVariantId || ''),
            editingVariantId: variants.some((variant) => variant.id === editingCandidate)
                ? editingCandidate
                : '',
            selectedVariantId: variants.some((variant) => variant.id === selectedCandidate)
                ? selectedCandidate
                : String(data.activeVariantId || variants[0]?.id || '')
        };
        this.render();
    }

    emit(type, detail = {}) {
        this.element.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
    }

    renderTab(variant) {
        const selected = variant.id === this.state.selectedVariantId;
        const active = variant.id === this.state.activeVariantId;
        return `<button type="button" class="scripta-tab ${selected ? 'is-selected' : ''} ${active ? 'is-active' : ''} ${variant.pending ? 'is-pending' : ''}"
            data-scripta-action="select" data-variant-id="${escapeHtml(variant.id)}" role="tab" aria-selected="${selected}">
            <span class="scripta-tab-title">Variant ${variant.ordinal}</span>
            ${variant.pending ? '<span class="scripta-tab-active">Saving…</span>' : active ? '<span class="scripta-tab-active is-confirmed"><span class="scripta-tab-active-icon" aria-hidden="true">✓</span>Active</span>' : ''}
            ${variant.pending ? '' : `<span class="scripta-tab-reactions"><span>${reactionIcon('like')}${variant.likes}</span><span>${reactionIcon('dislike')}${variant.dislikes}</span></span>`}
        </button>`;
    }

    renderReaction(variant, type) {
        const vote = this.state.viewerVote?.variantId === variant.id ? this.state.viewerVote?.type : '';
        const active = vote === type;
        const count = type === 'like' ? variant.likes : variant.dislikes;
        const label = type === 'like' ? 'Like' : 'Dislike';
        return `<button type="button" class="scripta-reaction-button ${active ? 'is-active' : ''}"
            data-scripta-action="vote" data-variant-id="${escapeHtml(variant.id)}" data-reaction="${type}" ${this.state.disabled || variant.pending ? 'disabled' : ''}>
            ${reactionIcon(type)}<span>${label}</span><strong>${count}</strong>
        </button>`;
    }

    renderVoters(variant) {
        if (!this.state.showVoters || !variant.voters) return '';
        const renderList = (values = []) => values.length
            ? `<ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul>`
            : '<span>No voters</span>';
        return `<div class="scripta-voters">
            <section><strong>${reactionIcon('like')} Likes</strong>${renderList(variant.voters.likes)}</section>
            <section><strong>${reactionIcon('dislike')} Dislikes</strong>${renderList(variant.voters.dislikes)}</section>
        </div>`;
    }

    renderPanel(variant) {
        if (!variant) return '<div class="scripta-empty">No variants available.</div>';
        const canEdit = this.state.editable && variant.canEdit && !this.state.disabled && !variant.pending;
        const canDelete = variant.canDelete && !this.state.disabled && !variant.pending;
        const editing = this.state.editingVariantId === variant.id;
        const inlineEditAttributes = canEdit
            ? `data-scripta-action="edit" data-variant-id="${escapeHtml(variant.id)}" tabindex="0" role="button" aria-label="Edit variant text"`
            : '';
        const content = editing
            ? `<textarea class="scripta-variant-editor" data-role="variantText"${canEdit ? '' : ' readonly'}${this.state.disabled ? ' disabled' : ''}>${escapeHtml(variant.text)}</textarea>
               ${canEdit ? `<div class="scripta-variant-edit-actions">
                   <button type="button" class="scripta-secondary-button" data-scripta-action="cancel-edit">Cancel</button>
                   <button type="button" class="scripta-primary-button" data-scripta-action="save" ${this.state.disabled ? 'disabled' : ''}>Save</button>
               </div>` : ''}`
            : `<div class="scripta-variant-text ${variant.text ? '' : 'is-placeholder'}" ${inlineEditAttributes}>${variant.text ? escapeHtml(variant.text) : 'Empty paragraph — click to add text.'}</div>`;
        return `<section class="scripta-variant-panel" data-variant-id="${escapeHtml(variant.id)}">
            <div class="scripta-panel-header">
                <div class="scripta-reaction-actions">${this.renderReaction(variant, 'like')}${this.renderReaction(variant, 'dislike')}</div>
                ${variant.voters ? `<label class="scripta-voters-toggle"><input type="checkbox" data-role="showVoters" ${this.state.showVoters ? 'checked' : ''}><span>Show voters</span></label>` : ''}
                ${canDelete ? `<button type="button" class="scripta-variant-delete-button" data-scripta-action="delete" data-variant-id="${escapeHtml(variant.id)}">Delete</button>` : ''}
            </div>
            ${this.renderVoters(variant)}
            <div class="scripta-variant-content">${content}</div>
        </section>`;
    }

    render() {
        if (!this.root) return;
        const selected = this.state.variants.find((variant) => variant.id === this.state.selectedVariantId)
            || this.state.variants[0];
        this.root.innerHTML = `
            <div class="scripta-proposal-toolbar">
                ${this.state.allowAdd ? '<button type="button" class="scripta-primary-button" data-scripta-action="toggle-add">+ Add variant</button>' : ''}
                ${this.state.allowReformulate ? '<button type="button" class="scripta-secondary-button" data-scripta-action="reformulate">Reformulate with AI</button>' : ''}
            </div>
            <section class="scripta-proposal-popover" data-role="proposal" hidden>
                <textarea data-role="proposalText" rows="5" placeholder="Write an alternative formulation"></textarea>
                <div><button type="button" class="scripta-secondary-button" data-scripta-action="cancel-add">Cancel</button><button type="button" class="scripta-primary-button" data-scripta-action="add">Submit</button></div>
            </section>
            <section class="scripta-tabs-section">
                <div class="scripta-tabs-rail">
                    <button type="button" class="scripta-tabs-nav" data-scripta-action="previous" aria-label="Previous variant"><span class="scripta-tabs-nav-icon is-previous" aria-hidden="true"></span></button>
                    <div class="scripta-tabs-viewport" data-role="tabsViewport"><div class="scripta-tabs" role="tablist">${this.state.variants.map((variant) => this.renderTab(variant)).join('')}</div></div>
                    <button type="button" class="scripta-tabs-nav" data-scripta-action="next" aria-label="Next variant"><span class="scripta-tabs-nav-icon is-next" aria-hidden="true"></span></button>
                </div>
                <div class="scripta-tab-panel" role="tabpanel">${this.renderPanel(selected)}</div>
            </section>`;
    }

    selectOffset(offset) {
        const current = Math.max(0, this.state.variants.findIndex((variant) => variant.id === this.state.selectedVariantId));
        const next = this.state.variants[Math.max(0, Math.min(this.state.variants.length - 1, current + offset))];
        if (!next) return;
        this.state.selectedVariantId = next.id;
        this.render();
        this.emit('scripta-p-variant-select', { variantId: next.id });
    }

    handleChange(event) {
        if (!event.target?.matches?.('[data-role="showVoters"]')) return;
        this.state.showVoters = Boolean(event.target.checked);
        this.render();
    }

    handleInput(event) {
        if (!event.target?.matches?.('[data-role="variantText"]')) return;
        const variantId = this.state.editingVariantId;
        const variant = this.state.variants.find((entry) => entry.id === variantId);
        if (!variant?.canEdit) return;
        variant.text = String(event.target.value || '');
        this.emit('scripta-p-variant-edit-draft', { variantId, text: variant.text });
    }

    applyRemoteDraft({ variantId = '', text = '' } = {}) {
        const variant = this.state.variants.find((entry) => entry.id === String(variantId || ''));
        if (!variant) return;
        variant.text = String(text ?? '');
        this.state.selectedVariantId = variant.id;
        this.state.editingVariantId = variant.id;
        this.render();
    }

    handleKeydown(event) {
        const target = event.target?.closest?.('.scripta-variant-text[data-scripta-action="edit"]');
        if (!target || !this.element.contains(target) || !['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        target.click();
    }

    handleClick(event) {
        const button = event.target?.closest?.('[data-scripta-action]');
        if (!button || !this.element.contains(button)) return;
        event.preventDefault();
        event.stopPropagation();
        const action = button.dataset.scriptaAction;
        const variantId = String(button.dataset.variantId || this.state.selectedVariantId || '');
        if (action === 'select') {
            this.state.selectedVariantId = variantId;
            this.render();
            this.emit('scripta-p-variant-select', { variantId });
        } else if (action === 'previous' || action === 'next') {
            this.selectOffset(action === 'previous' ? -1 : 1);
        } else if (action === 'vote') {
            const type = button.dataset.reaction;
            const withdraw = this.state.viewerVote?.variantId === variantId && this.state.viewerVote?.type === type;
            this.emit('scripta-p-variant-vote', { variantId, type, withdraw });
        } else if (action === 'edit') {
            if (!this.state.variants.find((entry) => entry.id === variantId)?.canEdit) return;
            this.state.editingVariantId = variantId;
            this.render();
            this.root.querySelector('[data-role="variantText"]')?.focus();
            this.emit('scripta-p-variant-edit-start', { variantId });
        } else if (action === 'cancel-edit') {
            const cancelledVariantId = this.state.editingVariantId;
            this.state.editingVariantId = '';
            this.render();
            this.emit('scripta-p-variant-edit-cancel', { variantId: cancelledVariantId });
        } else if (action === 'save') {
            const text = this.root.querySelector('[data-role="variantText"]')?.value || '';
            const variant = this.state.variants.find((entry) => entry.id === variantId);
            if (!variant?.canEdit) return;
            variant.text = text;
            this.state.editingVariantId = '';
            this.render();
            this.emit('scripta-p-variant-edit', { variantId, text });
        } else if (action === 'delete') {
            const variant = this.state.variants.find((entry) => entry.id === variantId);
            if (!variant?.canDelete) return;
            this.emit('scripta-p-variant-delete', { variantId });
        } else if (action === 'toggle-add' || action === 'cancel-add') {
            const proposal = this.root.querySelector('[data-role="proposal"]');
            proposal.hidden = action === 'cancel-add' ? true : !proposal.hidden;
            if (!proposal.hidden) proposal.querySelector('textarea')?.focus();
        } else if (action === 'add') {
            const input = this.root.querySelector('[data-role="proposalText"]');
            const text = String(input?.value || '').trim();
            if (text) {
                this.root.querySelector('[data-role="proposal"]').hidden = true;
                const pendingVariant = normalizeVariant({
                    id: `pending-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                    text,
                    ordinal: this.state.variants.length + 1,
                    pending: true,
                }, this.state.variants.length);
                this.state.variants.push(pendingVariant);
                this.state.selectedVariantId = pendingVariant.id;
                this.render();
                this.emit('scripta-p-variant-add', { text });
            }
        } else if (action === 'reformulate') {
            this.emit('scripta-p-variant-reformulate', {});
        }
    }
}
