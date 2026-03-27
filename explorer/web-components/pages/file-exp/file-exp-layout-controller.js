import { saveColumnVisibilityPreference } from "./file-exp-state.js";
import { renderApplicationPluginSlots } from "./file-exp-application-plugins.js";
import { getPreviewUiState as derivePreviewUiState } from "./file-exp-preview-state.js";
import { scrollToLine } from "./file-exp-utils.js";
import { getDpuPathCapabilities, isDpuManagedPath } from "./file-exp-dpu-provider.js";

export async function runAfterRender(fileExp, options = {}) {
    const previewLinesFallback = Number.isFinite(options.previewLines) ? options.previewLines : 400;

    fileExp.renderBreadcrumbs();
    fileExp.renderEntries();

    const previewUiState = derivePreviewUiState(fileExp.state);
    fileExp.previewHeaderController.sync(previewUiState);

    const previewPresenterElement = fileExp.element.querySelector('file-exp-preview');
    const previewPresenter = previewPresenterElement?.webSkelPresenter || null;
    if (previewPresenter && typeof previewPresenter.renderPreview === 'function') {
        previewPresenter.renderPreview(previewUiState);
    } else {
        const previewContent = fileExp.element.querySelector('.preview-content');
        fileExp.renderPreviewPanel(previewContent, previewUiState);
    }

    const pendingHighlight = fileExp.state.pendingHighlight;
    if (pendingHighlight && pendingHighlight.path === fileExp.normalizePath(fileExp.state.selectedPath || '')) {
        const didScroll = scrollToLine(fileExp.element, pendingHighlight.line);
        if (didScroll) {
            fileExp.setPendingHighlight(null);
            if (fileExp.pendingHighlightRetryTimer) {
                window.clearTimeout(fileExp.pendingHighlightRetryTimer);
                fileExp.pendingHighlightRetryTimer = null;
            }
        } else if (Number.isFinite(pendingHighlight.line) && pendingHighlight.line > 0) {
            if (fileExp.pendingHighlightRetryTimer) {
                window.clearTimeout(fileExp.pendingHighlightRetryTimer);
            }
            fileExp.pendingHighlightRetryTimer = window.setTimeout(() => {
                const current = fileExp.state.pendingHighlight;
                if (!current) return;
                if (current.path !== fileExp.normalizePath(fileExp.state.selectedPath || '')) return;
                const retried = scrollToLine(fileExp.element, current.line);
                if (retried) {
                    fileExp.setPendingHighlight(null);
                }
            }, 80);
        }
    } else if (fileExp.pendingHighlightRetryTimer) {
        window.clearTimeout(fileExp.pendingHighlightRetryTimer);
        fileExp.pendingHighlightRetryTimer = null;
    }

    const toggleListButton = fileExp.element.querySelector('#toggleListButton');
    const workspace = fileExp.element.querySelector('.workspace');
    const listPanel = fileExp.element.querySelector('.list');
    const columnMenuButton = fileExp.element.querySelector('#columnVisibilityButton');
    const columnMenu = fileExp.element.querySelector('#columnVisibilityMenu');
    const toolbarMenuButton = fileExp.element.querySelector('#toolbarMenuButton');
    const toolbarMenu = fileExp.element.querySelector('#toolbarMenu');
    const uploadButton = fileExp.element.querySelector('#uploadButton');
    const accountMenuButton = fileExp.element.querySelector('#accountMenuButton');
    const accountMenu = fileExp.element.querySelector('#accountMenu');
    const fileUploadInput = fileExp.element.querySelector('#fileUploadInput');
    const managedByDpu = isDpuManagedPath(fileExp.state.path || '/');
    const dpuCapabilities = managedByDpu
        ? await getDpuPathCapabilities(fileExp, fileExp.state.path || '/')
        : null;
    const allowManagedUploads = Boolean(dpuCapabilities?.canUpload);
    const allowManagedCreate = Boolean(dpuCapabilities?.canCreateFiles || dpuCapabilities?.canCreateDirectories);

    if (uploadButton) {
        uploadButton.disabled = managedByDpu ? !allowManagedUploads : false;
        uploadButton.title = managedByDpu
            ? (allowManagedUploads
                ? 'Upload files to this Confidential folder'
                : 'Uploads are not allowed in this Confidential location.')
            : 'Upload files';
    }
    if (toolbarMenuButton) {
        toolbarMenuButton.disabled = managedByDpu ? !allowManagedCreate : false;
        toolbarMenuButton.title = managedByDpu
            ? (allowManagedCreate
                ? 'Create items in this Confidential folder'
                : 'Create actions are not allowed in this Confidential location.')
            : 'More actions';
    }

    const updateToggleState = () => {
        if (!toggleListButton || !listPanel) return;
        const collapsed = listPanel.classList.contains('collapsed');
        toggleListButton.setAttribute('aria-expanded', String(!collapsed));
        toggleListButton.setAttribute('title', collapsed ? 'Expand directory panel' : 'Collapse directory panel');
        toggleListButton.setAttribute('aria-label', collapsed ? 'Expand directory panel' : 'Collapse directory panel');
    };

    const setWorkspaceListWidth = (width) => {
        if (!workspace || !Number.isFinite(width) || width <= 0) return;
        workspace.style.setProperty('--file-exp-list-width', `${Math.max(200, Math.round(width))}px`);
    };

    const applyCollapsedState = () => {
        if (!listPanel) return;
        listPanel.classList.toggle('collapsed', Boolean(fileExp.state.listCollapsed));
    };

    const syncCollapsedState = () => {
        if (!workspace || !listPanel) return;
        workspace.classList.toggle('list-collapsed', listPanel.classList.contains('collapsed'));
    };

    const applySavedWidth = () => {
        if (!listPanel || listPanel.classList.contains('collapsed')) return;
        if (!fileExp.state.listWidth && listPanel.offsetWidth) {
            fileExp.setListWidth(listPanel.offsetWidth);
        }
        if (fileExp.state.listWidth) {
            setWorkspaceListWidth(fileExp.state.listWidth);
        }
    };

    applyCollapsedState();
    applySavedWidth();
    if (listPanel && !listPanel.classList.contains('collapsed')) {
        if (!fileExp.state.listWidth && listPanel.offsetWidth) {
            fileExp.setListWidth(listPanel.offsetWidth);
            setWorkspaceListWidth(listPanel.offsetWidth);
        }
    }
    syncCollapsedState();

    if (toggleListButton && listPanel) {
        const onToggleListClick = () => {
            const isCollapsed = listPanel.classList.contains('collapsed');
            if (!isCollapsed) {
                const currentWidth = Math.round(listPanel.getBoundingClientRect().width || listPanel.offsetWidth);
                if (currentWidth > 0) {
                    fileExp.setListWidth(currentWidth);
                }
                fileExp.setListCollapsed(true);
                applyCollapsedState();
            } else {
                fileExp.setListCollapsed(false);
                applyCollapsedState();
                applySavedWidth();
            }
            syncCollapsedState();
            updateToggleState();
        };
        fileExp.setElementListener('toggle-list-button', toggleListButton, 'click', onToggleListClick);
        updateToggleState();
    }

    if (columnMenuButton && columnMenu) {
        const toggleMenu = () => {
            const isOpen = columnMenu.classList.toggle('open');
            columnMenuButton.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        };
        const onColumnButtonClick = (event) => {
            event.stopPropagation();
            toggleMenu();
        };
        const onColumnDocumentClick = (event) => {
            if (!columnMenu.contains(event.target) && event.target !== columnMenuButton) {
                columnMenu.classList.remove('open');
                columnMenuButton.setAttribute('aria-expanded', 'false');
            }
        };
        fileExp.setElementListener('column-menu-button', columnMenuButton, 'click', onColumnButtonClick);
        fileExp.setDocumentListener('column-menu-outside', 'click', onColumnDocumentClick);
    } else {
        fileExp.removeDocumentListener('column-menu-outside');
    }

    if (toolbarMenuButton && toolbarMenu) {
        const setToolbarMenuOpen = (open) => {
            fileExp.setToolbarMenuOpen(open);
            toolbarMenu.classList.toggle('open', open);
            toolbarMenuButton.setAttribute('aria-expanded', open ? 'true' : 'false');
        };
        const onToolbarButtonClick = (event) => {
            event.stopPropagation();
            setToolbarMenuOpen(!fileExp.state.toolbarMenuOpen);
        };
        const onToolbarMenuClick = (event) => {
            const item = event.target.closest('[role="menuitem"]');
            if (item) {
                setToolbarMenuOpen(false);
            }
        };
        const onToolbarOutsideClick = (event) => {
            if (!toolbarMenu.contains(event.target) && event.target !== toolbarMenuButton) {
                setToolbarMenuOpen(false);
            }
        };
        fileExp.setElementListener('toolbar-menu-button', toolbarMenuButton, 'click', onToolbarButtonClick);
        fileExp.setElementListener('toolbar-menu-container', toolbarMenu, 'click', onToolbarMenuClick);
        fileExp.setDocumentListener('toolbar-menu-outside', 'click', onToolbarOutsideClick);
        toolbarMenu.classList.toggle('open', Boolean(fileExp.state.toolbarMenuOpen));
        toolbarMenuButton.setAttribute('aria-expanded', fileExp.state.toolbarMenuOpen ? 'true' : 'false');
    } else {
        fileExp.removeDocumentListener('toolbar-menu-outside');
    }

    if (accountMenuButton && accountMenu) {
        const setAccountMenuOpen = (open) => {
            accountMenu.classList.toggle('open', open);
            accountMenuButton.setAttribute('aria-expanded', open ? 'true' : 'false');
        };
        const onAccountButtonClick = (event) => {
            event.stopPropagation();
            const willOpen = !accountMenu.classList.contains('open');
            setAccountMenuOpen(willOpen);
        };
        const onAccountMenuClick = (event) => {
            const item = event.target.closest('[role="menuitem"]');
            if (item) {
                setAccountMenuOpen(false);
            }
        };
        const onAccountOutsideClick = (event) => {
            if (!accountMenu.contains(event.target) && event.target !== accountMenuButton) {
                setAccountMenuOpen(false);
            }
        };
        fileExp.setElementListener('account-menu-button', accountMenuButton, 'click', onAccountButtonClick);
        fileExp.setElementListener('account-menu-container', accountMenu, 'click', onAccountMenuClick);
        fileExp.setDocumentListener('account-menu-outside', 'click', onAccountOutsideClick);
        accountMenuButton.setAttribute('aria-expanded', accountMenu.classList.contains('open') ? 'true' : 'false');
    } else {
        fileExp.removeDocumentListener('account-menu-outside');
    }

    if (fileUploadInput) {
        fileExp.setElementListener('file-upload-input', fileUploadInput, 'change', (event) => {
            fileExp.handleUploadSelection?.(event);
        });
    }

    const columnCheckboxes = fileExp.element.querySelectorAll('#columnVisibilityMenu input[type="checkbox"]');
    columnCheckboxes.forEach((checkbox) => {
        const column = checkbox.dataset.column;
        if (column) {
            checkbox.checked = Boolean(fileExp.state.columnVisibility?.[column]);
        }
        if (!column) return;
        const onColumnVisibilityChange = (event) => {
            const col = event.target.dataset.column;
            if (!col) return;
            fileExp.setColumnVisibility(col, Boolean(event.target.checked));
            saveColumnVisibilityPreference(fileExp.state.columnVisibility);
            fileExp.applyColumnVisibility();
        };
        fileExp.setElementListener(`column-visibility-${column}`, checkbox, 'change', onColumnVisibilityChange);
    });
    fileExp.applyColumnVisibility();

    const resizer = fileExp.element.querySelector('#resizer');
    if (resizer && listPanel) {
        const onResizerMouseDown = (event) => {
            event.preventDefault();
            if (listPanel.classList.contains('collapsed')) return;

            const startX = event.clientX;
            const startWidth = listPanel.getBoundingClientRect().width || fileExp.state.listWidth || listPanel.offsetWidth;
            fileExp.setIsResizing(true);
            workspace?.classList.add('resizing');
            setWorkspaceListWidth(startWidth);

            const onMouseMove = (moveEvent) => {
                if (!fileExp.state.isResizing) return;
                if (listPanel.classList.contains('collapsed')) return;
                const delta = moveEvent.clientX - startX;
                const newWidth = Math.max(200, startWidth + delta);
                setWorkspaceListWidth(newWidth);
            };

            let stopMove = () => {};
            let stopUp = () => {};
            const onMouseUp = () => {
                fileExp.setIsResizing(false);
                workspace?.classList.remove('resizing');
                if (!listPanel.classList.contains('collapsed')) {
                    const currentWidth = listPanel.offsetWidth;
                    if (currentWidth > 0) {
                        fileExp.setListWidth(currentWidth);
                        setWorkspaceListWidth(currentWidth);
                    }
                }
                stopMove();
                stopUp();
            };

            stopMove = fileExp.addDocumentListener('mousemove', onMouseMove);
            stopUp = fileExp.addDocumentListener('mouseup', onMouseUp);
        };
        fileExp.setElementListener('list-resizer', resizer, 'mousedown', onResizerMouseDown);
    }

    const saveButton = fileExp.element.querySelector('#saveButton');
    if (saveButton) {
        saveButton.classList.toggle('hidden', Boolean(fileExp.state.selectedIsMarkdown));
    }

    if (fileExp.state.isEditing && !fileExp.state.selectedIsMarkdown) {
        const textarea = fileExp.element.querySelector('.code-input');
        if (textarea) {
            const updateDirtyFlag = () => {
                fileExp.setHasUnsavedChanges(textarea.value !== fileExp.state.fileContent);
            };
            fileExp.setElementListener('editor-dirty-input', textarea, 'input', updateDirtyFlag);
            updateDirtyFlag();
        }
    } else {
        fileExp.setHasUnsavedChanges(false);
        fileExp.removeElementListener('editor-dirty-input');
    }

    const cancelButton = fileExp.element.querySelector('#cancelButton');
    if (cancelButton) {
        cancelButton.textContent = fileExp.state.selectedIsMarkdown ? 'Close' : 'Cancel';
    }

    const previewNotice = fileExp.element.querySelector('#previewNotice');
    if (previewNotice) {
        if (fileExp.state.fileLoadInfo?.truncated) {
            const info = fileExp.state.fileLoadInfo;
            const previewLines = info.previewLines || previewLinesFallback;
            const sizeText = Number.isFinite(info.size) ? fileExp.formatBytes(info.size) : 'large';
            previewNotice.textContent = info.message
                || `File is ${sizeText}; showing first ${previewLines} lines only. Editing is disabled for this view.`;
            previewNotice.classList.remove('hidden');
        } else {
            previewNotice.textContent = '';
            previewNotice.classList.add('hidden');
        }
    }

    const clipboard = fileExp.state.clipboard;
    const clearClipboardButton = fileExp.element.querySelector('#clearClipboardButton');
    if (clearClipboardButton) {
        if (clipboard) {
            clearClipboardButton.removeAttribute('disabled');
        } else {
            clearClipboardButton.setAttribute('disabled', 'true');
        }
    }

    const sortButtons = fileExp.element.querySelectorAll('[data-sort-key]');
    sortButtons.forEach((btn) => {
        const sortKey = btn.dataset.sortKey;
        if (!sortKey) return;
        fileExp.setElementListener(`sort-${sortKey}`, btn, 'click', fileExp.boundSortClickHandler);
        const isActive = fileExp.state.sortBy === sortKey;
        btn.classList.toggle('active', isActive);
        btn.dataset.direction = isActive ? fileExp.state.sortDir : '';
        btn.setAttribute('aria-sort', isActive ? (fileExp.state.sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
    });

    if (fileExp.state.openMenuPath) {
        fileExp.setDocumentListener('open-menu-outside', 'click', fileExp.boundOutsideMenuClick);
        fileExp.setDocumentListener('open-menu-keydown', 'keydown', fileExp.boundMenuKeydown);
    } else {
        fileExp.removeDocumentListener('open-menu-outside');
        fileExp.removeDocumentListener('open-menu-keydown');
    }

    if (fileExp.pendingMenuFocusPath && fileExp.state.openMenuPath === fileExp.pendingMenuFocusPath) {
        const menuContainer = fileExp.element.querySelector(`[data-action-menu="true"][data-entry-path="${fileExp.state.openMenuPath}"]`);
        const firstItem = menuContainer?.querySelector('.action-menu-item');
        if (firstItem) {
            firstItem.focus();
        }
        fileExp.pendingMenuFocusPath = null;
    } else if (!fileExp.state.openMenuPath) {
        fileExp.pendingMenuFocusPath = null;
    }

    if (fileExp.state.openMenuPath) {
        fileExp.positionOpenActionMenu();
    }

    const filterToggle = fileExp.element.querySelector('#filterSpecsToggle');
    if (filterToggle) {
        filterToggle.checked = Boolean(fileExp.state.filterSpecs);
    }

    fileExp.setupSearchBindings();
    fileExp.updateSearchUI();
    fileExp.directoryFilterController.bindControls();

    const entriesContainer = fileExp.element.querySelector('.entries')
        || fileExp.element.querySelector('file-exp-entries');
    if (entriesContainer) {
        fileExp.setElementListener('entries-contextmenu', entriesContainer, 'contextmenu', fileExp.boundContextMenu, true);
    }

    await renderApplicationPluginSlots(fileExp);
}
