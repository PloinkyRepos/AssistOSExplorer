import {
    normalizePath,
    joinPath,
    parentPath,
    formatBytes,
    formatDate,
    sanitizeEntryName,
    generateCopyName,
    parseDetailedDirectoryListing,
    isMarkdownFile,
    prepareMarkdownPreviewContent,
    renderMarkdownPreview,
    renderCodePreview
} from "./file-exp-utils.js";
import { createFileExpState, saveFilterSpecsPreference } from "./file-exp-state.js";
import { createFileExpTooling } from "./file-exp-tooling.js";
import { buildEntriesView } from "./file-exp-view-model.js";
import { attachSearchController } from "./file-exp-search.js";
import { attachFsActions } from "./file-exp-fs-actions.js";
import { attachGitController } from "./file-exp-git.js";
import { attachTasksController } from "./file-exp-tasks.js";
import { withGlobalLoader } from "../../../utils/globalLoader.js";
import { createFileExpCaches } from "./file-exp-caches.js";
import { createDirectoryFilterController } from "./file-exp-directory-filter.js";
import { openFile as openFileImpl, tryLoadMediaPreview as tryLoadMediaPreviewImpl, attachPreviewAnchorHandler as attachPreviewAnchorHandlerImpl, detachPreviewAnchorHandler as detachPreviewAnchorHandlerImpl, handlePreviewAnchorClick as handlePreviewAnchorClickImpl } from "./file-exp-preview.js";
import { filterEntriesForSpecs as filterEntriesForSpecsImpl, hasMarkdownInTree as hasMarkdownInTreeImpl } from "./file-exp-specs.js";
import { positionOpenActionMenu as positionOpenActionMenuImpl } from "./file-exp-action-menu.js";
import { getNextMarkdownToggle, getNextBacklogViewToggle, PREVIEW_ACTIONS, previewReducer } from "./file-exp-preview-controller.js";
import { FILE_EXP_UI_ACTIONS, fileExpUiReducer } from "./file-exp-ui-controller.js";
import { createPreviewHeaderController } from "./file-exp-preview-header-controller.js";
import { FILE_EXP_REPLACE_COMPLETE_EVENT } from "../../../utils/appEvents.js";
import { createDomListenerRegistry } from "../../../utils/domListenerRegistry.js";
import { runAfterRender as runLayoutAfterRender } from "./file-exp-layout-controller.js";
import { loadStateFromURL as loadStateFromURLImpl, loadDirectory as loadDirectoryImpl, refreshDirectory as refreshDirectoryImpl, renderBreadcrumbs as renderBreadcrumbsImpl, goUpDirectory as goUpDirectoryImpl } from "./file-exp-navigation-controller.js";
import { selectEntry as selectEntryImpl, handleSortClick as handleSortClickImpl } from "./file-exp-selection-controller.js";

const LARGE_FILE_PREVIEW_LIMIT_BYTES = 1.5 * 1024 * 1024; // ~1.5MB safety window before transport limits
const LARGE_FILE_PREVIEW_LINES = 400;

export class FileExp {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;

        this.boundPreviewAnchorHandler = this.handlePreviewAnchorClick.bind(this);
        this.normalizePath = normalizePath;
        this.joinPath = joinPath;
        this.parentPath = parentPath;
        this.formatBytes = formatBytes;
        this.formatDate = formatDate;
        this.sanitizeEntryName = sanitizeEntryName;
        this.generateCopyName = (baseName, existingNames = null) => generateCopyName(baseName, existingNames, this.state?.entries || []);
        this.isMarkdownFile = isMarkdownFile;
        this.prepareMarkdownPreviewContent = prepareMarkdownPreviewContent;
        this.renderMarkdownPreview = renderMarkdownPreview;

        this.stateStore = createFileExpState();
        this.state = this.stateStore.state;
        this.cleanupCallbacks = [];
        this.domListenerRegistry = createDomListenerRegistry();
        this.pendingMenuFocusPath = null;
        this.searchByNameTimer = null;
        this.boundGlobalKeydown = null;
        this.boundOutsideSearchMenuClick = null;
        this.boundSortClickHandler = (event) => this.handleSortClick(event);

        attachSearchController(this);
        attachFsActions(this);
        attachGitController(this);
        attachTasksController(this);

        this.boundLoadStateFromURL = this.loadStateFromURL.bind(this);
        this.setWindowListener('file-exp-popstate', 'popstate', this.boundLoadStateFromURL);
        this.invalidate(this.boundLoadStateFromURL);

        this.boundOutsideMenuClick = this.handleOutsideMenuClick.bind(this);
        this.boundMenuKeydown = this.handleMenuKeydown.bind(this);
        this.boundContextMenu = this.handleContextMenu.bind(this);

        this.caches = createFileExpCaches();
        this.inflightDirListing = new Map();
        this.directoryFilterController = createDirectoryFilterController(this);
        this.previewHeaderController = createPreviewHeaderController(this);
        this.tooling = createFileExpTooling();
        this.lastLoadError = null;
        this.previewDom = null;
    }

    async withLoader(fn) {
        return withGlobalLoader(fn);
    }


    beforeUnload() {
        this.detachPreviewAnchorHandler();
        this.previewDom = null;
        if (this.boundGlobalKeydown) {
            document.removeEventListener('keydown', this.boundGlobalKeydown);
        }
        if (this.boundOutsideSearchMenuClick) {
            document.removeEventListener('click', this.boundOutsideSearchMenuClick, true);
        }
        if (this.boundReplaceComplete) {
            window.removeEventListener(FILE_EXP_REPLACE_COMPLETE_EVENT, this.boundReplaceComplete);
            this.boundReplaceComplete = null;
        }
        const entriesContainer = this.element?.querySelector('.entries');
        if (entriesContainer) {
            entriesContainer.removeEventListener('contextmenu', this.boundContextMenu, true);
        }
        this.flushCleanupCallbacks();
    }

    registerCleanup(callback) {
        if (typeof callback !== 'function') {
            return () => {};
        }
        this.cleanupCallbacks.push(callback);
        return callback;
    }

    addWindowListener(type, listener, options) {
        return this.domListenerRegistry.add(window, type, listener, options);
    }

    addDocumentListener(type, listener, options) {
        return this.domListenerRegistry.add(document, type, listener, options);
    }

    setDomListener(key, target, type, listener, options) {
        if (!key) return () => {};
        return this.domListenerRegistry.set(key, target, type, listener, options);
    }

    removeDomListener(key) {
        if (!key) return false;
        return this.domListenerRegistry.remove(key);
    }

    setWindowListener(key, type, listener, options) {
        return this.setDomListener(`window:${key}`, window, type, listener, options);
    }

    removeWindowListener(key) {
        return this.removeDomListener(`window:${key}`);
    }

    setDocumentListener(key, type, listener, options) {
        return this.setDomListener(`document:${key}`, document, type, listener, options);
    }

    removeDocumentListener(key) {
        return this.removeDomListener(`document:${key}`);
    }

    setElementListener(key, element, type, listener, options) {
        return this.setDomListener(`element:${key}`, element, type, listener, options);
    }

    removeElementListener(key) {
        return this.removeDomListener(`element:${key}`);
    }

    flushCleanupCallbacks() {
        if (!Array.isArray(this.cleanupCallbacks) || !this.cleanupCallbacks.length) {
            return;
        }
        const callbacks = this.cleanupCallbacks.splice(0, this.cleanupCallbacks.length);
        for (const callback of callbacks.reverse()) {
            try {
                callback();
            } catch (_) {
                // Ignore cleanup errors to avoid breaking unload flow.
            }
        }
        this.domListenerRegistry.clear();
    }

    async loadStateFromURL() {
        return loadStateFromURLImpl(this);
    }

    beforeRender() {
        const snapshot = this.stateStore?.getState ? this.stateStore.getState() : this.state;
        this.entriesHTML = buildEntriesView(snapshot, {
            joinPath: this.joinPath,
            formatBytes: this.formatBytes,
            formatDate: this.formatDate
        });
    }

    renderEntries() {
        const snapshot = this.stateStore?.getState ? this.stateStore.getState() : this.state;
        this.entriesHTML = buildEntriesView(snapshot, {
            joinPath: this.joinPath,
            formatBytes: this.formatBytes,
            formatDate: this.formatDate
        });
        const entriesBody = this.element?.querySelector?.('#entriesBody');
        if (entriesBody) {
            entriesBody.innerHTML = this.entriesHTML;
        }
        this.applyColumnVisibility();
        if (this.state.openMenuPath) {
            this.positionOpenActionMenu();
        }
    }

    renderEntriesBody() {
        this.renderEntries();
    }

    async afterRender() {
        return runLayoutAfterRender(this, {
            previewLines: LARGE_FILE_PREVIEW_LINES
        });
    }

    async loadDirectoryContent(path) {
        try {
            this.lastLoadError = null;
            const cached = this.caches.dirListing.get(this, path);
            if (cached) {
                return cached;
            }
            const globalInflight = window.__fileExpInflightDirListing || (window.__fileExpInflightDirListing = new Map());
            if (this.inflightDirListing.has(path)) {
                return await this.inflightDirListing.get(path);
            }
            if (globalInflight.has(path)) {
                return await globalInflight.get(path);
            }
            const request = (async () => {
            const result = await this.tooling.listDirectoryDetailed(path);
            const entries = parseDetailedDirectoryListing(result.text);
            const resolved = entries.map(entry => ({
                ...entry,
                path: this.joinPath(path, entry.name)
            }));
            this.caches.dirListing.set(this, path, resolved);
            return resolved;
            })();
            this.inflightDirListing.set(path, request);
            globalInflight.set(path, request);
            try {
                return await request;
            } finally {
                this.inflightDirListing.delete(path);
                globalInflight.delete(path);
            }
        } catch (err) {
            this.lastLoadError = err;
            if (this.isPathNotFoundError(err)) {
                return null;
            }
            console.error(err);
            this.showStatus(err.message || 'Failed to load directory.', true);
            return [];
        }
    }

    async setEntries(entries) {
        const snapshot = this.stateStore?.getState ? this.stateStore.getState() : this.state;
        const sourceEntries = Array.isArray(entries) ? entries : [];
        this.state.allEntries = sourceEntries;
        try {
            const filterQuery = String(snapshot.directoryFilterQuery || '').trim().toLowerCase();
            const applyDirectoryFilter = (items) => {
                if (!filterQuery) return items || [];
                return (items || []).filter((entry) => {
                    const name = String(entry?.name || '').toLowerCase();
                    const entryPath = String(entry?.path || '').toLowerCase();
                    return name.includes(filterQuery) || entryPath.includes(filterQuery);
                });
            };

            if (snapshot.filterSpecs) {
                const filtered = await this.filterEntriesForSpecs(sourceEntries);
                this.state.entries = this.sortEntries(applyDirectoryFilter(filtered));
            } else {
                this.state.entries = this.sortEntries(applyDirectoryFilter(sourceEntries));
            }
        } catch (err) {
            console.warn('Failed to apply specs filter', err);
            this.state.entries = this.sortEntries(sourceEntries);
            this.showStatus('Could not apply filter. Showing all files.', true);
        }
    }

    sortEntries(entries = []) {
        if (!Array.isArray(entries)) return [];
        const { sortBy, sortDir } = this.state;
        const direction = sortDir === 'desc' ? -1 : 1;
        const toLower = (value) => (typeof value === 'string' ? value.toLowerCase() : '');
        const getValue = (entry, key) => {
            switch (key) {
                case 'size':
                    return Number.isFinite(entry.size) ? entry.size : -1;
                case 'modified': {
                    const ts = Date.parse(entry.modified);
                    return Number.isFinite(ts) ? ts : 0;
                }
                case 'name':
                default:
                    return toLower(entry.name || '');
            }
        };
        const copy = [...entries];
        copy.sort((a, b) => {
            // Keep directories before files for consistency
            const typeOrderA = a.type === 'directory' ? 0 : 1;
            const typeOrderB = b.type === 'directory' ? 0 : 1;
            if (typeOrderA !== typeOrderB) {
                return typeOrderA - typeOrderB;
            }
            const aVal = getValue(a, sortBy);
            const bVal = getValue(b, sortBy);
            let result = 0;
            if (typeof aVal === 'string' || typeof bVal === 'string') {
                result = String(aVal).localeCompare(String(bVal), undefined, { sensitivity: 'base' });
            } else {
                result = aVal === bVal ? 0 : (aVal < bVal ? -1 : 1);
            }
            if (result === 0 && sortBy !== 'name') {
                result = toLower(a.name || '').localeCompare(toLower(b.name || ''), undefined, { sensitivity: 'base' });
            }
            return result * direction;
        });
        return copy;
    }

    async loadDirectory(path = this.state.path) {
        return loadDirectoryImpl(this, path);
    }

    async refresh() {
        return refreshDirectoryImpl(this);
    }

    async selectEntry(element) {
        return selectEntryImpl(this, element);
    }

    async tryLoadMediaPreview(filePath) {
        return tryLoadMediaPreviewImpl(this, filePath);
    }

    async openFile(filePath) {
        if (filePath && !String(filePath).endsWith('.backlog') && !String(filePath).endsWith('.history')) {
            this.state.backlogTextView = false;
        }
        const result = await openFileImpl(this, filePath, {
            largeFilePreviewLimitBytes: LARGE_FILE_PREVIEW_LIMIT_BYTES,
            largeFilePreviewLines: LARGE_FILE_PREVIEW_LINES
        });
        this.syncWebViewForPath(filePath);
        return result;
    }

    async editFile() {
        if (!this.state.selectedPath) return;
        const selectedPath = this.state.selectedPath || '';
        if (selectedPath.endsWith('.history')) {
            this.showStatus('History files are read-only.', true);
            return;
        }
        if (selectedPath.endsWith('.backlog') && !this.state.backlogTextView) {
            this.showStatus('Backlog is managed by the Backlog panel.', true);
            return;
        }
        if (this.state.fileLoadInfo?.truncated) {
            this.showStatus('Editing is disabled for large files. Please open it locally to modify.', true);
            return;
        }
        if (this.state.selectedIsMarkdown && !this.state.documentId) {
            try {
                const documentModule = window.assistOS?.loadModule?.('document');
                if (documentModule) {
                    const doc = await documentModule.loadDocument(this.state.selectedPath);
                    this.state.documentId = doc?.id ?? null;
                    if (doc?.id && window.assistOS?.workspace) {
                        window.assistOS.workspace.currentDocumentId = doc.id;
                        window.assistOS.workspace.currentDocumentPath = this.state.selectedPath;
                    }
                }
            } catch (error) {
                console.warn('Failed to prepare document editor', error);
            }
        }
        this.state.markdownTextView = false;
        this.setHasUnsavedChanges(false);
        this.state.isEditing = true;
        this.invalidate();
    }

    async saveFile() {
        this.textarea = this.element.querySelector('.code-input');
        if (!this.textarea) {
            return;
        }

        const newContent = this.textarea.value;
        try {
            await this.tooling.writeFile(this.state.selectedPath, newContent);
            this.showStatus(`Successfully saved ${this.state.selectedPath}`, false);
            this.state.fileContent = newContent;
            this.setHasUnsavedChanges(false);
            this.caches.filePreview.invalidateForPath(this.state.selectedPath);
            this.caches.dirListing.invalidate(this, this.state.path);

            if (this.state.selectedIsMarkdown) {
                const previewSource = this.prepareMarkdownPreviewContent(newContent);
                this.state.previewContent = renderMarkdownPreview(previewSource);
                this.state.markdownTextView = false;
                try {
                    const documentModule = window.assistOS?.loadModule?.('document');
                    if (documentModule) {
                        const doc = await documentModule.loadDocument(this.state.selectedPath);
                        this.state.documentId = doc?.id ?? null;
                        if (doc?.id) {
                            window.assistOS.workspace.currentDocumentId = doc.id;
                            window.assistOS.workspace.currentDocumentPath = this.state.selectedPath;
                        }
                    }
                } catch (docError) {
                    console.warn('Failed to refresh document after save', docError);
                }
            } else {
                this.state.previewContent = renderCodePreview(newContent, this.state.selectedPath);
            }

            if (this.isHtmlPreviewCandidate(this.state.selectedPath) && this.state.previewViewMode !== 'code') {
                this.dispatchPreview({
                    type: PREVIEW_ACTIONS.REFRESH,
                    payload: { path: this.state.selectedPath }
                });
            }

            this.state.isEditing = false;
            this.editorPresenter = null;
            this.invalidate();
        } catch (err) {
            console.error(err);
            this.showStatus(err.message || 'Failed to save file.', true);
        }
    }

    async cancelEdit() {
        this.state.isEditing = false;
        this.state.markdownTextView = false;
        this.setHasUnsavedChanges(false);
        this.editorPresenter = null;
        if (this.state.selectedIsMarkdown && this.state.selectedPath) {
            await this.openFile(this.state.selectedPath);
            return;
        }
        this.invalidate();
    }

    renderBreadcrumbs() {
        return renderBreadcrumbsImpl(this);
    }

    showStatus(message, isError = false) {
        const statusBanner = this.element?.querySelector?.('#statusBanner');
        if (!statusBanner) {
            return;
        }
        if (!message) {
            statusBanner.classList.remove('visible', 'error');
            statusBanner.textContent = '';
            return;
        }
        statusBanner.textContent = message;
        statusBanner.classList.add('visible');
        statusBanner.classList.toggle('error', Boolean(isError));
        setTimeout(() => this.showStatus(null), 5000);
    }

    isPathNotFoundError(err) {
        const message = err?.message || '';
        return err?.code === 'ENOENT' || message.includes('ENOENT');
    }

    async goUp() {
        return goUpDirectoryImpl(this);
    }

    async filterEntriesForSpecs(entries = []) {
        return filterEntriesForSpecsImpl(this, entries);
    }

    async hasMarkdownInTree(dirPath) {
        return hasMarkdownInTreeImpl(this, dirPath);
    }

    toggleHidden(element, hidden = true) {
        if (!element) return;
        element.classList.toggle('hidden', Boolean(hidden));
    }

    createPreviewActionButton(label, action, className = 'preview-pane-action') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.dataset.localAction = action;
        button.textContent = label;
        return button;
    }

    createPreviewCloseButton(action, label) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'close preview-pane-close';
        button.dataset.localAction = action;
        button.setAttribute('aria-label', label);
        button.setAttribute('title', label);

        const icon = document.createElement('img');
        icon.className = 'close-icon';
        icon.src = './assets/icons/x-mark.svg';
        icon.alt = 'close';
        button.appendChild(icon);
        return button;
    }

    clearMountElement(mount) {
        if (!mount) return;
        mount.textContent = '';
        if (mount.dataset) {
            delete mount.dataset.presenterKey;
        }
    }

    mountPresenterElement(mount, { key, tagName, attributes = {} }) {
        if (!mount || !tagName) return null;
        const normalizedTag = String(tagName).toLowerCase();
        const normalizedKey = String(key || normalizedTag);
        const currentKey = mount.dataset?.presenterKey || '';
        const currentNode = mount.firstElementChild;
        const currentTag = currentNode?.tagName?.toLowerCase() || '';
        const shouldReplace = !currentNode || currentTag !== normalizedTag || currentKey !== normalizedKey;

        let node = currentNode;
        if (shouldReplace) {
            mount.textContent = '';
            node = document.createElement(normalizedTag);
            mount.appendChild(node);
            if (mount.dataset) {
                mount.dataset.presenterKey = normalizedKey;
            }
        }

        Object.entries(attributes).forEach(([attr, value]) => {
            if (value === undefined || value === null || value === '') {
                node.removeAttribute(attr);
            } else {
                node.setAttribute(attr, String(value));
            }
        });

        return node;
    }

    ensurePreviewDom(previewContent) {
        const cached = this.previewDom;
        if (cached && cached.host === previewContent && previewContent.contains(cached.standardPane) && previewContent.contains(cached.htmlSplit)) {
            return cached;
        }

        const standardPane = document.createElement('div');
        standardPane.className = 'preview-standard-pane';

        const filePreview = document.createElement('div');
        filePreview.id = 'filePreview';
        filePreview.className = 'code-preview';

        const mediaPreview = document.createElement('div');
        mediaPreview.className = 'media-preview hidden';

        const componentMount = document.createElement('div');
        componentMount.className = 'preview-component-mount hidden';

        standardPane.appendChild(filePreview);
        standardPane.appendChild(mediaPreview);
        standardPane.appendChild(componentMount);

        const htmlSplit = document.createElement('div');
        htmlSplit.className = 'preview-split hidden';

        const codePane = document.createElement('div');
        codePane.className = 'preview-pane';
        const codePaneShell = document.createElement('div');
        codePaneShell.className = 'preview-pane-shell';
        const codePaneHeader = document.createElement('div');
        codePaneHeader.className = 'preview-pane-header';
        const codePaneTitle = document.createElement('span');
        codePaneTitle.className = 'preview-pane-title';
        codePaneTitle.textContent = 'Code';
        const codePaneActions = document.createElement('div');
        codePaneActions.className = 'preview-pane-actions';
        const hideCodeButton = this.createPreviewCloseButton('setPreviewViewMode web', 'Hide Code');
        codePaneActions.appendChild(hideCodeButton);
        codePaneHeader.appendChild(codePaneTitle);
        codePaneHeader.appendChild(codePaneActions);
        const codePaneBody = document.createElement('div');
        codePaneBody.className = 'preview-pane-body';
        const splitCodeComponentMount = document.createElement('div');
        splitCodeComponentMount.className = 'preview-component-mount hidden';
        codePaneBody.appendChild(splitCodeComponentMount);
        codePaneShell.appendChild(codePaneHeader);
        codePaneShell.appendChild(codePaneBody);
        codePane.appendChild(codePaneShell);

        const webPane = document.createElement('div');
        webPane.className = 'preview-pane';
        const webPaneShell = document.createElement('div');
        webPaneShell.className = 'preview-pane-shell';
        const webPaneHeader = document.createElement('div');
        webPaneHeader.className = 'preview-pane-header';
        const webUrlLabel = document.createElement('span');
        webUrlLabel.className = 'html-web-view-url';
        const webPaneActions = document.createElement('div');
        webPaneActions.className = 'preview-pane-actions';
        const webActionGroup = document.createElement('div');
        webActionGroup.className = 'html-web-view-actions';
        const refreshWebButton = this.createPreviewActionButton('Refresh', 'refreshWebPreviewPane');
        const openWebTabButton = this.createPreviewActionButton('Open in tab', 'openWebPreviewInTab');
        webActionGroup.appendChild(refreshWebButton);
        webActionGroup.appendChild(openWebTabButton);
        const hideWebButton = this.createPreviewCloseButton('setPreviewViewMode code', 'Hide Web');
        webPaneActions.appendChild(webActionGroup);
        webPaneActions.appendChild(hideWebButton);
        webPaneHeader.appendChild(webUrlLabel);
        webPaneHeader.appendChild(webPaneActions);
        const webPaneBody = document.createElement('div');
        webPaneBody.className = 'preview-pane-body';
        const webPlaceholder = document.createElement('div');
        webPlaceholder.className = 'preview-placeholder hidden';
        webPlaceholder.textContent = 'Web preview is unavailable for this file.';
        const webMount = document.createElement('div');
        webMount.className = 'preview-web-mount hidden';
        webPaneBody.appendChild(webPlaceholder);
        webPaneBody.appendChild(webMount);
        webPaneShell.appendChild(webPaneHeader);
        webPaneShell.appendChild(webPaneBody);
        webPane.appendChild(webPaneShell);

        htmlSplit.appendChild(codePane);
        htmlSplit.appendChild(webPane);

        previewContent.replaceChildren(standardPane, htmlSplit);

        this.previewDom = {
            host: previewContent,
            standardPane,
            filePreview,
            mediaPreview,
            componentMount,
            htmlSplit,
            codePane,
            codePaneBody,
            splitCodeComponentMount,
            hideCodeButton,
            webPane,
            webPaneBody,
            webUrlLabel,
            webActionGroup,
            refreshWebButton,
            openWebTabButton,
            hideWebButton,
            webPlaceholder,
            webMount
        };

        return this.previewDom;
    }

    renderStandardPreview(refs, previewUiState) {
        const defaultText = 'Select a file to see its contents.';
        this.toggleHidden(refs.standardPane, false);
        this.toggleHidden(refs.htmlSplit, true);
        refs.htmlSplit.classList.remove('single');
        this.toggleHidden(refs.mediaPreview, true);
        this.toggleHidden(refs.componentMount, true);
        this.toggleHidden(refs.splitCodeComponentMount, true);
        this.clearMountElement(refs.splitCodeComponentMount);

        if (refs.filePreview.parentElement !== refs.standardPane) {
            refs.standardPane.insertBefore(refs.filePreview, refs.mediaPreview);
        }
        this.toggleHidden(refs.filePreview, false);

        if (this.state.isEditing) {
            this.detachPreviewAnchorHandler();
            this.toggleHidden(refs.filePreview, true);
            this.toggleHidden(refs.componentMount, false);
            if (this.state.selectedIsMarkdown && this.state.documentId) {
                this.mountPresenterElement(refs.componentMount, {
                    key: `document-view:${this.state.selectedPath}:${this.state.documentId}`,
                    tagName: 'document-view-page',
                    attributes: {
                        'data-presenter': 'document-view-page',
                        'data-path': this.state.selectedPath,
                        documentId: this.state.documentId
                    }
                });
            } else {
                this.mountPresenterElement(refs.componentMount, {
                    key: `file-editor:${this.state.selectedPath}`,
                    tagName: 'file-editor',
                    attributes: {
                        'data-presenter': 'file-editor',
                        'data-path': this.state.selectedPath
                    }
                });
            }
            return;
        }

        if (previewUiState.showBacklogPanel) {
            this.detachPreviewAnchorHandler();
            this.toggleHidden(refs.filePreview, true);
            this.toggleHidden(refs.componentMount, false);
            const pathAttr = this.state.selectedPath || '';
            const repoPath = this.parentPath(pathAttr) || '/';
            this.mountPresenterElement(refs.componentMount, {
                key: `backlog-panel:${pathAttr}:${repoPath}`,
                tagName: 'backlog-panel',
                attributes: {
                    'data-presenter': 'backlog-panel',
                    'data-path': pathAttr,
                    'data-repo-path': repoPath
                }
            });
            return;
        }

        this.clearMountElement(refs.componentMount);

        if (this.state.previewMode === 'media') {
            this.detachPreviewAnchorHandler();
            this.toggleHidden(refs.filePreview, true);
            this.toggleHidden(refs.mediaPreview, false);
            const content = this.state.previewContent || '<div class="preview-placeholder">Unable to preview file.</div>';
            refs.mediaPreview.innerHTML = content;
            return;
        }

        this.toggleHidden(refs.mediaPreview, true);
        refs.mediaPreview.textContent = '';

        if (this.state.selectedIsMarkdown) {
            if (this.state.markdownTextView) {
                refs.filePreview.className = 'markdown-raw-view';
                refs.filePreview.textContent = this.state.selectedPath ? this.state.fileContent : defaultText;
                this.detachPreviewAnchorHandler();
            } else {
                refs.filePreview.className = 'markdown-preview';
                if (this.state.selectedPath) {
                    const content = typeof this.state.previewContent === 'string' ? this.state.previewContent : '';
                    refs.filePreview.innerHTML = content;
                } else {
                    refs.filePreview.textContent = defaultText;
                }
                this.attachPreviewAnchorHandler();
            }
            return;
        }

        refs.filePreview.className = 'code-preview';
        if (this.state.selectedPath) {
            refs.filePreview.innerHTML = this.state.previewContent || '';
        } else {
            refs.filePreview.textContent = defaultText;
        }
        this.detachPreviewAnchorHandler();
    }

    renderHtmlPreview(refs, previewUiState) {
        this.detachPreviewAnchorHandler();
        this.toggleHidden(refs.standardPane, true);
        this.toggleHidden(refs.htmlSplit, false);
        this.toggleHidden(refs.componentMount, true);
        this.clearMountElement(refs.componentMount);

        const webViewUrl = this.state.webViewUrl || this.buildWebViewUrl(this.state.selectedPath);
        const reloadToken = Number(this.state.webViewReloadToken || 0);
        refs.webUrlLabel.textContent = webViewUrl || '';
        refs.webUrlLabel.title = webViewUrl || '';

        let showCodePane = previewUiState.viewMode === 'split' && !previewUiState.codeHidden;
        let showWebPane = previewUiState.viewMode === 'web' || (previewUiState.viewMode === 'split' && !previewUiState.webHidden);
        if (!showCodePane && !showWebPane) {
            showWebPane = true;
        }

        this.toggleHidden(refs.codePane, !showCodePane);
        this.toggleHidden(refs.webPane, !showWebPane);
        refs.htmlSplit.classList.toggle('single', !(showCodePane && showWebPane));
        this.toggleHidden(refs.hideCodeButton, previewUiState.viewMode !== 'split' || !showCodePane);
        this.toggleHidden(refs.hideWebButton, previewUiState.viewMode !== 'split' || !showWebPane);

        if (showCodePane) {
            this.toggleHidden(refs.splitCodeComponentMount, true);
            if (this.state.isEditing) {
                this.toggleHidden(refs.filePreview, true);
                this.toggleHidden(refs.splitCodeComponentMount, false);
                this.mountPresenterElement(refs.splitCodeComponentMount, {
                    key: `file-editor:${this.state.selectedPath}`,
                    tagName: 'file-editor',
                    attributes: {
                        'data-presenter': 'file-editor',
                        'data-path': this.state.selectedPath
                    }
                });
            } else {
                this.clearMountElement(refs.splitCodeComponentMount);
                if (refs.filePreview.parentElement !== refs.codePaneBody) {
                    refs.codePaneBody.insertBefore(refs.filePreview, refs.splitCodeComponentMount);
                }
                refs.filePreview.className = 'code-preview';
                refs.filePreview.innerHTML = this.state.previewContent || 'Select a file to see its contents.';
                this.toggleHidden(refs.filePreview, false);
            }
        } else {
            this.toggleHidden(refs.filePreview, true);
            this.toggleHidden(refs.splitCodeComponentMount, true);
            this.clearMountElement(refs.splitCodeComponentMount);
        }

        if (!showWebPane) {
            this.toggleHidden(refs.webPlaceholder, true);
            this.toggleHidden(refs.webMount, true);
            return;
        }

        const canOpenPreview = Boolean(webViewUrl);
        refs.refreshWebButton.toggleAttribute('disabled', !canOpenPreview);
        refs.openWebTabButton.toggleAttribute('disabled', !canOpenPreview);

        if (!canOpenPreview) {
            this.clearMountElement(refs.webMount);
            this.toggleHidden(refs.webMount, true);
            this.toggleHidden(refs.webPlaceholder, false);
            return;
        }

        this.toggleHidden(refs.webPlaceholder, true);
        this.toggleHidden(refs.webMount, false);
        this.mountPresenterElement(refs.webMount, {
            key: `html-web-view:${webViewUrl}:${reloadToken}:${this.state.selectedPath || ''}`,
            tagName: 'html-web-view',
            attributes: {
                'data-presenter': 'html-web-view',
                'data-url': webViewUrl,
                'data-source-path': this.state.selectedPath || '',
                'data-reload-token': String(reloadToken),
                'data-live-source-selector': '.code-input'
            }
        });
    }

    renderPreviewPanel(previewContent, previewUiState) {
        if (!previewContent) return;
        const refs = this.ensurePreviewDom(previewContent);
        if (previewUiState.isHtml && previewUiState.viewMode !== 'code') {
            this.renderHtmlPreview(refs, previewUiState);
            return;
        }
        this.renderStandardPreview(refs, previewUiState);
    }

    toggleMarkdownView() {
        const transition = getNextMarkdownToggle(this.state);
        if (!transition.changed) {
            return;
        }
        Object.assign(this.state, transition.patch);
        this.invalidate();
    }

    async toggleFilterSpecs(element) {
        await this.withLoader(async () => {
            this.setFilterSpecs(Boolean(element?.checked));
            saveFilterSpecsPreference(this.state.filterSpecs);
            await this.setEntries(this.state.allEntries?.length ? this.state.allEntries : this.state.entries);
            this.invalidate();
        });
    }

    applyColumnVisibility() {
        const columns = ['type', 'size', 'modified'];
        columns.forEach((col) => {
            const visible = this.state.columnVisibility?.[col] !== false;
            const cells = this.element.querySelectorAll(`.col-${col}`);
            cells.forEach((cell) => {
                cell.classList.toggle('column-hidden', !visible);
            });
        });
    }

    renderBacklogViewToggle(headerExtras, showBacklogPanel) {
        if (!headerExtras) return;
        let button = headerExtras.querySelector('#backlogViewToggle');
        if (!button) {
            button = document.createElement('button');
            button.id = 'backlogViewToggle';
            button.type = 'button';
            button.className = 'secondary';
            button.addEventListener('click', async () => {
                const transition = getNextBacklogViewToggle(this.state);
                if (transition.blocked) {
                    this.showStatus('Save or cancel changes before switching backlog view.', true);
                    return;
                }
                if (!transition.changed) {
                    return;
                }
                Object.assign(this.state, transition.patch);
                if (transition.shouldReloadSelection && this.state.selectedPath) {
                    await this.openFile(this.state.selectedPath);
                }
                this.invalidate();
            });
            headerExtras.appendChild(button);
        }
        button.textContent = showBacklogPanel ? 'View as text' : 'View as backlog';
    }

    setPreviewViewMode(_target, mode) {
        if (!this.isHtmlPreviewCandidate(this.state.selectedPath)) {
            return;
        }
        this.dispatchPreview({
            type: PREVIEW_ACTIONS.SET_VIEW_MODE,
            payload: { mode }
        }, { invalidate: true });
    }

    getActiveWebViewPresenter() {
        const webViewElement = this.element?.querySelector?.('html-web-view');
        return webViewElement?.webSkelPresenter || null;
    }

    refreshWebPreviewPane() {
        const presenter = this.getActiveWebViewPresenter();
        if (presenter && typeof presenter.refreshIframe === 'function') {
            presenter.refreshIframe();
            return;
        }
        this.dispatchPreview({
            type: PREVIEW_ACTIONS.REFRESH,
            payload: { path: this.state.selectedPath }
        }, { invalidate: true });
    }

    openWebPreviewInTab() {
        const presenter = this.getActiveWebViewPresenter();
        if (presenter && typeof presenter.openInNewTab === 'function') {
            presenter.openInNewTab();
            return;
        }
        const webViewUrl = this.state.webViewUrl || this.buildWebViewUrl(this.state.selectedPath);
        if (!webViewUrl) return;
        try {
            const absoluteUrl = new URL(webViewUrl, window.location.origin).toString();
            window.open(absoluteUrl, '_blank', 'noopener,noreferrer');
        } catch (_) {
            // ignore malformed URL fallback
        }
    }

    dispatchUi(action, options = {}) {
        const { invalidate = false } = options;
        const transition = fileExpUiReducer(this.state, action);
        if (!transition.changed) {
            return false;
        }
        Object.assign(this.state, transition.patch);
        if (invalidate) {
            this.invalidate();
        }
        return true;
    }

    setToolbarMenuOpen(open, options = {}) {
        return this.dispatchUi({
            type: FILE_EXP_UI_ACTIONS.SET_TOOLBAR_MENU_OPEN,
            payload: { open }
        }, options);
    }

    setSearchMenuOpen(open, options = {}) {
        return this.dispatchUi({
            type: FILE_EXP_UI_ACTIONS.SET_SEARCH_MENU_OPEN,
            payload: { open }
        }, options);
    }

    setPendingHighlight(highlight, options = {}) {
        return this.dispatchUi({
            type: FILE_EXP_UI_ACTIONS.SET_PENDING_HIGHLIGHT,
            payload: { highlight }
        }, options);
    }

    setOpenMenuPath(pathValue, options = {}) {
        return this.dispatchUi({
            type: FILE_EXP_UI_ACTIONS.SET_OPEN_MENU_PATH,
            payload: { path: pathValue }
        }, options);
    }

    setListWidth(width, options = {}) {
        return this.dispatchUi({
            type: FILE_EXP_UI_ACTIONS.SET_LIST_WIDTH,
            payload: { width }
        }, options);
    }

    setIsResizing(isResizing, options = {}) {
        return this.dispatchUi({
            type: FILE_EXP_UI_ACTIONS.SET_IS_RESIZING,
            payload: { isResizing }
        }, options);
    }

    setColumnVisibility(column, visible, options = {}) {
        return this.dispatchUi({
            type: FILE_EXP_UI_ACTIONS.SET_COLUMN_VISIBILITY,
            payload: { column, visible }
        }, options);
    }

    setHasUnsavedChanges(hasUnsavedChanges, options = {}) {
        return this.dispatchUi({
            type: FILE_EXP_UI_ACTIONS.SET_HAS_UNSAVED_CHANGES,
            payload: { hasUnsavedChanges }
        }, options);
    }

    setFilterSpecs(filterSpecs, options = {}) {
        return this.dispatchUi({
            type: FILE_EXP_UI_ACTIONS.SET_FILTER_SPECS,
            payload: { filterSpecs }
        }, options);
    }

    isHtmlPreviewCandidate(pathValue) {
        return /\.html?$/i.test(String(pathValue || ''));
    }

    syncWebViewForPath(pathValue) {
        this.dispatchPreview({
            type: PREVIEW_ACTIONS.SYNC_PATH,
            payload: {
                path: pathValue,
                buildWebViewUrl: (path) => this.buildWebViewUrl(path)
            }
        });
    }

    dispatchPreview(action, options = {}) {
        const { invalidate = false } = options;
        const transition = previewReducer(this.state, action);
        if (!transition.changed) {
            return false;
        }
        Object.assign(this.state, transition.patch);
        if (invalidate) {
            this.invalidate();
        }
        return true;
    }

    buildWebViewUrl(pathValue) {
        const rawPath = String(pathValue || '').trim();
        if (!rawPath) return '';
        const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
        if (!normalized || normalized.includes('..')) return '';
        const encodedPath = normalized
            .split('/')
            .filter(Boolean)
            .map((part) => encodeURIComponent(part))
            .join('/');
        return `/${encodedPath}`;
    }

    attachPreviewAnchorHandler() {
        return attachPreviewAnchorHandlerImpl(this);
    }

    detachPreviewAnchorHandler() {
        return detachPreviewAnchorHandlerImpl(this);
    }

    handlePreviewAnchorClick(event) {
        return handlePreviewAnchorClickImpl(this, event);
    }

    positionOpenActionMenu() {
        return positionOpenActionMenuImpl(this);
    }

    handleSortClick(event) {
        return handleSortClickImpl(this, event);
    }

}
