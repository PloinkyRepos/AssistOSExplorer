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
} from "./file-exp-utils.js";
import { attachSearchController } from "./file-exp-search.js";
import { attachFsActions } from "./file-exp-fs-actions.js";
import { withGlobalLoader } from "../../../utils/globalLoader.js";
import { createFileExpCaches } from "./file-exp-caches.js";
import { createDirectoryFilterController } from "./file-exp-directory-filter.js";
import { openFile as openFileImpl, tryLoadMediaPreview as tryLoadMediaPreviewImpl, attachPreviewAnchorHandler as attachPreviewAnchorHandlerImpl, detachPreviewAnchorHandler as detachPreviewAnchorHandlerImpl, handlePreviewAnchorClick as handlePreviewAnchorClickImpl } from "./file-exp-preview.js";
import { filterEntriesForSpecs as filterEntriesForSpecsImpl, hasMarkdownInTree as hasMarkdownInTreeImpl } from "./file-exp-specs.js";
import { positionOpenActionMenu as positionOpenActionMenuImpl } from "./file-exp-action-menu.js";

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
            columnVisibility: this.loadColumnVisibilityPreference(),
            searchMenuOpen: false,
            searchOverlay: null,
            directoryFilterQuery: '',
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
            pendingHighlight: null,
            previewMode: 'none',
            mediaType: null,
            fileLoadInfo: null,
            sortBy: 'name',
            sortDir: 'asc',
            listWidth: null
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
        this.boundContextMenu = this.handleContextMenu.bind(this);

        this.caches = createFileExpCaches();
        this.directoryFilterController = createDirectoryFilterController(this);
    }

    async withLoader(fn) {
        return withGlobalLoader(fn);
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
        const entriesContainer = this.element?.querySelector('.entries');
        if (entriesContainer) {
            entriesContainer.removeEventListener('contextmenu', this.boundContextMenu, true);
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

    renderEntriesBody() {
        this.entriesHTML = buildEntriesHTML(this.state, {
            joinPath: this.joinPath,
            formatBytes: this.formatBytes,
            formatDate: this.formatDate
        });
        const entriesBody = this.element?.querySelector?.('#entriesBody');
        if (entriesBody) {
            entriesBody.innerHTML = this.entriesHTML;
        }
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
        const isTruncatedPreview = Boolean(this.state.fileLoadInfo?.truncated);

        if (this.state.isEditing) {
            editorActions.classList.add('hidden');
            editingActions.classList.remove('hidden');
        } else {
            editingActions.classList.add('hidden');
            if (this.state.selectedPath && this.state.previewMode !== 'media' && !isTruncatedPreview) {
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
        } else if (this.state.previewMode === 'media') {
            this.detachPreviewAnchorHandler();
            const content = this.state.previewContent || '<div class="preview-placeholder">Unable to preview file.</div>';
            previewContent.innerHTML = `<div class="media-preview">${content}</div>`;
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
                    const content = typeof this.state.previewContent === 'string' ? this.state.previewContent : '';
                    filePreview.innerHTML = content;
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
        const previewPanel = this.element.querySelector('.preview');

        const updateToggleState = () => {
            const collapsed = listPanel.classList.contains('collapsed');
            toggleListButton.setAttribute('aria-expanded', String(!collapsed));
            toggleListButton.setAttribute('title', collapsed ? 'Expand directory panel' : 'Collapse directory panel');
            toggleListButton.setAttribute('aria-label', collapsed ? 'Expand directory panel' : 'Collapse directory panel');
        };

        const applySavedWidth = () => {
            if (listPanel && !listPanel.classList.contains('collapsed')) {
                if (!this.state.listWidth && listPanel.offsetWidth) {
                    this.state.listWidth = listPanel.offsetWidth;
                }
                if (this.state.listWidth) {
                    const widthPx = `${this.state.listWidth}px`;
                    listPanel.style.width = widthPx;
                    listPanel.style.flex = '0 0 auto';
                    listPanel.style.flexBasis = widthPx;
                    if (previewPanel) {
                        previewPanel.style.flex = '1 1 auto';
                    }
                }
            }
        };

        applySavedWidth();

        if (listPanel && !listPanel.classList.contains('collapsed')) {
            if (!this.state.listWidth && listPanel.offsetWidth) {
                this.state.listWidth = listPanel.offsetWidth;
            }
            if (this.state.listWidth) {
                listPanel.style.width = `${this.state.listWidth}px`;
            }
        }

	        if (!toggleListButton.dataset.bound) {
	            toggleListButton.addEventListener('click', () => {
	                const isCollapsed = listPanel.classList.contains('collapsed');
	                if (!isCollapsed) {
	                    const currentWidth = Math.round(listPanel.getBoundingClientRect().width || listPanel.offsetWidth);
	                    if (currentWidth > 0) {
	                        this.state.listWidth = currentWidth;
	                    }
	                    listPanel.classList.add('collapsed');
	                    listPanel.style.width = '';
	                    listPanel.style.flex = '';
	                    listPanel.style.flexBasis = '';
	                    if (previewPanel) {
	                        previewPanel.style.flex = '1 1 auto';
	                    }
	                } else {
	                    listPanel.classList.remove('collapsed');
	                    applySavedWidth();
	                }
	                updateToggleState();
	            });
	            toggleListButton.dataset.bound = 'true';
	        }
	        updateToggleState();

        const columnMenuButton = this.element.querySelector('#columnVisibilityButton');
        const columnMenu = this.element.querySelector('#columnVisibilityMenu');
        if (columnMenuButton && columnMenu && !columnMenuButton.dataset.bound) {
            const toggleMenu = () => {
                const isOpen = columnMenu.classList.toggle('open');
                columnMenuButton.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            };
            columnMenuButton.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleMenu();
            });
            document.addEventListener('click', (e) => {
                if (!columnMenu.contains(e.target) && e.target !== columnMenuButton) {
                    columnMenu.classList.remove('open');
                    columnMenuButton.setAttribute('aria-expanded', 'false');
                }
            });
            columnMenuButton.dataset.bound = 'true';
        }

        const columnCheckboxes = this.element.querySelectorAll('#columnVisibilityMenu input[type="checkbox"]');
        if (columnCheckboxes && columnCheckboxes.length) {
            columnCheckboxes.forEach((checkbox) => {
                const column = checkbox.dataset.column;
                if (column && this.state.columnVisibility[column] !== undefined) {
                    checkbox.checked = Boolean(this.state.columnVisibility[column]);
                }
                if (!checkbox.dataset.bound) {
                    checkbox.addEventListener('change', (event) => {
                        const col = event.target.dataset.column;
                        if (!col) return;
                        this.state.columnVisibility[col] = Boolean(event.target.checked);
                        this.saveColumnVisibilityPreference(this.state.columnVisibility);
                        this.applyColumnVisibility();
                    });
                    checkbox.dataset.bound = 'true';
                }
            });
        }

        this.applyColumnVisibility();

        const resizer = this.element.querySelector('#resizer');
        let startX = 0;
        let startWidth = 0;

	        const handleMouseMove = (e) => {
	            if (!this.state.isResizing) return;
	            if (listPanel.classList.contains('collapsed')) return;
	            const delta = e.clientX - startX;
	            const newWidth = Math.max(200, startWidth + delta);
	            const widthPx = `${newWidth}px`;
	            listPanel.style.width = widthPx;
	            listPanel.style.flex = '0 0 auto';
            listPanel.style.flexBasis = widthPx;
            if (previewPanel) {
                previewPanel.style.flex = '1 1 auto';
            }
        };

	        const handleMouseUp = () => {
	            this.state.isResizing = false;
	            if (!listPanel.classList.contains('collapsed')) {
	                const currentWidth = listPanel.offsetWidth;
	                if (currentWidth > 0) {
	                    this.state.listWidth = currentWidth;
	                }
	            }
	            document.removeEventListener('mousemove', handleMouseMove);
	            document.removeEventListener('mouseup', handleMouseUp);
	        };

	        const handleMouseDown = (e) => {
	            e.preventDefault();
	            if (listPanel.classList.contains('collapsed')) return;
	            startX = e.clientX;
	            startWidth = listPanel.getBoundingClientRect().width || this.state.listWidth || listPanel.offsetWidth;
	            this.state.isResizing = true;
	            listPanel.style.flex = '0 0 auto';
            listPanel.style.flexBasis = `${startWidth}px`;
            if (previewPanel) {
                previewPanel.style.flex = '1 1 auto';
            }
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

        const previewNotice = this.element.querySelector('#previewNotice');
        if (previewNotice) {
            if (this.state.fileLoadInfo?.truncated) {
                const info = this.state.fileLoadInfo;
                const previewLines = info.previewLines || LARGE_FILE_PREVIEW_LINES;
                const sizeText = Number.isFinite(info.size) ? this.formatBytes(info.size) : 'large';
                previewNotice.textContent = info.message
                    || `File is ${sizeText}; showing first ${previewLines} lines only. Editing is disabled for this view.`;
                previewNotice.classList.remove('hidden');
            } else {
                previewNotice.textContent = '';
                previewNotice.classList.add('hidden');
            }
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
        const sortButtons = this.element.querySelectorAll('[data-sort-key]');
        sortButtons.forEach((btn) => {
            if (!btn.dataset.sortBound) {
                btn.addEventListener('click', (event) => this.handleSortClick(event));
                btn.dataset.sortBound = 'true';
            }
            const key = btn.dataset.sortKey;
            const isActive = this.state.sortBy === key;
            btn.classList.toggle('active', isActive);
            btn.dataset.direction = isActive ? this.state.sortDir : '';
            btn.setAttribute('aria-sort', isActive ? (this.state.sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
        });
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

        if (this.state.openMenuPath) {
            this.positionOpenActionMenu();
        }

        const filterToggle = this.element.querySelector('#filterSpecsToggle');
        if (filterToggle) {
            filterToggle.checked = Boolean(this.state.filterSpecs);
        }

        this.setupSearchBindings();
        this.updateSearchUI();

        this.directoryFilterController.bindControls();

        const entriesContainer = this.element.querySelector('.entries');
        if (entriesContainer && !entriesContainer.dataset.contextBound) {
            entriesContainer.addEventListener('contextmenu', this.boundContextMenu, true);
            entriesContainer.dataset.contextBound = 'true';
        }
    }

    async loadDirectoryContent(path) {
        try {
            const cached = this.caches.dirListing.get(this, path);
            if (cached) {
                return cached;
            }
            const result = await window.webSkel.appServices.callTool('explorer', 'list_directory_detailed', {path});
            const entries = parseDetailedDirectoryListing(result.text);
            const resolved = entries.map(entry => ({
                ...entry,
                path: this.joinPath(path, entry.name)
            }));
            this.caches.dirListing.set(this, path, resolved);
            return resolved;
        } catch (err) {
            console.error(err);
            this.showStatus(err.message || 'Failed to load directory.', true);
            return [];
        }
    }

    async setEntries(entries) {
        this.state.allEntries = entries || [];
        try {
            const filterQuery = String(this.state.directoryFilterQuery || '').trim().toLowerCase();
            const applyDirectoryFilter = (items) => {
                if (!filterQuery) return items || [];
                return (items || []).filter((entry) => {
                    const name = String(entry?.name || '').toLowerCase();
                    const entryPath = String(entry?.path || '').toLowerCase();
                    return name.includes(filterQuery) || entryPath.includes(filterQuery);
                });
            };

            if (this.state.filterSpecs) {
                const filtered = await this.filterEntriesForSpecs(this.state.allEntries);
                this.state.entries = this.sortEntries(applyDirectoryFilter(filtered));
            } else {
                this.state.entries = this.sortEntries(applyDirectoryFilter(this.state.allEntries));
            }
        } catch (err) {
            console.warn('Failed to apply specs filter', err);
            this.state.entries = this.sortEntries(this.state.allEntries);
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
        await this.withLoader(async () => {
            if (this.state.isEditing) {
                await this.cancelEdit();
            }
            this.state.path = this.normalizePath(path);
            this.state.selectedPath = null;
            this.state.fileContent = "";
            this.state.previewContent = "";
            this.state.selectedIsMarkdown = false;
            this.state.previewMode = 'none';
            this.state.mediaType = null;
            this.state.fileLoadInfo = null;
            this.state.markdownTextView = false;
            this.state.documentId = null;
            this.state.isEditing = false;
            this.state.openMenuPath = null;
            this.pendingMenuFocusPath = null;
            const entries = await this.loadDirectoryContent(this.state.path);
            await this.setEntries(entries);
            this.invalidate();
        });

        if (String(this.state.directoryFilterQuery || '').trim().length >= 2) {
            await this.directoryFilterController.rerunIfActive();
        }
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
        } else {
            if (typeof this.navigateToPath === 'function') {
                await this.navigateToPath(path);
                return;
            }
            await this.withLoader(async () => {
                try {
                    await window.webSkel.appServices.callTool('explorer', 'read_text_file', { path });
                    const parentDir = this.parentPath(path) || '/';
                    this.state.path = parentDir;
                    const entries = await this.loadDirectoryContent(parentDir);
                    await this.setEntries(entries);
                    this.state.selectedPath = path;
                    await this.openFile(path);
                } catch (_) {
                    await this.loadDirectory(path);
                }
            });
        }
    }

    async tryLoadMediaPreview(filePath) {
        return tryLoadMediaPreviewImpl(this, filePath);
    }

    async openFile(filePath) {
        return openFileImpl(this, filePath, {
            largeFilePreviewLimitBytes: LARGE_FILE_PREVIEW_LIMIT_BYTES,
            largeFilePreviewLines: LARGE_FILE_PREVIEW_LINES
        });
    }

    async editFile() {
        if (!this.state.selectedPath) return;
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
        rootButton.addEventListener('click', () => {
            history.pushState(null, '', '#file-exp/');
            this.loadDirectory('/');
        });
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
            btn.addEventListener('click', () => {
                history.pushState(null, '', `#file-exp${path}`);
                this.loadDirectory(path);
            });
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
        return filterEntriesForSpecsImpl(this, entries);
    }

    async hasMarkdownInTree(dirPath) {
        return hasMarkdownInTreeImpl(this, dirPath);
    }

    toggleMarkdownView() {
        if (!this.state.selectedIsMarkdown || this.state.isEditing) {
            return;
        }
        this.state.markdownTextView = !this.state.markdownTextView;
        this.invalidate();
    }

    async toggleFilterSpecs(element) {
        await this.withLoader(async () => {
            this.state.filterSpecs = Boolean(element?.checked);
            this.saveFilterSpecsPreference(this.state.filterSpecs);
            await this.setEntries(this.state.allEntries?.length ? this.state.allEntries : this.state.entries);
            this.invalidate();
        });
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

    loadColumnVisibilityPreference() {
        const defaults = { type: false, size: false, modified: false };
        try {
            const raw = window.localStorage.getItem('assistosExplorerColumnVisibility');
            if (!raw) return defaults;
            const parsed = JSON.parse(raw);
            return {
                type: parsed.type !== false,
                size: parsed.size !== false,
                modified: parsed.modified !== false
            };
        } catch (_) {
            return defaults;
        }
    }

    saveColumnVisibilityPreference(value) {
        try {
            const payload = {
                type: Boolean(value?.type),
                size: Boolean(value?.size),
                modified: Boolean(value?.modified)
            };
            window.localStorage.setItem('assistosExplorerColumnVisibility', JSON.stringify(payload));
        } catch (_) {
            // ignore
        }
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
        const key = event.currentTarget?.dataset?.sortKey;
        if (!key) return;
        const nextDir = this.state.sortBy === key && this.state.sortDir === 'asc' ? 'desc' : 'asc';
        this.state.sortBy = key;
        this.state.sortDir = nextDir;
        this.state.entries = this.sortEntries(this.state.entries);
        this.invalidate();
    }

}
