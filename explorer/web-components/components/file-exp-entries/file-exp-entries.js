const FOLDER_ICON_TEMPLATE = createTemplate(`
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-folder-fill" viewBox="0 0 16 16">
  <path d="M9.828 3h3.982a2 2 0 0 1 1.992 2.181l-.637 7A2 2 0 0 1 13.174 14H2.826a2 2 0 0 1-1.991-1.819l-.637-7a1.99 1.99 0 0 1 .342-1.31L.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3zm-8.322.12C1.72 3.042 1.95 3 2.19 3h5.396l-.707-.707A1 1 0 0 0 6.172 2H2.5a1 1 0 0 0-1 .981l.006.139z"></path>
</svg>
`);

const FILE_ICON_TEMPLATE = createTemplate(`
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-file-earmark-fill" viewBox="0 0 16 16">
  <path d="M4 0h5.5v1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5h1V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2z"></path>
  <path d="M9.5 3.5 14 8V3.5A1.5 1.5 0 0 0 12.5 2H9.5v1.5z"></path>
</svg>
`);

const DELETE_ICON_TEMPLATE = createTemplate(`
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" class="action-menu-item-icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M5.5 5.5a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0v-6a.5.5 0 0 1 .5-.5z"></path>
    <path d="M8 6a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"></path>
    <path d="M11 5.5a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0v-6a.5.5 0 0 1 .5-.5z"></path>
    <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1h-1v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-1a1 1 0 0 1 0-2h4.5l1-1h3l1 1H14a1 1 0 0 1 1 1zm-3 1H4v9a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1V4z"></path>
</svg>
`);

const PASTE_ICON_TEMPLATE = createTemplate(`
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" class="action-menu-item-icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4 1.5A1.5 1.5 0 0 1 5.5 0h5A1.5 1.5 0 0 1 12 1.5V3h1.5A1.5 1.5 0 0 1 15 4.5v9A1.5 1.5 0 0 1 13.5 15h-7A1.5 1.5 0 0 1 5 13.5V12h3.5A1.5 1.5 0 0 0 10 10.5v-7A1.5 1.5 0 0 0 8.5 2H7V1.5A.5.5 0 0 0 6.5 1h-1a.5.5 0 0 0-.5.5V2H4v-.5z"></path>
    <path d="M6.5 13a.5.5 0 0 1-.5-.5V5A1.5 1.5 0 0 1 7.5 3.5h1A1.5 1.5 0 0 1 10 5v5.5a.5.5 0 0 1-.5.5H6v1a.5.5 0 0 1-.5.5z"></path>
</svg>
`);

const VIRTUALIZATION_THRESHOLD = 180;
const DEFAULT_ROW_HEIGHT = 38;
const VIRTUALIZATION_OVERSCAN = 10;

function createTemplate(markup) {
    const template = document.createElement('template');
    template.innerHTML = String(markup || '').trim();
    return template;
}

function cloneTemplate(template) {
    return template.content.firstElementChild.cloneNode(true);
}

function createIconImage(src, alt = '') {
    const image = document.createElement('img');
    image.className = 'action-menu-item-icon';
    image.loading = 'lazy';
    image.src = src;
    image.alt = alt;
    return image;
}

function createActionLabel(label) {
    const span = document.createElement('span');
    span.className = 'action-menu-item-label';
    span.textContent = label;
    return span;
}

export class FileExpEntries {
    constructor(element, invalidate, props = {}) {
        this.element = element;
        this.invalidate = invalidate;
        this.props = props || {};
        this.rowsByPath = new Map();
        this.snapshot = null;
        this.tbody = null;
        this.scrollContainer = null;
        this.resizeObserver = null;
        this.pendingPatchFrame = null;
        this.virtual = {
            enabled: false,
            scrollTop: 0,
            viewportHeight: 0,
            rowHeight: DEFAULT_ROW_HEIGHT
        };
        this.boundHandleScroll = this.handleScroll.bind(this);
        this.boundHandleResize = this.handleResize.bind(this);
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.tbody = this.element.querySelector('#entriesBody');
        this.scrollContainer = this.element.querySelector('.entries');
        this.bindVirtualizationListeners();
        this.syncFromHost();
    }

    beforeUnload() {
        this.unbindVirtualizationListeners();
        if (this.pendingPatchFrame !== null) {
            cancelAnimationFrame(this.pendingPatchFrame);
            this.pendingPatchFrame = null;
        }
        this.rowsByPath.clear();
        this.tbody = null;
        this.scrollContainer = null;
    }

    bindVirtualizationListeners() {
        this.unbindVirtualizationListeners();
        if (!this.scrollContainer) return;
        this.scrollContainer.addEventListener('scroll', this.boundHandleScroll, { passive: true });
        window.addEventListener('resize', this.boundHandleResize);
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => {
                this.handleResize();
            });
            this.resizeObserver.observe(this.scrollContainer);
        }
        this.virtual.scrollTop = this.scrollContainer.scrollTop || 0;
        this.virtual.viewportHeight = this.scrollContainer.clientHeight || 0;
    }

    unbindVirtualizationListeners() {
        if (this.scrollContainer) {
            this.scrollContainer.removeEventListener('scroll', this.boundHandleScroll);
        }
        window.removeEventListener('resize', this.boundHandleResize);
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
    }

    handleScroll() {
        if (!this.virtual.enabled || !this.scrollContainer) return;
        this.virtual.scrollTop = this.scrollContainer.scrollTop || 0;
        this.schedulePatchRows();
    }

    handleResize() {
        if (!this.scrollContainer) return;
        this.virtual.viewportHeight = this.scrollContainer.clientHeight || 0;
        this.schedulePatchRows();
    }

    schedulePatchRows() {
        if (this.pendingPatchFrame !== null) return;
        this.pendingPatchFrame = requestAnimationFrame(() => {
            this.pendingPatchFrame = null;
            this.patchRows();
        });
    }

    getHostPresenter() {
        return this.element.closest('file-exp')?.webSkelPresenter || null;
    }

    syncFromHost() {
        const host = this.getHostPresenter();
        if (!host) return;
        this.renderEntries(host.state);
    }

    renderEntries(snapshot) {
        this.snapshot = snapshot || null;
        this.patchRows();
        this.applyColumnVisibility(this.snapshot || this.getHostPresenter()?.state || {});
    }

    applyColumnVisibility(state) {
        const columns = ['type', 'size', 'modified'];
        columns.forEach((col) => {
            const visible = Boolean(state?.columnVisibility?.[col]);
            const cells = this.element.querySelectorAll(`.col-${col}`);
            cells.forEach((cell) => {
                cell.classList.toggle('column-hidden', !visible);
            });
        });
    }

    toEntryPath(entry, state, host) {
        const rawPath = entry?.path || host?.joinPath?.(state?.path || '/', entry?.name || '');
        return host?.normalizePath?.(rawPath) || String(rawPath || '');
    }

    toMenuId(entryPath) {
        const normalized = String(entryPath || '').replace(/[^a-zA-Z0-9_-]/g, '-').slice(-80);
        return `action-menu-${normalized || 'row'}`;
    }

    createSelectCell(className, value, entryPath, type, iconNode = null) {
        const cell = document.createElement('td');
        cell.className = className;
        cell.dataset.entryPath = entryPath;
        cell.dataset.type = type;
        cell.dataset.localAction = 'selectEntry';
        if (iconNode) {
            const icon = document.createElement('span');
            icon.className = 'icon';
            icon.appendChild(iconNode);
            cell.appendChild(icon);
            cell.appendChild(document.createTextNode(` ${value}`));
        } else {
            cell.textContent = value;
        }
        return cell;
    }

    createMenuItem({ action, label, entryPath, type, destructive = false, disabled = false, extraDataset = null, iconNode = null }) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `action-menu-item${destructive ? ' destructive' : ''}${disabled ? ' disabled' : ''}`;
        button.dataset.localAction = action;
        button.dataset.entryPath = entryPath;
        button.dataset.type = type;
        if (extraDataset && typeof extraDataset === 'object') {
            Object.entries(extraDataset).forEach(([key, value]) => {
                button.dataset[key] = String(value);
            });
        }
        button.setAttribute('role', 'menuitem');
        if (disabled) {
            button.setAttribute('disabled', 'true');
        } else {
            button.removeAttribute('disabled');
        }
        if (iconNode) {
            button.appendChild(iconNode);
        }
        button.appendChild(createActionLabel(label));
        return button;
    }

    createActionsCell(entryPath, type, isMenuOpen, canPasteInto) {
        const menuId = this.toMenuId(entryPath);
        const actionsCell = document.createElement('td');
        actionsCell.className = 'actions-cell col-actions';

        const container = document.createElement('div');
        container.className = `action-menu-container${isMenuOpen ? ' open' : ''}`;
        container.dataset.actionMenu = 'true';
        container.dataset.entryPath = entryPath;

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'secondary action-menu-trigger';
        trigger.dataset.localAction = 'toggleActionMenu';
        trigger.dataset.entryPath = entryPath;
        trigger.dataset.type = type;
        trigger.setAttribute('aria-haspopup', 'true');
        trigger.setAttribute('aria-expanded', isMenuOpen ? 'true' : 'false');
        trigger.setAttribute('aria-controls', menuId);
        trigger.setAttribute('title', 'More actions');

        const triggerIcon = document.createElement('img');
        triggerIcon.className = 'action-menu-trigger-icon';
        triggerIcon.loading = 'lazy';
        triggerIcon.src = './assets/icons/action-dots.svg';
        triggerIcon.alt = 'More actions';
        trigger.appendChild(triggerIcon);

        const dropdown = document.createElement('div');
        dropdown.className = 'action-menu-dropdown';
        dropdown.id = menuId;
        dropdown.setAttribute('role', 'menu');

        dropdown.appendChild(this.createMenuItem({
            action: 'renameEntry',
            label: 'Rename',
            entryPath,
            type,
            iconNode: createIconImage('./assets/icons/edit.svg')
        }));
        dropdown.appendChild(this.createMenuItem({
            action: 'copyEntry',
            label: 'Copy',
            entryPath,
            type,
            iconNode: createIconImage('./assets/icons/copy.svg')
        }));
        dropdown.appendChild(this.createMenuItem({
            action: 'cutEntry',
            label: 'Cut',
            entryPath,
            type,
            iconNode: createIconImage('./assets/icons/cut.svg')
        }));

        if (type === 'directory') {
            dropdown.appendChild(this.createMenuItem({
                action: 'pasteClipboard',
                label: 'Paste into',
                entryPath,
                type,
                disabled: !canPasteInto,
                extraDataset: { targetPath: entryPath },
                iconNode: cloneTemplate(PASTE_ICON_TEMPLATE)
            }));
        }

        dropdown.appendChild(this.createMenuItem({
            action: 'deleteEntry',
            label: 'Delete',
            entryPath,
            type,
            destructive: true,
            iconNode: cloneTemplate(DELETE_ICON_TEMPLATE)
        }));

        container.appendChild(trigger);
        container.appendChild(dropdown);
        actionsCell.appendChild(container);
        return actionsCell;
    }

    createRow(entryPath) {
        const row = document.createElement('tr');
        row.dataset.entryPath = entryPath;
        return row;
    }

    createEmptyRow() {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 5;
        cell.textContent = 'Empty directory.';
        row.appendChild(cell);
        return row;
    }

    createSpacerRow(height, position) {
        const row = document.createElement('tr');
        row.className = 'entries-virtual-spacer';
        row.dataset.spacer = position;
        row.setAttribute('aria-hidden', 'true');
        const cell = document.createElement('td');
        cell.colSpan = 5;
        cell.style.height = `${Math.max(0, Math.round(height))}px`;
        row.appendChild(cell);
        return row;
    }

    shouldVirtualize(entriesCount) {
        return Boolean(this.scrollContainer) && entriesCount >= VIRTUALIZATION_THRESHOLD;
    }

    syncVirtualViewport() {
        if (!this.scrollContainer) return;
        this.virtual.viewportHeight = this.scrollContainer.clientHeight || 0;
        this.virtual.scrollTop = this.scrollContainer.scrollTop || 0;
    }

    clampVirtualScroll(entriesCount) {
        if (!this.scrollContainer || !this.virtual.enabled) return;
        const rowHeight = Math.max(1, Number(this.virtual.rowHeight) || DEFAULT_ROW_HEIGHT);
        const viewportHeight = Math.max(0, Number(this.virtual.viewportHeight) || 0);
        const maxScrollTop = Math.max(0, entriesCount * rowHeight - viewportHeight);
        if (this.scrollContainer.scrollTop > maxScrollTop) {
            this.scrollContainer.scrollTop = maxScrollTop;
        }
        this.virtual.scrollTop = this.scrollContainer.scrollTop || 0;
    }

    computeVirtualWindow(totalCount) {
        const rowHeight = Math.max(1, Number(this.virtual.rowHeight) || DEFAULT_ROW_HEIGHT);
        const viewportHeight = Math.max(
            rowHeight,
            Number(this.virtual.viewportHeight) || this.scrollContainer?.clientHeight || rowHeight
        );
        const visibleRows = Math.max(1, Math.ceil(viewportHeight / rowHeight));
        const startIndex = Math.max(0, Math.floor((this.virtual.scrollTop || 0) / rowHeight) - VIRTUALIZATION_OVERSCAN);
        const endIndex = Math.min(totalCount, startIndex + visibleRows + (VIRTUALIZATION_OVERSCAN * 2));
        return {
            startIndex,
            endIndex,
            topSpacerHeight: startIndex * rowHeight,
            bottomSpacerHeight: Math.max(0, (totalCount - endIndex) * rowHeight)
        };
    }

    updateMeasuredRowHeight() {
        if (!this.virtual.enabled || !this.tbody) return;
        const row = this.tbody.querySelector('tr:not(.entries-virtual-spacer)');
        if (!row) return;
        const measured = Math.round(row.getBoundingClientRect().height || 0);
        if (!Number.isFinite(measured) || measured <= 0) return;
        if (Math.abs(measured - this.virtual.rowHeight) >= 1) {
            this.virtual.rowHeight = measured;
            this.schedulePatchRows();
        }
    }

    patchRows() {
        if (!this.tbody) return;
        const host = this.getHostPresenter();
        if (!host) return;
        const state = this.snapshot || host.state || {};
        const entries = Array.isArray(state.entries) ? state.entries : [];
        this.virtual.enabled = this.shouldVirtualize(entries.length);
        this.syncVirtualViewport();
        this.clampVirtualScroll(entries.length);
        const clipboard = state.clipboard || null;
        const selectedPath = String(state.selectedPath || '');
        const openMenuPath = String(state.openMenuPath || '');
        const nextRows = new Map();
        const fragment = document.createDocumentFragment();

        if (!entries.length) {
            fragment.appendChild(this.createEmptyRow());
            this.rowsByPath.clear();
            this.tbody.replaceChildren(fragment);
            this.applyColumnVisibility(state);
            return;
        }

        const windowRange = this.virtual.enabled
            ? this.computeVirtualWindow(entries.length)
            : {
                startIndex: 0,
                endIndex: entries.length,
                topSpacerHeight: 0,
                bottomSpacerHeight: 0
            };

        if (this.virtual.enabled && windowRange.topSpacerHeight > 0) {
            fragment.appendChild(this.createSpacerRow(windowRange.topSpacerHeight, 'top'));
        }

        for (let index = windowRange.startIndex; index < windowRange.endIndex; index += 1) {
            const entry = entries[index];
            const entryPath = this.toEntryPath(entry, state, host);
            if (!entryPath) continue;
            const type = String(entry?.type || 'file');
            const row = this.rowsByPath.get(entryPath) || this.createRow(entryPath);
            row.dataset.entryPath = entryPath;
            row.dataset.type = type;
            row.classList.toggle('active', selectedPath === entryPath);

            const isClipboardSource = clipboard?.path === entryPath;
            row.classList.toggle('clipboard-row', Boolean(isClipboardSource));
            row.classList.toggle('clipboard-cut', Boolean(isClipboardSource && clipboard?.mode === 'cut'));
            row.classList.toggle('clipboard-copy', Boolean(isClipboardSource && clipboard?.mode === 'copy'));

            const iconNode = type === 'directory' ? cloneTemplate(FOLDER_ICON_TEMPLATE) : cloneTemplate(FILE_ICON_TEMPLATE);
            const nameCell = this.createSelectCell('col-name', entry?.name || '', entryPath, type, iconNode);
            const typeCell = this.createSelectCell('col-type', type, entryPath, type);
            const sizeValue = type === 'directory' ? '—' : host.formatBytes(entry?.size);
            const sizeCell = this.createSelectCell('col-size', sizeValue, entryPath, type);
            const modifiedCell = this.createSelectCell('col-modified', entry?.modified ? host.formatDate(entry.modified) : '—', entryPath, type);
            const actionsCell = this.createActionsCell(
                entryPath,
                type,
                openMenuPath === entryPath,
                Boolean(clipboard) && type === 'directory'
            );

            row.replaceChildren(nameCell, typeCell, sizeCell, modifiedCell, actionsCell);
            nextRows.set(entryPath, row);
            fragment.appendChild(row);
        }

        if (this.virtual.enabled && windowRange.bottomSpacerHeight > 0) {
            fragment.appendChild(this.createSpacerRow(windowRange.bottomSpacerHeight, 'bottom'));
        }

        this.rowsByPath = nextRows;
        this.tbody.replaceChildren(fragment);
        this.applyColumnVisibility(state);
        this.updateMeasuredRowHeight();
    }

    delegateAction(methodName, ...args) {
        const host = this.getHostPresenter();
        const handler = host?.[methodName];
        if (typeof handler !== 'function') return;
        return handler.apply(host, args);
    }

    selectEntry(...args) {
        return this.delegateAction('selectEntry', ...args);
    }

    toggleActionMenu(...args) {
        return this.delegateAction('toggleActionMenu', ...args);
    }

    renameEntry(...args) {
        return this.delegateAction('renameEntry', ...args);
    }

    copyEntry(...args) {
        return this.delegateAction('copyEntry', ...args);
    }

    cutEntry(...args) {
        return this.delegateAction('cutEntry', ...args);
    }

    pasteClipboard(...args) {
        return this.delegateAction('pasteClipboard', ...args);
    }

    deleteEntry(...args) {
        return this.delegateAction('deleteEntry', ...args);
    }
}
