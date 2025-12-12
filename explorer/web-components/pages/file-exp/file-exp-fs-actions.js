// File system related UI actions for FileExp, attached to the presenter to keep it lean.
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
                    await window.webSkel.appServices.callTool('explorer', tool, { path });
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
                    await window.webSkel.appServices.callTool('explorer', 'move_file', { source, destination });
                    const wasSelected = this.state.selectedPath === source;
                    if (this.state.clipboard?.path === source) {
                        this.state.clipboard = { ...this.state.clipboard, path: destination, name: newName };
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
            this.state.clipboard = { mode: 'copy', path, name, type: element.dataset.type };
            this.showStatus(`Copied "${name}" to clipboard.`);
            this.invalidate();
        },

        cutEntry(element) {
            const path = element?.dataset?.entryPath;
            if (!path) return;
            this.closeActionMenu(false);
            const name = path.split('/').pop();
            this.state.clipboard = { mode: 'cut', path, name, type: element.dataset.type };
            this.showStatus(`Ready to move "${name}".`);
            this.invalidate();
        },

        toggleActionMenu(element, maybeEvent) {
            if (maybeEvent?.stopPropagation) maybeEvent.stopPropagation();
            if (maybeEvent?.preventDefault) maybeEvent.preventDefault();
            const path = element?.dataset?.entryPath;
            if (!path) return;
            const previous = this.state.openMenuPath;
            const next = previous === path ? null : path;
            this.state.openMenuPath = next;
            this.pendingMenuFocusPath = next;
            this.invalidate();
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

        closeActionMenu(shouldInvalidate = true) {
            if (!this.state.openMenuPath) return false;
            this.pendingMenuFocusPath = null;
            this.state.openMenuPath = null;
            if (shouldInvalidate) this.invalidate();
            return true;
        },

        clearClipboard() {
            if (!this.state.clipboard) return;
            const previous = this.state.clipboard.name;
            this.state.clipboard = null;
            this.showStatus(previous ? `Cleared clipboard (was "${previous}").` : 'Clipboard cleared.');
            this.invalidate();
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
            const desiredName = this.sanitizeEntryName(input);
            if (!desiredName) {
                this.showStatus('Please enter a valid name.', true);
                return;
            }

            const destination = this.joinPath(targetDir, desiredName);
            const wasSelectedFile = this.state.selectedPath === clipboard.path && clipboard.type === 'file';
            const existsInTarget = existingNames.has(desiredName);
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
            if (clipboard.mode === 'cut' && existsInTarget) {
                this.showStatus(`"${desiredName}" already exists in the target directory.`, true);
                return;
            }

            try {
                await this.withLoader(async () => {
                    if (clipboard.mode === 'cut') {
                        await window.webSkel.appServices.callTool('explorer', 'move_file', {
                            source: clipboard.path,
                            destination
                        });
                        this.state.clipboard = null;
                        this.showStatus(`Moved to ${destination}.`);
                    } else {
                        let overwrite = false;
                        if (existsInTarget) {
                            const shouldOverwrite = confirm(`"${desiredName}" already exists here. Overwrite it?`);
                            if (!shouldOverwrite) return;
                            overwrite = true;
                        }
                        await window.webSkel.appServices.callTool('explorer', 'copy_file', {
                            source: clipboard.path,
                            destination,
                            overwrite
                        });
                        this.showStatus(`Copied to ${destination}${overwrite ? ' (overwritten)' : ''}.`);
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
                        return;
                    }

                    this.invalidate();
                });
            } catch (err) {
                console.error(err);
                this.showStatus(err.message || 'Failed to paste item.', true);
            }
        },

        async newFile() {
            const fileName = prompt('Enter name for the new file:');
            if (!fileName || !fileName.trim()) return;
            const newFilePath = this.joinPath(this.state.path, fileName.trim());
            try {
                await this.withLoader(async () => {
                    await window.webSkel.appServices.callTool('explorer', 'write_file', { path: newFilePath, content: '' });
                    this.showStatus(`Created file: ${newFilePath}`);
                    await this.loadDirectory(this.state.path);
                });
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
                    await window.webSkel.appServices.callTool('explorer', 'create_directory', { path: newDirPath });
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
