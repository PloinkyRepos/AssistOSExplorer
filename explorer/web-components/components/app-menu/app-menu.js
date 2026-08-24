import { APP_MENU_ITEMS_SET_EVENT } from './app-menu-events.js';

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
    const loading = item.loading === true;
    const disabled = item.disabled || loading ? ' disabled aria-disabled="true"' : '';
    const destructive = item.destructive ? ' destructive' : '';
    const loadingClass = loading ? ' is-loading' : '';
    const busy = loading ? ' aria-busy="true"' : '';
    const icon = !loading && typeof item.icon === 'string' && item.icon.trim()
        ? `<img class="app-menu-item-icon action-menu-item-icon" loading="lazy" src="${escapeHtml(item.icon)}" alt="">`
        : '';
    const loadingSpinner = loading
        ? '<span class="app-menu-spinner app-menu-item-spinner" aria-hidden="true"></span>'
        : '';

    return `
        <button type="button" class="app-menu-item action-menu-item${destructive}${loadingClass}" data-item-id="${itemId}" data-local-action="handleMenuItemSelection ${itemId}" role="menuitem"${title}${disabled}${busy}>
            ${loadingSpinner || icon}
            <span class="app-menu-item-label action-menu-item-label">${escapeHtml(String(item.label || ''))}</span>
        </button>
    `;
}

export class AppMenu {
    constructor(element, invalidate, props = {}) {
        this.element = element;
        this.invalidate = invalidate;
        this.items = parseItems(element, props);
        this.loading = this.items.some((item) => item?.loading === true);
        this.boundHandleItemsSet = this.handleItemsSet.bind(this);
        this.invalidate();
    }

    get itemsMarkup() {
        const items = Array.isArray(this.items) ? this.items : [];
        return items.map((item) => renderItemMarkup(item)).join('');
    }

    beforeRender() {}

    afterRender() {
        this.element.removeEventListener(APP_MENU_ITEMS_SET_EVENT, this.boundHandleItemsSet);
        this.element.addEventListener(APP_MENU_ITEMS_SET_EVENT, this.boundHandleItemsSet);
        const encodedItems = this.element.getAttribute('data-items');
        if (encodedItems && encodedItems !== encodeItems(this.items)) {
            this.applyItems(parseItems(this.element, {}));
        }
    }

    beforeUnload() {
        this.element.removeEventListener(APP_MENU_ITEMS_SET_EVENT, this.boundHandleItemsSet);
    }

    handleItemsSet(event) {
        this.applyItems(Array.isArray(event?.detail?.items) ? event.detail.items : []);
    }

    applyItems(items) {
        this.items = Array.isArray(items) ? items : [];
        this.loading = this.items.some((item) => item?.loading === true);
        this.element.setAttribute('data-items', encodeItems(this.items));
        this.element.setAttribute('data-loading', this.loading ? 'true' : 'false');

        const list = this.element.querySelector?.('#appMenuList');
        if (!list || typeof document === 'undefined') {
            this.invalidate();
            return;
        }
        const template = document.createElement('template');
        template.innerHTML = this.items.map((item) => renderItemMarkup(item)).join('');
        list.replaceChildren(template.content);
    }

    setItems(items) {
        this.items = Array.isArray(items) ? items : [];
        this.loading = this.items.some((item) => item?.loading === true);
        this.element.setAttribute('data-items', encodeItems(this.items));
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
            this.loading = this.items.some((item) => item?.loading === true);
            this.element.setAttribute('data-loading', this.loading ? 'true' : 'false');
        }
        this.invalidate();
    }
}
