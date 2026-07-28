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
        images: (Array.isArray(variant.images) ? variant.images : []).map((image, imageIndex) => ({
            imageId: String(image?.imageId || ''),
            assetId: String(image?.assetId || ''),
            alt: String(image?.alt || 'Image'),
            workspaceUrl: String(image?.workspaceUrl || ''),
            ordinal: Math.max(1, Number(image?.ordinal || imageIndex + 1)),
            position: Number.isInteger(Number(image?.position))
                ? Math.max(0, Math.min(String(variant.text || '').length, Number(image.position)))
                : String(variant.text || '').length,
            layout: {
                widthPercent: Math.max(20, Math.min(100, Math.round(Number(image?.layout?.widthPercent) || 100))),
                aspectRatio: ['auto', '1:1', '4:3', '3:2', '16:9'].includes(image?.layout?.aspectRatio) ? image.layout.aspectRatio : 'auto',
                fit: ['contain', 'cover'].includes(image?.layout?.fit) ? image.layout.fit : 'contain',
                alignment: ['left', 'center', 'right'].includes(image?.layout?.alignment) ? image.layout.alignment : 'center',
            },
        })).filter((image) => image.imageId && image.assetId && image.workspaceUrl),
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
            selectedImageId: '',
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
        this.onDocumentPointerDown = (event) => {
            if (!this.state.selectedImageId || this.element.contains(event.target)) return;
            this.setSelectedImage('', '');
        };
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
        globalThis.document?.removeEventListener?.('pointerdown', this.onDocumentPointerDown, true);
        globalThis.document?.addEventListener?.('pointerdown', this.onDocumentPointerDown, true);
        this.render();
    }

    afterUnload() {
        this.element.removeEventListener('click', this.onClick);
        this.element.removeEventListener('change', this.onChange);
        this.element.removeEventListener('input', this.onInput);
        this.element.removeEventListener('keydown', this.onKeydown);
        globalThis.document?.removeEventListener?.('pointerdown', this.onDocumentPointerDown, true);
        this.root = null;
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
        if (!variants.some((variant) => variant.images.some((image) => image.imageId === this.state.selectedImageId))) {
            this.state.selectedImageId = '';
        }
        this.render();
        this.focusActiveEditor();
    }

    emit(type, detail = {}) {
        this.element.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
    }

    focusActiveEditor() {
        const variant = this.state.variants.find((entry) => entry.id === this.state.editingVariantId);
        if (!this.state.editable || this.state.disabled || !variant?.canEdit) return false;
        const editor = this.root?.querySelector?.('[data-role="variantText"]');
        if (!editor || editor.disabled || editor.readOnly) return false;
        editor.focus({preventScroll: true});
        const cursor = String(editor.value || '').length;
        editor.setSelectionRange?.(cursor, cursor);
        return true;
    }

    rejectEditStart(variantId = '') {
        if (this.state.editingVariantId !== String(variantId || '')) return false;
        this.state.editingVariantId = '';
        this.render();
        return true;
    }

    setSelectedImage(imageId = '', variantId = '') {
        const selectedImageId = String(imageId || '');
        this.state.selectedImageId = selectedImageId;
        this.emit('scripta-image-inspector-change', {
            open: Boolean(selectedImageId),
            variantId: selectedImageId ? String(variantId || this.state.selectedVariantId || '') : '',
            imageId: selectedImageId,
        });
        this.syncImageInspectorDom();
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
        const editor = editing
            ? `<textarea class="scripta-variant-editor" data-role="variantText"${canEdit ? '' : ' readonly'}${this.state.disabled ? ' disabled' : ''}>${escapeHtml(variant.text)}</textarea>
               ${canEdit ? `<div class="scripta-variant-edit-actions">
                   <button type="button" class="scripta-secondary-button" data-scripta-action="cancel-edit">Cancel</button>
                   <button type="button" class="scripta-primary-button" data-scripta-action="save" ${this.state.disabled ? 'disabled' : ''}>Save</button>
               </div>` : ''}`
            : '';
        const renderImage = (image) => {
            const src = `/workspace-files/${image.workspaceUrl.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/')}`;
            const layout = image.layout;
            const ratio = layout.aspectRatio === 'auto' ? 'auto' : layout.aspectRatio.replace(':', ' / ');
            const selected = image.imageId === this.state.selectedImageId;
            return `<div class="scripta-variant-image-container ${selected ? 'is-selected' : ''}" data-variant-id="${escapeHtml(variant.id)}" data-image-id="${escapeHtml(image.imageId)}" data-image-ordinal="${image.ordinal}">
                <figure class="scripta-variant-image is-${layout.alignment} ${selected ? 'is-selected' : ''}" data-image-id="${escapeHtml(image.imageId)}" data-image-ordinal="${image.ordinal}" style="width:${layout.widthPercent}%">
                    <img src="${escapeHtml(src)}" alt="${escapeHtml(image.alt)}" loading="lazy" style="aspect-ratio:${ratio};object-fit:${layout.fit}"
                         ${canEdit ? `data-scripta-action="select-image" data-variant-id="${escapeHtml(variant.id)}" data-image-id="${escapeHtml(image.imageId)}" data-image-ordinal="${image.ordinal}"` : ''}>
                </figure>
                ${selected && canEdit ? this.renderImageLayoutMenu(variant, image) : ''}
            </div>`;
        };
        const orderedImages = variant.images
            .map((image, index) => ({...image, index}))
            .sort((left, right) => left.position - right.position || left.index - right.index);
        let cursor = 0;
        const flow = [];
        for (const image of orderedImages) {
            const segment = variant.text.slice(cursor, image.position);
            if (segment) flow.push(`<div class="scripta-variant-text" ${inlineEditAttributes}>${escapeHtml(segment)}</div>`);
            flow.push(renderImage(image));
            cursor = image.position;
        }
        const tail = variant.text.slice(cursor);
        if (tail) flow.push(`<div class="scripta-variant-text" ${inlineEditAttributes}>${escapeHtml(tail)}</div>`);
        if (!flow.length) flow.push(`<div class="scripta-variant-text is-placeholder" ${inlineEditAttributes}>Empty paragraph — click to add text.</div>`);
        const content = editing
            ? `${editor}${orderedImages.length ? `<div class="scripta-variant-images">${orderedImages.map(renderImage).join('')}</div>` : ''}`
            : `<div class="scripta-variant-flow">${flow.join('')}</div>`;
        return `<section class="scripta-variant-panel" data-variant-id="${escapeHtml(variant.id)}">
            <div class="scripta-panel-header">
                <div class="scripta-reaction-actions">${this.renderReaction(variant, 'like')}${this.renderReaction(variant, 'dislike')}</div>
                ${variant.voters ? `<label class="scripta-voters-toggle"><input type="checkbox" data-role="showVoters" ${this.state.showVoters ? 'checked' : ''}><span>Show voters</span></label>` : ''}
                ${canEdit ? `<button type="button" class="scripta-secondary-button scripta-variant-image-add-button" data-scripta-action="insert-image" data-variant-id="${escapeHtml(variant.id)}">+ Image</button>` : ''}
                ${canDelete ? `<button type="button" class="scripta-variant-delete-button" data-scripta-action="delete" data-variant-id="${escapeHtml(variant.id)}">Delete</button>` : ''}
            </div>
            ${this.renderVoters(variant)}
            <div class="scripta-variant-content">${content}</div>
        </section>`;
    }

    renderImageLayoutMenu(variant, image) {
        const layout = image.layout;
        const option = (value, label, current) => `<option value="${value}" ${value === current ? 'selected' : ''}>${label}</option>`;
        const identity = `data-variant-id="${escapeHtml(variant.id)}" data-variant-ordinal="${variant.ordinal}" data-image-id="${escapeHtml(image.imageId)}" data-image-ordinal="${image.ordinal}"`;
        return `<div class="scripta-variant-image-layout" role="dialog" aria-label="Image options" ${identity}>
            <div class="scripta-image-toolbar-header">
                <strong>Image options</strong>
                <button type="button" class="scripta-image-toolbar-close" data-scripta-action="close-image-layout" ${identity} aria-label="Close image options">×</button>
            </div>
            <div class="scripta-image-toolbar-fields">
                <label class="scripta-image-width-control">Width
                    <span class="scripta-image-number-field"><input type="number" min="20" max="100" step="5" value="${layout.widthPercent}"
                           data-image-layout-field="widthPercent" ${identity} aria-label="Image width percentage"><span aria-hidden="true">%</span></span>
                </label>
                <label>Ratio<select data-image-layout-field="aspectRatio" ${identity}>
                    ${option('auto', 'Original', layout.aspectRatio)}${option('1:1', '1:1', layout.aspectRatio)}${option('4:3', '4:3', layout.aspectRatio)}${option('3:2', '3:2', layout.aspectRatio)}${option('16:9', '16:9', layout.aspectRatio)}
                </select></label>
                <label>Fit<select data-image-layout-field="fit" ${identity}>
                    ${option('contain', 'Contain', layout.fit)}${option('cover', 'Cover', layout.fit)}
                </select></label>
                <label>Align<select data-image-layout-field="alignment" ${identity}>
                    ${option('left', 'Left', layout.alignment)}${option('center', 'Center', layout.alignment)}${option('right', 'Right', layout.alignment)}
                </select></label>
            </div>
            <div class="scripta-image-toolbar-actions">
                <button type="button" class="scripta-secondary-button" data-scripta-action="replace-image" ${identity}>Replace</button>
                <button type="button" class="scripta-secondary-button is-danger" data-scripta-action="delete-image" ${identity}>Delete</button>
            </div>
        </div>`;
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

    syncImageInspectorDom() {
        const containers = Array.from(this.root?.querySelectorAll?.('.scripta-variant-image-container') || []);
        if (!containers.length) {
            this.render();
            return;
        }
        for (const container of containers) {
            const selected = container.dataset.imageId === this.state.selectedImageId;
            container.classList.toggle('is-selected', selected);
            container.querySelector('.scripta-variant-image')?.classList.toggle('is-selected', selected);
            container.querySelector('.scripta-variant-image-layout')?.remove();
            if (!selected) continue;
            const variant = this.state.variants.find((entry) => entry.id === container.dataset.variantId);
            const image = variant?.images.find((entry) => entry.imageId === container.dataset.imageId);
            if (variant?.canEdit && image) {
                container.insertAdjacentHTML('beforeend', this.renderImageLayoutMenu(variant, image));
            }
        }
    }

    applyImageLayoutToDom(image) {
        const layout = image?.layout || {};
        const alignment = ['left', 'center', 'right'].includes(layout.alignment) ? layout.alignment : 'center';
        const ratio = layout.aspectRatio === 'auto' ? 'auto' : String(layout.aspectRatio || 'auto').replace(':', ' / ');
        for (const container of Array.from(this.root?.querySelectorAll?.('.scripta-variant-image-container') || [])) {
            if (container.dataset.imageId !== image?.imageId) continue;
            const figure = container.querySelector('.scripta-variant-image');
            if (!figure) continue;
            figure.style.width = `${layout.widthPercent}%`;
            figure.classList.remove('is-left', 'is-center', 'is-right');
            figure.classList.add(`is-${alignment}`);
            const imageNode = figure.querySelector('img');
            if (imageNode) {
                imageNode.style.aspectRatio = ratio;
                imageNode.style.objectFit = layout.fit === 'cover' ? 'cover' : 'contain';
            }
        }
    }

    handleChange(event) {
        if (event.target?.matches?.('[data-role="showVoters"]')) {
            this.state.showVoters = Boolean(event.target.checked);
            this.render();
            return;
        }
        const control = event.target?.closest?.('[data-image-layout-field]');
        if (!control || !this.element.contains(control)) return;
        const variant = this.state.variants.find((entry) => entry.id === control.dataset.variantId);
        const image = variant?.images.find((entry) => entry.imageId === control.dataset.imageId);
        if (!variant?.canEdit || !image) return;
        const field = control.dataset.imageLayoutField;
        const value = field === 'widthPercent'
            ? Math.max(20, Math.min(100, Number(control.value) || 100))
            : control.value;
        if (field === 'widthPercent') control.value = String(value);
        image.layout = {...image.layout, [field]: value};
        this.applyImageLayoutToDom(image);
        this.emit('scripta-p-variant-image-layout', {
            variantId: variant.id,
            ...(variant.ordinal ? {variantOrdinal: variant.ordinal} : {}),
            imageId: image.imageId,
            ...(image.ordinal ? {imageOrdinal: image.ordinal} : {}),
            ...image.layout,
        });
    }

    handleInput(event) {
        if (event.target?.matches?.('[data-image-layout-field="widthPercent"]')) {
            const container = Array.from(this.root?.querySelectorAll?.('.scripta-variant-image-container') || [])
                .find((entry) => entry.dataset.imageId === event.target.dataset.imageId);
            const figure = container?.querySelector?.('.scripta-variant-image');
            if (figure) figure.style.width = `${event.target.value}%`;
            const output = event.target.parentElement?.querySelector?.('output');
            if (output) output.textContent = `${event.target.value}%`;
            return;
        }
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
        if (event.key === 'Escape' && this.state.selectedImageId) {
            this.setSelectedImage('', '');
            return;
        }
        const target = event.target?.closest?.('.scripta-variant-text[data-scripta-action="edit"]');
        if (!target || !this.element.contains(target) || !['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        target.click();
    }

    handleClick(event) {
        const button = event.target?.closest?.('[data-scripta-action]');
        if (!button || !this.element.contains(button)) {
            if (this.state.selectedImageId && !event.target?.closest?.('.scripta-variant-image-layout')) {
                this.setSelectedImage('', '');
            }
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const action = button.dataset.scriptaAction;
        const variantId = String(button.dataset.variantId || this.state.selectedVariantId || '');
        if (action === 'select-image') {
            this.setSelectedImage(String(button.dataset.imageId || ''), variantId);
        } else if (action === 'close-image-layout') {
            this.setSelectedImage('', '');
        } else if (action === 'select') {
            if (this.state.selectedImageId) this.emit('scripta-image-inspector-change', {open: false, variantId: '', imageId: ''});
            this.state.selectedImageId = '';
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
            this.focusActiveEditor();
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
        } else if (action === 'insert-image' || action === 'replace-image' || action === 'delete-image') {
            const variant = this.state.variants.find((entry) => entry.id === variantId);
            if (!variant?.canEdit) return;
            const operation = action === 'insert-image' ? 'insert' : action === 'replace-image' ? 'replace' : 'delete';
            const editor = this.root.querySelector('[data-role="variantText"]');
            const editorText = editor ? String(editor.value || '') : undefined;
            const position = Number(editor?.selectionStart ?? variant.text.length);
            this.emit(`scripta-p-variant-image-${operation}`, {
                variantId,
                ...(variant.ordinal ? {variantOrdinal: variant.ordinal} : {}),
                ...(operation === 'insert' ? {} : {
                    imageId: String(button.dataset.imageId || ''),
                    ...(Number(button.dataset.imageOrdinal || 0) ? {imageOrdinal: Number(button.dataset.imageOrdinal)} : {}),
                }),
                ...(operation === 'insert' ? {position, ...(editorText === undefined ? {} : {text: editorText})} : {}),
            });
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
