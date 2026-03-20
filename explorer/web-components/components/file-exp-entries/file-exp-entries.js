const VIRTUALIZATION_THRESHOLD = 180;
const DEFAULT_ROW_HEIGHT = 38;
const VIRTUALIZATION_OVERSCAN = 10;

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

function createEntryIcon(iconClass) {
    const icon = document.createElement('span');
    icon.className = `entry-icon ${iconClass}`;
    icon.setAttribute('aria-hidden', 'true');
    return icon;
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

    createSelectCell(className, value, entryPath, type, iconClass = '', options = {}) {
        const cell = document.createElement('td');
        cell.className = className;
        cell.dataset.entryPath = entryPath;
        cell.dataset.type = type;
        cell.dataset.localAction = 'selectEntry';
        if (options.isSymlink) {
            cell.dataset.symlink = 'true';
            if (options.linkTarget) {
                cell.dataset.linkTarget = options.linkTarget;
            }
        }
        if (iconClass) {
            const icon = document.createElement('span');
            icon.className = 'icon';
            icon.appendChild(createEntryIcon(iconClass));
            cell.appendChild(icon);
            const label = document.createElement('span');
            label.className = 'entry-label';
            label.textContent = value;
            cell.appendChild(label);
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
                iconNode: createIconImage('./assets/icons/paste.svg')
            }));
        }

        dropdown.appendChild(this.createMenuItem({
            action: 'deleteEntry',
            label: 'Delete',
            entryPath,
            type,
            destructive: true,
            iconNode: createIconImage('./assets/icons/trash-can.svg')
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
            row.dataset.symlink = entry?.isSymlink ? 'true' : 'false';
            if (entry?.linkTarget) {
                row.title = `Symbolic link to ${entry.linkTarget}`;
            } else {
                row.removeAttribute('title');
            }
            row.classList.toggle('active', selectedPath === entryPath);
            row.classList.toggle('is-symlink', Boolean(entry?.isSymlink));

            const isClipboardSource = clipboard?.path === entryPath;
            row.classList.toggle('clipboard-row', Boolean(isClipboardSource));
            row.classList.toggle('clipboard-cut', Boolean(isClipboardSource && clipboard?.mode === 'cut'));
            row.classList.toggle('clipboard-copy', Boolean(isClipboardSource && clipboard?.mode === 'copy'));

            const iconClass = entry?.isSymlink
                ? (type === 'directory' ? 'icon-folder-symlink' : 'icon-file-symlink')
                : (type === 'directory' ? 'icon-folder' : 'icon-file');
            const nameCell = this.createSelectCell('col-name', entry?.name || '', entryPath, type, iconClass, {
                isSymlink: Boolean(entry?.isSymlink),
                linkTarget: entry?.linkTarget || ''
            });
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
