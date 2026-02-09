// File system related UI actions for FileExp, attached to the presenter to keep it lean.
import { showContextPasteMenu } from "./file-exp-utils.js";
import { callToolWithLoader } from "../../../utils/globalLoader.js";

export function attachFsActions(fileExp) {
    Object.assign(fileExp, {
        async deleteEntry(element) {
            const path = element.dataset.entryPath;
            const type = element.dataset.type;
            this.closeActionMenu();
            if (!confirm(`Are you sure you want to delete ${path}?`)) return;
            try {
                await this.withLoader(async () => {
                    const tool = type === 'directory' ? 'delete_directory' : 'delete_file';
                    await callToolWithLoader('explorer', tool, {path});
                    this.showStatus(`Successfully deleted ${path}`);
                    if (this.state.selectedPath === path) {
                        this.state.selectedPath = null;
                        this.state.fileContent = "";
                    }
                    if (this.state.clipboard?.path === path) {
                        this.state.clipboard = null;
                    }
                    await this.loadDirectory(this.state.path);
                });
            } catch (err) {
                console.error(err);
                this.showStatus(err.message || 'Failed to delete.', true);
            }
        },

        async renameEntry(element) {
            const source = element?.dataset?.entryPath;
            if (!source) return;
            this.closeActionMenu();
            const itemType = element.dataset.type;
            const currentName = source.split('/').pop();
            const input = prompt(`Enter a new name for "${currentName}":`, currentName);
            if (input === null) return;
            const newName = this.sanitizeEntryName(input);
            if (!newName) {
                this.showStatus('Please enter a valid name.', true);
                return;
            }
            if (newName === currentName) return;
            const parent = this.parentPath(source) || '/';
            const destination = this.joinPath(parent, newName);
            if (destination === source) return;
            try {
                await this.withLoader(async () => {
                    await callToolWithLoader('explorer', 'move_file', {source, destination});
                    const wasSelected = this.state.selectedPath === source;
                    if (this.state.clipboard?.path === source) {
                        this.state.clipboard = {...this.state.clipboard, path: destination, name: newName};
                    }
                    const entries = await this.loadDirectoryContent(this.state.path);
                    await this.setEntries(entries);
                    this.showStatus(`Renamed "${currentName}" to "${newName}".`);
                    if (wasSelected) {
                        this.state.selectedPath = destination;
                        history.replaceState(null, '', `#file-exp${destination}`);
                        if (itemType === 'file') {
                            await this.openFile(destination);
                            return;
                        }
                    }
                    this.invalidate();
                });
            } catch (err) {
                console.error(err);
                this.showStatus(err.message || 'Failed to rename entry.', true);
            }
        },

        copyEntry(element) {
            const path = element?.dataset?.entryPath;
            if (!path) return;
            this.closeActionMenu(false);
            const name = path.split('/').pop();
            this.state.clipboard = {mode: 'copy', path, name, type: element.dataset.type};
            this.showStatus(`Copied "${name}" to clipboard.`);
            this.updateClipboardUI();
        },

        cutEntry(element) {
            const path = element?.dataset?.entryPath;
            if (!path) return;
            this.closeActionMenu(false);
            const name = path.split('/').pop();
            this.state.clipboard = {mode: 'cut', path, name, type: element.dataset.type};
            this.showStatus(`Ready to move "${name}".`);
            this.updateClipboardUI();
        },

        pasteHere() {
            return this.pasteClipboard({dataset: {targetPath: this.state.path}});
        },

        toggleActionMenu(element, maybeEvent) {
            if (maybeEvent?.stopPropagation) maybeEvent.stopPropagation();
            if (maybeEvent?.preventDefault) maybeEvent.preventDefault();
            const path = element?.dataset?.entryPath;
            if (!path) return;
            const previous = this.state.openMenuPath;
            const next = previous === path ? null : path;
            if (!next) {
                this.closeActionMenu(false);
                return;
            }
            this.openActionMenu(next);
        },

        handleOutsideMenuClick(event) {
            if (!this.state.openMenuPath) return;
            const target = event?.target;
            if (target && this.element.contains(target)) {
                const menu = target.closest('[data-action-menu="true"]');
                if (menu && menu.dataset.entryPath === this.state.openMenuPath) return;
            }
            this.closeActionMenu();
        },

        handleMenuKeydown(event) {
            if (event?.key === 'Escape' && this.state.openMenuPath) {
                this.closeActionMenu();
            }
        },

        handleContextMenu(event) {
            const row = event.target?.closest?.('tr[data-entry-path]');
            if (row) {
                event.preventDefault();
                event.stopPropagation();
                const path = row.dataset.entryPath;
                const type = row.dataset.type;
                if (!path || this.state.isEditing) {
                    return;
                }
                this.state.selectedPath = path;
                this.state.selectedIsMarkdown = this.isMarkdownFile(path) && type === 'file';
                this.closeActionMenu(false);
                this.state.openMenuPath = path;
                this.pendingMenuFocusPath = path;
                this.invalidate();
                return;
            }
            if (this.state.clipboard) {
                event.preventDefault();
                event.stopPropagation();
                showContextPasteMenu({
                    x: event.clientX,
                    y: event.clientY,
                    targetPath: this.state.path,
                    hostElement: this.element
                });
            }
        },

        closeActionMenu(shouldInvalidate = true) {
            if (!this.state.openMenuPath) return false;
            const openPath = this.state.openMenuPath;
            const container = this.element?.querySelector(`[data-action-menu="true"][data-entry-path="${openPath}"]`);
            container?.classList.remove('open');
            const trigger = container?.querySelector('.action-menu-trigger');
            trigger?.setAttribute('aria-expanded', 'false');
            const dropdown = container?.querySelector('.action-menu-dropdown');
            if (dropdown) {
                dropdown.removeAttribute('data-positioned');
                dropdown.classList.remove('drop-up');
                dropdown.style.left = '';
                dropdown.style.top = '';
                dropdown.style.right = '';
                dropdown.style.bottom = '';
            }
            this.pendingMenuFocusPath = null;
            this.state.openMenuPath = null;
            if (shouldInvalidate) this.invalidate();
            return true;
        },

        openActionMenu(path) {
            if (this.state.openMenuPath && this.state.openMenuPath !== path) {
                this.closeActionMenu(false);
            }
            this.state.openMenuPath = path;
            const container = this.element?.querySelector(`[data-action-menu="true"][data-entry-path="${path}"]`);
            if (!container) return;
            container.classList.add('open');
            const trigger = container.querySelector('.action-menu-trigger');
            trigger?.setAttribute('aria-expanded', 'true');
            this.positionOpenActionMenu?.();
            const firstItem = container.querySelector('.action-menu-item');
            if (firstItem) {
                firstItem.focus({ preventScroll: true });
            }
        },

        updateClipboardUI() {
            // Update toolbar clipboard info and paste button
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

            // Update row highlight for clipboard source without re-rendering
            const previousRow = this.element.querySelector('tr.clipboard-row');
            previousRow?.classList.remove('clipboard-row', 'clipboard-cut', 'clipboard-copy');

            if (clipboard?.path) {
                const row = this.element.querySelector(`tr[data-entry-path="${clipboard.path}"]`);
                if (row) {
                    row.classList.add('clipboard-row');
                    row.classList.toggle('clipboard-cut', clipboard.mode === 'cut');
                    row.classList.toggle('clipboard-copy', clipboard.mode === 'copy');
                }
            }
        },

        clearClipboard() {
            if (!this.state.clipboard) return;
            const previous = this.state.clipboard.name;
            this.state.clipboard = null;
            this.showStatus(previous ? `Cleared clipboard (was "${previous}").` : 'Clipboard cleared.');
            this.updateClipboardUI();
            // Remove any clipboard marker when clearing
            const previousRow = this.element.querySelector('tr.clipboard-row');
            previousRow?.classList.remove('clipboard-row', 'clipboard-cut', 'clipboard-copy');
        },

        humanizeFsError(error) {
            const message = error?.message || error?.toString?.() || '';
            if (typeof message === 'string') {
                if (message.includes('Request timed out')) {
                    return 'Operation timed out. Please try again.';
                }
                if (message.includes('Missing or invalid MCP session')) {
                    return 'Session expired. Reload the app and try again.';
                }
                if (message.includes('Path is outside allowed roots')) {
                    return 'Operation blocked: path is outside the workspace.';
                }
            }
            return message || 'Operation failed. Please try again.';
        },

        async pasteClipboard(element) {
            const clipboard = this.state.clipboard;
            if (!clipboard) {
                this.showStatus('Clipboard is empty.', true);
                return;
            }
            const targetPathRaw = element?.dataset?.targetPath || this.state.path;
            const targetDir = this.normalizePath(targetPathRaw);
            const targetIsCurrentDirectory = targetDir === this.state.path;
            const sourceParent = this.parentPath(clipboard.path) || '/';
            this.closeActionMenu(false);

            let targetEntries = [];
            if (targetIsCurrentDirectory) {
                targetEntries = this.state.entries;
            } else {
                targetEntries = await this.loadDirectoryContent(targetDir);
            }
            const existingNames = new Set(targetEntries.map((entry) => entry.name));

            const defaultName = clipboard.mode === 'copy'
                ? this.generateCopyName(clipboard.name, existingNames)
                : clipboard.name;
            const promptLabel = clipboard.mode === 'copy'
                ? `Enter a name for the copied ${clipboard.type === 'directory' ? 'folder' : 'file'}:`
                : `Enter a name for the moved ${clipboard.type === 'directory' ? 'folder' : 'file'}:`;
            const input = prompt(promptLabel, defaultName);
            if (input === null) return;
            let desiredName = this.sanitizeEntryName(input);
            if (!desiredName) {
                this.showStatus('Please enter a valid name.', true);
                return;
            }

            let existsInTarget = existingNames.has(desiredName);
            if (clipboard.mode === 'cut' && existsInTarget) {
                const fallbackName = this.generateCopyName(desiredName, existingNames);
                desiredName = fallbackName;
                existsInTarget = existingNames.has(desiredName);
                this.showStatus(`"${input}" already exists. Moving as "${desiredName}".`);
            }

            const destination = this.joinPath(targetDir, desiredName);
            const wasSelectedFile = this.state.selectedPath === clipboard.path && clipboard.type === 'file';
            const normalizedSource = this.normalizePath(clipboard.path);
            const normalizedDestination = this.normalizePath(destination);

            if (normalizedDestination === normalizedSource) {
                this.showStatus('Destination matches the source.', true);
                return;
            }
            if (clipboard.type === 'directory' && normalizedDestination.startsWith(`${normalizedSource}/`)) {
                this.showStatus('Cannot paste a folder into itself or one of its subfolders.', true);
                return;
            }
            let pasteCompleted = false;
            try {
                await this.withLoader(async () => {
                    if (clipboard.mode === 'cut') {
                        await callToolWithLoader('explorer', 'move_file', {
                            source: clipboard.path,
                            destination
                        });
                        this.showStatus(`Moved to ${destination}.`);
                    } else {
                        let overwrite = false;
                        if (existsInTarget) {
                            const shouldOverwrite = confirm(`"${desiredName}" already exists here. Overwrite it?`);
                            if (!shouldOverwrite) return;
                            overwrite = true;
                        }
                        await callToolWithLoader('explorer', 'copy_file', {
                            source: clipboard.path,
                            destination,
                            overwrite
                        });
                        this.showStatus(`Copied to ${destination}${overwrite ? ' (overwritten)' : ''}.`);
                    }

                    this.caches?.dirListing?.invalidate?.(this, targetDir);
                    if (sourceParent) {
                        this.caches?.dirListing?.invalidate?.(this, sourceParent);
                    }
                    const targetMatchesCurrentView = targetIsCurrentDirectory;
                    const sourceMatchesCurrentView = sourceParent === this.state.path;

                    if (targetMatchesCurrentView || sourceMatchesCurrentView) {
                        const entries = await this.loadDirectoryContent(this.state.path);
                        await this.setEntries(entries);
                    }

                    if (wasSelectedFile) {
                        this.state.selectedPath = destination;
                        const historyMethod = clipboard.mode === 'cut' ? 'replaceState' : 'pushState';
                        history[historyMethod](null, '', `#file-exp${destination}`);
                        await this.openFile(destination);
                        pasteCompleted = true;
                        return;
                    }

                    pasteCompleted = true;
                    this.invalidate();
                });
            } catch (err) {
                console.error(err);
                this.showStatus(this.humanizeFsError(err), true);
            }
            if (pasteCompleted && clipboard.mode === 'cut') {
                this.state.clipboard = null;
            }
            this.invalidate();
        },

        async newFile() {
            const fileName = prompt('Enter name for the new file:');
            if (!fileName || !fileName.trim()) return;
            const newFilePath = this.joinPath(this.state.path, fileName.trim());
            try {
                let shouldSelect = false;
                await this.withLoader(async () => {
                    await callToolWithLoader('explorer', 'write_file', {
                        path: newFilePath,
                        content: ''
                    });
                    this.showStatus(`Created file: ${newFilePath}`);
                    this.caches?.dirListing?.invalidate?.(this, this.state.path);
                    const entries = await this.loadDirectoryContent(this.state.path);
                    if (entries === null) {
                        return;
                    }
                    await this.setEntries(entries);
                    this.invalidate();
                    shouldSelect = true;
                });
                if (shouldSelect) {
                    await this.selectEntry({ dataset: { entryPath: newFilePath, type: 'file' } });
                }
            } catch (err) {
                console.error(err);
                this.showStatus(err.message || 'Failed to create file.', true);
            }
        },

        async newDirectory() {
            const dirName = prompt('Enter name for the new directory:');
            if (!dirName || !dirName.trim()) return;
            const newDirPath = this.joinPath(this.state.path, dirName.trim());
            try {
                await this.withLoader(async () => {
                    await callToolWithLoader('explorer', 'create_directory', {path: newDirPath});
                    this.showStatus(`Successfully created directory.`);
                    await this.loadDirectory(this.state.path);
                });
            } catch (err) {
                console.error(err);
                this.showStatus(err.message || 'Failed to create directory.', true);
            }
        }
    });
}
