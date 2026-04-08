function parseItems(element, props) {
    const encoded = element.getAttribute('data-items');
    if (encoded) {
        try {
            const parsed = JSON.parse(decodeURIComponent(encoded));
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return Array.isArray(props?.items) ? props.items : [];
}

function encodeItems(items) {
    try {
        return encodeURIComponent(JSON.stringify(Array.isArray(items) ? items : []));
    } catch {
        return encodeURIComponent('[]');
    }
}

function parseLoading(element, props) {
    if (typeof props?.loading === 'boolean') {
        return props.loading;
    }
    return element.getAttribute('data-loading') === 'true';
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderItemMarkup(item) {
    if (!item || typeof item !== 'object') return '';
    if (item.kind === 'separator') {
        return '<div class="app-menu-separator" role="separator"></div>';
    }

    const itemId = escapeHtml(String(item.id || ''));
    const title = typeof item.title === 'string' && item.title.trim()
        ? ` title="${escapeHtml(item.title.trim())}"`
        : '';
    const disabled = item.disabled ? ' disabled aria-disabled="true"' : '';
    const destructive = item.destructive ? ' destructive' : '';
    const icon = typeof item.icon === 'string' && item.icon.trim()
        ? `<img class="app-menu-item-icon action-menu-item-icon" loading="lazy" src="${escapeHtml(item.icon)}" alt="">`
        : '';

    return `
        <button type="button" class="app-menu-item action-menu-item${destructive}" data-item-id="${itemId}" data-local-action="handleMenuItemSelection ${itemId}" role="menuitem"${title}${disabled}>
            ${icon}
            <span class="app-menu-item-label action-menu-item-label">${escapeHtml(String(item.label || ''))}</span>
        </button>
    `;
}

export class AppMenu {
    constructor(element, invalidate, props = {}) {
        this.element = element;
        this.invalidate = invalidate;
        this.props = props;
        this.items = parseItems(element, props);
        this.loading = parseLoading(element, props);
        this.loadingAriaLabel = 'Loading menu actions';
        this.invalidate();
    }

    get rootClass() {
        return this.loading ? 'is-loading' : '';
    }

    get loadingClass() {
        return this.loading ? '' : 'is-hidden';
    }

    get listClass() {
        return this.loading ? 'is-hidden' : '';
    }

    get loadingMarkup() {
        if (!this.loading) return '';
        return `<div class="app-menu-loading" id="appMenuLoading" role="status" aria-live="polite" aria-label="${escapeHtml(this.loadingAriaLabel)}">
            <span class="app-menu-spinner" aria-hidden="true"></span>
        </div>`;
    }

    get itemsMarkup() {
        if (this.loading) return '';
        const items = Array.isArray(this.items) ? this.items : [];
        return items.map((item) => renderItemMarkup(item)).join('');
    }

    beforeRender() {}

    afterRender() {}

    beforeUnload() {
        this.list = null;
    }

    setItems(items) {
        this.items = Array.isArray(items) ? items : [];
        this.element.setAttribute('data-items', encodeItems(this.items));
        this.invalidate();
    }

    setLoading(loading) {
        this.loading = Boolean(loading);
        this.element.setAttribute('data-loading', this.loading ? 'true' : 'false');
        this.invalidate();
    }

    emitSelection(item) {
        this.element.dispatchEvent(new CustomEvent('app-menu-select', {
            bubbles: true,
            detail: { item }
        }));
    }

    handleMenuItemSelection(button, itemId = '') {
        if (!button || button.disabled) return;
        const id = String(itemId || button.dataset.itemId || '');
        const item = Array.isArray(this.items) ? this.items.find((entry) => String(entry?.id || '') === id) : null;
        if (!item) return;
        this.emitSelection(item);
    }

    // Compatibility with call sites that treat the presenter as stateful.
    setState(nextState = {}) {
        if (!nextState || typeof nextState !== 'object') return;
        if (Object.prototype.hasOwnProperty.call(nextState, 'items')) {
            this.items = Array.isArray(nextState.items) ? nextState.items : [];
            this.element.setAttribute('data-items', encodeItems(this.items));
        }
        if (Object.prototype.hasOwnProperty.call(nextState, 'loading')) {
            this.loading = Boolean(nextState.loading);
            this.element.setAttribute('data-loading', this.loading ? 'true' : 'false');
        }
        this.invalidate();
    }
}
