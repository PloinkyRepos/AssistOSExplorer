import {
    normalizePath,
    joinPath,
    parentPath,
    formatBytes,
    formatDate,
    sanitizeEntryName,
    generateCopyName,
    parseDetailedDirectoryListing,
    buildEntriesHTML,
    isMarkdownFile,
    prepareMarkdownPreviewContent,
    renderMarkdownPreview,
    renderCodePreview,
    scrollToLine
} from "./file-exp-utils.js";
import { attachSearchController } from "./file-exp-search.js";
import { attachFsActions } from "./file-exp-fs-actions.js";

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
        this.prepareMarkdownPreviewContent = prepareMarkdownPreviewContent;
        this.renderMarkdownPreview = renderMarkdownPreview;

        this.state = {
            path: '/',
            entries: [],
            allEntries: [],
            selectedPath: null,
            fileContent: "",
            previewContent: "",
            selectedIsMarkdown: false,
            markdownTextView: false,
            documentId: null,
            isEditing: false,
            hasUnsavedChanges: false,
            isResizing: false,
            clipboard: null,
            openMenuPath: null,
            filterSpecs: this.loadFilterSpecsPreference(),
            searchMenuOpen: false,
            searchOverlay: null,
            searchByNameQuery: '',
            searchByNameExclude: 'node_modules,.git',
            searchByNameResults: [],
            searchByNameLoading: false,
            searchByNameError: null,
            searchInFilesQuery: '',
            searchInFilesExclude: 'node_modules,.git',
            searchInFilesCaseSensitive: false,
            searchInFilesResults: [],
            searchInFilesFileResults: [],
            searchInFilesLoading: false,
            searchInFilesError: null,
            searchInFilesTruncated: false,
            pendingHighlight: null
        };
        this.pendingMenuFocusPath = null;
        this.searchByNameTimer = null;
        this.boundGlobalKeydown = null;
        this.boundOutsideSearchMenuClick = null;

        attachSearchController(this);
        attachFsActions(this);

        this.boundLoadStateFromURL = this.loadStateFromURL.bind(this);
        window.addEventListener('popstate', this.boundLoadStateFromURL);
        this.invalidate(this.boundLoadStateFromURL);

        this.boundOutsideMenuClick = this.handleOutsideMenuClick.bind(this);
        this.boundMenuKeydown = this.handleMenuKeydown.bind(this);
        this.outsideMenuListenerAttached = false;
        this.menuKeydownListenerAttached = false;
    }

    async withLoader(fn) {
        const webSkel = window.webSkel;
        const hasLoader = Boolean(webSkel?.showLoading) && Boolean(webSkel?.hideLoading);
        const loaderId = hasLoader ? webSkel.showLoading() : null;
        try {
            return await fn();
        } finally {
            if (hasLoader) {
                webSkel.hideLoading(loaderId);
            }
        }
    }

    beforeUnload() {
        window.removeEventListener('popstate', this.boundLoadStateFromURL);
        this.detachPreviewAnchorHandler();
        if (this.outsideMenuListenerAttached) {
            document.removeEventListener('click', this.boundOutsideMenuClick);
            this.outsideMenuListenerAttached = false;
        }
        if (this.menuKeydownListenerAttached) {
            document.removeEventListener('keydown', this.boundMenuKeydown);
            this.menuKeydownListenerAttached = false;
        }
        if (this.boundGlobalKeydown) {
            document.removeEventListener('keydown', this.boundGlobalKeydown);
        }
        if (this.boundOutsideSearchMenuClick) {
            document.removeEventListener('click', this.boundOutsideSearchMenuClick, true);
        }
    }

    async loadStateFromURL() {
        const path = window.location.hash.split('#file-exp')[1] || '/';

        if (path === '/') {
            await this.loadDirectory('/');
            return;
        }

        if (this.state.isEditing) {
            await this.cancelEdit();
        }

        try {
            const contentResult = await window.webSkel.appServices.callTool('explorer', 'read_text_file', {path: path});

            if (contentResult.text.startsWith('Error:')) {
                throw new Error(contentResult.text);
            }

            const parentDir = this.parentPath(path) || '/';
            this.state.path = parentDir;
            const entries = await this.loadDirectoryContent(parentDir);
            await this.setEntries(entries);
            this.state.selectedPath = path;
            this.state.isEditing = false;
            await this.openFile(path);
        } catch (e) {
            // If it fails, it's a directory
            await this.loadDirectory(path);
        }
    }

    beforeRender() {
        this.entriesHTML = buildEntriesHTML(this.state, {
            joinPath: this.joinPath,
            formatBytes: this.formatBytes,
            formatDate: this.formatDate
        });
    }

    async afterRender() {
        this.renderBreadcrumbs();
        if (this.state.selectedPath) {
            const row = this.element.querySelector(`[data-entry-path="${this.state.selectedPath}"]`);
            if (row) {
                row.classList.add('active');
            }
        }

        const editorActions = this.element.querySelector("#editorActions");
        const editingActions = this.element.querySelector("#editingActions");

        if (this.state.isEditing) {
            editorActions.classList.add('hidden');
            editingActions.classList.remove('hidden');
        } else {
            editingActions.classList.add('hidden');
            if (this.state.selectedPath) {
                editorActions.classList.remove('hidden');
            } else {
                editorActions.classList.add('hidden');
            }
        }

        const previewContent = this.element.querySelector('.preview-content');
        if (this.state.isEditing) {
            this.detachPreviewAnchorHandler();
            if (this.state.selectedIsMarkdown && this.state.documentId) {
                previewContent.innerHTML = `<document-view-page data-presenter="document-view-page" data-path="${this.state.selectedPath}" documentId="${this.state.documentId}"></document-view-page>`;
            } else {
                previewContent.innerHTML = `<file-editor data-presenter="file-editor" data-path="${this.state.selectedPath}"></file-editor>`;
            }
        } else if (this.state.selectedIsMarkdown) {
            if (this.state.markdownTextView) {
                previewContent.innerHTML = `<pre id="filePreview" class="markdown-raw-view"></pre>`;
                const filePreview = this.element.querySelector("#filePreview");
                if (this.state.selectedPath) {
                    filePreview.textContent = this.state.fileContent;
                } else {
                    filePreview.textContent = "Select a file to see its contents.";
                }
                this.detachPreviewAnchorHandler();
            } else {
                previewContent.innerHTML = `<div id="filePreview" class="markdown-preview"></div>`;
                const filePreview = this.element.querySelector("#filePreview");
                if (this.state.selectedPath) {
                    filePreview.innerHTML = this.state.previewContent;
                } else {
                    filePreview.textContent = "Select a file to see its contents.";
                }
                this.attachPreviewAnchorHandler();
            }
        } else {
            previewContent.innerHTML = `<div id="filePreview" class="code-preview"></div>`;
            const filePreview = this.element.querySelector("#filePreview");
            if (this.state.selectedPath) {
                filePreview.innerHTML = this.state.previewContent;
            } else {
                filePreview.textContent = "Select a file to see its contents.";
            }
            this.detachPreviewAnchorHandler();
        }

        const toggleListButton = this.element.querySelector('#toggleListButton');
        const listPanel = this.element.querySelector('.list');

        const updateToggleState = () => {
            const collapsed = listPanel.classList.contains('collapsed');
            toggleListButton.setAttribute('aria-expanded', String(!collapsed));
            toggleListButton.setAttribute('title', collapsed ? 'Expand directory panel' : 'Collapse directory panel');
            toggleListButton.setAttribute('aria-label', collapsed ? 'Expand directory panel' : 'Collapse directory panel');
        };

        if (!toggleListButton.dataset.bound) {
            toggleListButton.addEventListener('click', () => {
                listPanel.classList.toggle('collapsed');
                updateToggleState();
            });
            toggleListButton.dataset.bound = 'true';
        }
        updateToggleState();

        const resizer = this.element.querySelector('#resizer');
        let startX = 0;
        let startWidth = 0;

        const handleMouseMove = (e) => {
            if (!this.state.isResizing) return;
            const newWidth = startWidth + (e.clientX - startX);
            if (newWidth > 200) {
                listPanel.style.width = `${newWidth}px`;
            }
        };

        const handleMouseUp = () => {
            this.state.isResizing = false;
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        const handleMouseDown = (e) => {
            e.preventDefault();
            startX = e.clientX;
            startWidth = listPanel.offsetWidth;
            this.state.isResizing = true;
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        };

        if (resizer && !resizer.dataset.bound) {
            resizer.addEventListener('mousedown', handleMouseDown);
            resizer.dataset.bound = 'true';
        }

        const saveButton = this.element.querySelector('#saveButton');
        if (saveButton) {
            if (this.state.selectedIsMarkdown) {
                saveButton.classList.add('hidden');
            } else {
                saveButton.classList.remove('hidden');
            }
        }

        if (this.state.isEditing && !this.state.selectedIsMarkdown) {
            const textarea = this.element.querySelector('.code-input');
            if (textarea) {
                const updateDirtyFlag = () => {
                    this.state.hasUnsavedChanges = textarea.value !== this.state.fileContent;
                };
                if (!textarea.dataset.dirtyBound) {
                    textarea.addEventListener('input', updateDirtyFlag);
                    textarea.dataset.dirtyBound = 'true';
                }
                updateDirtyFlag();
            }
        } else {
            this.state.hasUnsavedChanges = false;
        }

        const cancelButton = this.element.querySelector('#cancelButton');
        if (cancelButton) {
            cancelButton.textContent = this.state.selectedIsMarkdown ? 'Close' : 'Cancel';
        }

        const markdownViewActions = this.element.querySelector('#markdownViewActions');
        const toggleMarkdownViewButton = this.element.querySelector('#toggleMarkdownViewButton');
        if (markdownViewActions && toggleMarkdownViewButton) {
            if (!this.state.isEditing && this.state.selectedIsMarkdown && this.state.selectedPath) {
                markdownViewActions.classList.remove('hidden');
                toggleMarkdownViewButton.textContent = this.state.markdownTextView ? 'View as preview' : 'View as text';
            } else {
                markdownViewActions.classList.add('hidden');
            }
        }

        const fileNameLabel = this.element.querySelector('#editorFileName');
        if (fileNameLabel) {
            const fallbackName = this.state.selectedPath ? this.state.selectedPath.split('/').pop() : '';
            fileNameLabel.textContent = fallbackName;
        }

        const clipboard = this.state.clipboard;
        const clearClipboardButton = this.element.querySelector('#clearClipboardButton');
        if (clearClipboardButton) {
            if (clipboard) {
                clearClipboardButton.removeAttribute('disabled');
            } else {
                clearClipboardButton.setAttribute('disabled', 'true');
            }
        }

        const clipboardGroup = this.element.querySelector('.clipboard-group');
        const clipboardInfo = this.element.querySelector('#clipboardInfo');
        if (clipboardInfo && clipboardGroup) {
            if (clipboard) {
                clipboardInfo.textContent = `${clipboard.mode === 'cut' ? 'Cut' : 'Copy'}: ${clipboard.name}`;
                clipboardInfo.classList.add('visible');
                clipboardGroup.classList.add('visible');
            } else {
                clipboardInfo.textContent = '';
                clipboardInfo.classList.remove('visible');
                clipboardGroup.classList.remove('visible');
            }
        }

        if (clipboard?.path) {
            const clipboardRow = this.element.querySelector(`tr[data-entry-path="${clipboard.path}"]`);
            if (clipboardRow) {
                clipboardRow.classList.add('clipboard-row');
                clipboardRow.classList.toggle('clipboard-cut', clipboard.mode === 'cut');
                clipboardRow.classList.toggle('clipboard-copy', clipboard.mode === 'copy');
            }
        }

        if (this.state.openMenuPath) {
            if (!this.outsideMenuListenerAttached) {
                document.addEventListener('click', this.boundOutsideMenuClick);
                this.outsideMenuListenerAttached = true;
            }
            if (!this.menuKeydownListenerAttached) {
                document.addEventListener('keydown', this.boundMenuKeydown);
                this.menuKeydownListenerAttached = true;
            }
        } else {
            if (this.outsideMenuListenerAttached) {
                document.removeEventListener('click', this.boundOutsideMenuClick);
                this.outsideMenuListenerAttached = false;
            }
            if (this.menuKeydownListenerAttached) {
                document.removeEventListener('keydown', this.boundMenuKeydown);
                this.menuKeydownListenerAttached = false;
            }
        }

        if (this.pendingMenuFocusPath && this.state.openMenuPath === this.pendingMenuFocusPath) {
            const menuContainer = this.element.querySelector(`[data-action-menu="true"][data-entry-path="${this.state.openMenuPath}"]`);
            const firstItem = menuContainer?.querySelector('.action-menu-item');
            if (firstItem) {
                firstItem.focus();
            }
            this.pendingMenuFocusPath = null;
        } else if (!this.state.openMenuPath) {
            this.pendingMenuFocusPath = null;
        }

        const filterToggle = this.element.querySelector('#filterSpecsToggle');
        if (filterToggle) {
            filterToggle.checked = Boolean(this.state.filterSpecs);
        }

        this.setupSearchBindings();
        this.updateSearchUI();
    }

    async loadDirectoryContent(path) {
        try {
            const result = await window.webSkel.appServices.callTool('explorer', 'list_directory_detailed', {path});
            const entries = parseDetailedDirectoryListing(result.text);
            return entries.map(entry => ({
                ...entry,
                path: this.joinPath(path, entry.name)
            }));
        } catch (err) {
            console.error(err);
            this.showStatus(err.message || 'Failed to load directory.', true);
            return [];
        }
    }

    async setEntries(entries) {
        this.state.allEntries = entries || [];
        try {
            if (this.state.filterSpecs) {
                this.state.entries = await this.filterEntriesForSpecs(this.state.allEntries);
            } else {
                this.state.entries = this.state.allEntries;
            }
        } catch (err) {
            console.warn('Failed to apply specs filter', err);
            this.state.entries = this.state.allEntries;
            this.showStatus('Could not apply filter. Showing all files.', true);
        }
    }

    async loadDirectory(path = this.state.path) {
        await this.withLoader(async () => {
            if (this.state.isEditing) {
                await this.cancelEdit();
            }
            this.state.path = this.normalizePath(path);
            this.state.selectedPath = null;
            this.state.fileContent = "";
            this.state.previewContent = "";
            this.state.selectedIsMarkdown = false;
            this.state.markdownTextView = false;
            this.state.documentId = null;
            this.state.isEditing = false;
            this.state.openMenuPath = null;
            this.pendingMenuFocusPath = null;
            const entries = await this.loadDirectoryContent(this.state.path);
            await this.setEntries(entries);
            this.invalidate();
        });
    }

    async selectEntry(element) {
        const path = element.dataset.entryPath;
        const type = element.dataset.type;

        if (this.state.openMenuPath) {
            this.state.openMenuPath = null;
            this.pendingMenuFocusPath = null;
        }

        if (this.state.isEditing && this.state.hasUnsavedChanges) {
            if (!confirm("You have unsaved changes. Are you sure you want to navigate away?")) {
                return;
            }
            await this.cancelEdit();
        } else if (this.state.isEditing) {
            await this.cancelEdit();
        }

        const newUrl = `#file-exp${path}`;
        history.pushState(null, '', newUrl);

        if (type === 'directory') {
            await this.loadDirectory(path);
        } else if (type === 'file') {
            this.state.selectedPath = path;
            await this.openFile(path);
        }
    }

    async openFile(filePath) {
        try {
            const contentResult = await window.webSkel.appServices.callTool('explorer', 'read_text_file', {path: filePath});
            this.state.fileContent = contentResult.text;
            this.state.selectedIsMarkdown = this.isMarkdownFile(filePath);
            this.state.markdownTextView = false;
            this.state.documentId = null;
            this.state.hasUnsavedChanges = false;
            if (this.state.selectedIsMarkdown) {
                const previewSource = this.prepareMarkdownPreviewContent(this.state.fileContent);
                this.state.previewContent = renderMarkdownPreview(previewSource);
                this.state.markdownTextView = false;
                try {
                    const documentModule = window.assistOS?.loadModule?.('document');
                    if (documentModule) {
                        const doc = await documentModule.loadDocument(filePath);
                        this.state.documentId = doc?.id ?? null;
                        if (doc?.id) {
                            window.assistOS.workspace.currentDocumentId = doc.id;
                            window.assistOS.workspace.currentDocumentPath = filePath;
                        }
                    }
                } catch (docError) {
                    console.warn('Failed to load document module for', filePath, docError);
                    this.state.documentId = null;
                }
            } else {
                this.state.previewContent = renderCodePreview(this.state.fileContent, filePath);
                this.state.markdownTextView = false;
            }
            if (this.state.pendingHighlight && this.state.pendingHighlight.path === this.normalizePath(filePath)) {
                const lineNumber = this.state.pendingHighlight.line;
                this.state.pendingHighlight = null;
                setTimeout(() => scrollToLine(this.element, lineNumber), 0);
            } else {
                this.state.pendingHighlight = null;
            }
            this.invalidate();
        } catch (err) {
            console.error(err);
            this.showStatus(err.message || 'Failed to read file.', true);
        }
    }

    async editFile() {
        if (!this.state.selectedPath) return;
        if (this.state.selectedIsMarkdown && !this.state.documentId) {
            try {
                const documentModule = window.assistOS?.loadModule?.('document');
                if (documentModule) {
                    const doc = await documentModule.loadDocument(this.state.selectedPath);
                    this.state.documentId = doc?.id ?? null;
                }
            } catch (error) {
                console.warn('Failed to prepare document editor', error);
            }
        }
        this.state.markdownTextView = false;
        this.state.hasUnsavedChanges = false;
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
            await window.webSkel.appServices.callTool('explorer', 'write_file', {path: this.state.selectedPath, content: newContent});
            this.showStatus(`Successfully saved ${this.state.selectedPath}`, false);
            this.state.fileContent = newContent;
            this.state.hasUnsavedChanges = false;

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
        this.state.hasUnsavedChanges = false;
        this.editorPresenter = null;
        if (this.state.selectedIsMarkdown && this.state.selectedPath) {
            await this.openFile(this.state.selectedPath);
            return;
        }
        this.invalidate();
    }

    renderBreadcrumbs() {
        const breadcrumbsEl = this.element.querySelector('#breadcrumbs');
        breadcrumbsEl.innerHTML = '';
        const rootButton = document.createElement('button');
        rootButton.textContent = '/';
        rootButton.addEventListener('click', () => this.loadDirectory('/'));
        breadcrumbsEl.appendChild(rootButton);

        if (!this.state.path || this.state.path === '/') return;

        const segments = this.state.path.split('/').filter(Boolean);
        let current = '';
        segments.forEach(segment => {
            current += `/${segment}`;
          //  breadcrumbsEl.appendChild(document.createTextNode('/'));
            const btn = document.createElement('button');
            btn.textContent = `${segment} \/`;
            const path = current;
            btn.addEventListener('click', () => this.loadDirectory(path));
            breadcrumbsEl.appendChild(btn);
        });
    }

    showStatus(message, isError = false) {
        const statusBanner = this.element.querySelector('#statusBanner');
        if (!message) {
            statusBanner.classList.remove('visible', 'error');
            statusBanner.textContent = '';
            return;
        }
        statusBanner.textContent = message;
        statusBanner.classList.add('visible');
        statusBanner.classList.toggle('error', Boolean(isError));
        setTimeout(() => this.showStatus(null), 3000);
    }

    async goUp() {
        const parent = this.parentPath(this.state.path);
        if (parent !== null) {
            const newUrl = `#file-exp${parent}`;
            history.pushState(null, '', newUrl);
            await this.loadDirectory(parent);
        }
    }

    async filterEntriesForSpecs(entries = []) {
        const result = [];
        for (const entry of entries) {
            if (!entry) continue;
            if (entry.type === 'file' && this.isMarkdownFile(entry.name)) {
                result.push(entry);
                continue;
            }
            if (entry.type === 'directory') {
                const hasMd = await this.hasMarkdownInTree(entry.path);
                if (hasMd) {
                    result.push(entry);
                }
            }
        }
        return result;
    }

    async hasMarkdownInTree(dirPath) {
        if (!dirPath) return false;
        const stack = [dirPath];
        while (stack.length) {
            const current = stack.pop();
            try {
                const result = await window.webSkel.appServices.callTool('explorer', 'list_directory_detailed', { path: current });
                const listingText = result?.text ?? '';
                if (typeof listingText === 'string' && listingText.startsWith('Error:')) {
                    console.warn('Skipping directory scan due to error response:', listingText);
                    continue;
                }
                const items = parseDetailedDirectoryListing(listingText);
                for (const item of items) {
                    if (!item?.name) continue;
                    if (item.type === 'file' && this.isMarkdownFile(item.name)) {
                        return true;
                    }
                    if (item.type === 'directory') {
                        stack.push(this.joinPath(current, item.name));
                    }
                }
            } catch (err) {
                console.warn('Failed to scan directory for specs', current, err);
                return false;
            }
        }
        return false;
    }

    toggleMarkdownView() {
        if (!this.state.selectedIsMarkdown || this.state.isEditing) {
            return;
        }
        this.state.markdownTextView = !this.state.markdownTextView;
        this.invalidate();
    }

    async toggleFilterSpecs(element) {
        this.state.filterSpecs = Boolean(element?.checked);
        this.saveFilterSpecsPreference(this.state.filterSpecs);
        await this.setEntries(this.state.allEntries?.length ? this.state.allEntries : this.state.entries);
        this.invalidate();
    }

    loadFilterSpecsPreference() {
        try {
            const stored = window.localStorage.getItem('assistosExplorerFilterSpecs');
            return stored === 'true';
        } catch (_) {
            return false;
        }
    }

    saveFilterSpecsPreference(value) {
        try {
            window.localStorage.setItem('assistosExplorerFilterSpecs', value ? 'true' : 'false');
        } catch (_) {
            // ignore
        }
    }

    escapeCssId(value) {
        if (!value) {
            return '';
        }
        if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
            return CSS.escape(value);
        }
        return value.replace(/([ !"#$%&'()*+,./:;<=>?@[\]^`{|}~])/g, '\\$1');
    }

    attachPreviewAnchorHandler() {
        const previewRoot = this.element.querySelector('#filePreview');
        if (!previewRoot) {
            return;
        }
        previewRoot.removeEventListener('click', this.boundPreviewAnchorHandler);
        previewRoot.addEventListener('click', this.boundPreviewAnchorHandler);
    }

    detachPreviewAnchorHandler() {
        const previewRoot = this.element.querySelector('#filePreview');
        if (!previewRoot) {
            return;
        }
        previewRoot.removeEventListener('click', this.boundPreviewAnchorHandler);
    }

    handlePreviewAnchorClick(event) {
        const anchor = event.target?.closest?.('a[href^="#"]');
        if (!anchor) {
            return;
        }
        const href = anchor.getAttribute('href');
        if (!href || href.length <= 1) {
            return;
        }
        const targetId = href.slice(1);
        if (!targetId) {
            return;
        }
        const previewRoot = this.element.querySelector('#filePreview');
        if (!previewRoot) {
            return;
        }
        const selector = this.escapeCssId(targetId);
        const target = selector ? previewRoot.querySelector(`#${selector}`) : null;
        if (!target) {
            return;
        }
        event.preventDefault();
        if (typeof target.scrollIntoView === 'function') {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
            const container = previewRoot.parentElement || previewRoot;
            const offset = target.getBoundingClientRect().top - previewRoot.getBoundingClientRect().top;
            container.scrollTop += offset;
        }
    }


}
