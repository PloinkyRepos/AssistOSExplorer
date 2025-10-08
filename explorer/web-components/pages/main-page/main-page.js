export class MainPage {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.state = {
            path: '/',
            includeHidden: false,
            entries: [],
            selectedPath: null,
            fileContent: "",
            isEditing: false,
            isResizing: false
        };
        this.invalidate(this.loadDirectory.bind(this));
    }

    beforeRender() {
        const folderIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-folder-fill" viewBox="0 0 16 16">
  <path d="M9.828 3h3.982a2 2 0 0 1 1.992 2.181l-.637 7A2 2 0 0 1 13.174 14H2.826a2 2 0 0 1-1.991-1.819l-.637-7a1.99 1.99 0 0 1 .342-1.31L.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3zm-8.322.12C1.72 3.042 1.95 3 2.19 3h5.396l-.707-.707A1 1 0 0 0 6.172 2H2.5a1 1 0 0 0-1 .981l.006.139z"/>
</svg>`;
        const fileIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-file-earmark-fill" viewBox="0 0 16 16">
  <path d="M4 0h5.5v1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5h1V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2z"/>
  <path d="M9.5 3.5 14 8V3.5A1.5 1.5 0 0 0 12.5 2H9.5v1.5z"/>
</svg>`;

        this.entriesHTML = "";
        const filtered = this.state.entries.filter(entry => this.state.includeHidden || !entry.name.startsWith('.'));
        if (filtered.length === 0) {
            this.entriesHTML = `<tr><td colspan="5">Empty directory.</td></tr>`;
        } else {
            filtered.forEach(entry => {
                const icon = entry.type === 'directory' ? folderIcon : fileIcon;
                this.entriesHTML += `
                    <tr data-path="${this.joinPath(this.state.path, entry.name)}" data-type="${entry.type}">
                        <td data-path="${this.joinPath(this.state.path, entry.name)}" data-type="${entry.type}" data-local-action="selectEntry"><span class="icon">${icon}</span> ${entry.name}</td>
                        <td data-path="${this.joinPath(this.state.path, entry.name)}" data-type="${entry.type}" data-local-action="selectEntry">${entry.type}</td>
                        <td data-path="${this.joinPath(this.state.path, entry.name)}" data-type="${entry.type}" data-local-action="selectEntry">${entry.type === 'directory' ? '—' : this.formatBytes(entry.size)}</td>
                        <td data-path="${this.joinPath(this.state.path, entry.name)}" data-type="${entry.type}"  data-local-action="selectEntry">${entry.modified ? this.formatDate(entry.modified) : '—'}</td>
                        <td><button class="secondary" data-local-action="deleteEntry" data-path="${this.joinPath(this.state.path, entry.name)}" data-type="${entry.type}" title="Delete">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-trash-fill" viewBox="0 0 16 16">
                                <path d="M2.5 1a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1H3v9a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V4h.5a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H10a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1H2.5zm3 4a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-1 0v-7a.5.5 0 0 1 .5-.5zM8 5a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-1 0v-7A.5.5 0 0 1 8 5zm3 .5v7a.5.5 0 0 1-1 0v-7a.5.5 0 0 1 1 0z"/>
                            </svg>
                        </button></td>
                    </tr>`;
            });
        }
    }

    async afterRender() {
        this.renderBreadcrumbs();
        if (this.state.selectedPath) {
            const row = this.element.querySelector(`[data-path="${this.state.selectedPath}"]`);
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
            previewContent.innerHTML = `<file-editor data-presenter="file-editor" data-title="${this.state.selectedPath}" data-content="${this.state.fileContent}"></file-editor>`;
        } else {
            previewContent.innerHTML = `<pre id="filePreview"></pre>`;
            const filePreview = this.element.querySelector("#filePreview");
            if (this.state.selectedPath) {
                filePreview.textContent = this.state.fileContent;
            } else {
                filePreview.textContent = "Select a file to see its contents.";
            }
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
    }

    async loadDirectory(path = this.state.path) {
        this.state.path = this.normalizePath(path);
        this.state.selectedPath = null;
        this.state.fileContent = "";
        this.state.isEditing = false;

        try {
            const result = await this.callTool('list_directory', {path: this.state.path});
            const parsedEntries = this.parseDirectoryListing(result.text).map(entry => ({
                ...entry,
                path: this.joinPath(this.state.path, entry.name)
            }));
            this.state.entries = parsedEntries;
        } catch (err) {
            console.error(err);
            this.showStatus(err.message || 'Failed to load directory.', true);
            this.state.entries = [];
        }
        this.invalidate();
    }

    async selectEntry(element) {
        const path = element.dataset.path;
        const type = element.dataset.type;

        if (this.state.isEditing) {
            if (!confirm("You have unsaved changes. Are you sure you want to navigate away?")) {
                return;
            }
        }

        if (type === 'directory') {
            await this.loadDirectory(path);
        } else if (type === 'file') {
            this.state.selectedPath = path;
            this.state.isEditing = false;
            await this.openFile(path);
        }
    }

    async openFile(filePath) {
        try {
            const contentResult = await this.callTool('read_text_file', {path: filePath});
            this.state.fileContent = contentResult.text;
            this.invalidate();
        } catch (err) {
            console.error(err);
            this.showStatus(err.message || 'Failed to read file.', true);
        }
    }

    async editFile() {
        if (!this.state.selectedPath) return;
        this.state.isEditing = true;
        this.invalidate();
    }

    async saveFile() {
        this.textarea = this.element.querySelector('.code-input');
        if (this.textarea) {
            const newContent = this.textarea.value
            try {
                await this.callTool('write_file', {path: this.state.selectedPath, content: newContent});
                this.showStatus(`Successfully saved ${this.state.selectedPath}`, false);
                this.state.fileContent = newContent;
                this.state.isEditing = false;
                this.editorPresenter = null;
                this.invalidate();
            } catch (err) {
                console.error(err);
                this.showStatus(err.message || 'Failed to save file.', true);
            }
        }
    }

    async cancelEdit() {
        this.state.isEditing = false;
        this.editorPresenter = null;
        this.invalidate();
    }

    async deleteEntry(element) {
        const path = element.dataset.path;
        const type = element.dataset.type;

        if (!confirm(`Are you sure you want to delete ${path}?`)) {
            return;
        }

        try {
            const tool = type === 'directory' ? 'delete_directory' : 'delete_file';
            await this.callTool(tool, {path: path});
            this.showStatus(`Successfully deleted ${path}`);

            if (this.state.selectedPath === path) {
                this.state.selectedPath = null;
                this.state.fileContent = "";
            }

            await this.loadDirectory(this.state.path);
        } catch (err) {
            console.error(err);
            this.showStatus(err.message || 'Failed to delete.', true);
        }
    }


    // Utility and helper functions from old app.js
    normalizePath(pathStr) {
        if (!pathStr) return '/';
        const parts = pathStr.split('/').filter(Boolean);
        return '/' + parts.join('/');
    }

    joinPath(base, name) {
        const cleanedBase = this.normalizePath(base);
        const target = cleanedBase === '/' ? name : `${cleanedBase}/${name}`;
        const segments = target.split('/').filter(Boolean);
        return '/' + segments.join('/');
    }

    parentPath(p) {
        const normalized = this.normalizePath(p);
        if (normalized === '/') return null;
        const segments = normalized.split('/').filter(Boolean);
        segments.pop();
        return segments.length ? `/${segments.join('/')}` : '/';
    }

    formatBytes(value) {
        if (!Number.isFinite(value) || value < 0) return '—';
        if (value === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
        const sized = value / Math.pow(1024, exponent);
        return `${sized.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
    }

    formatDate(value) {
        if (!value) return '—';
        try {
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return value;
            return date.toLocaleString();
        } catch (_) {
            return value;
        }
    }

    parseDirectoryListing(text) {
        const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        const entries = lines.map(line => {
            const match = line.match(/^(?:<pre>)?\s*\[(DIR|FILE)\]\s+(.*)$/);
            if (!match) {
                return {name: line, type: 'unknown'};
            }
            return {
                name: match[2].trim(),
                type: match[1] === 'DIR' ? 'directory' : 'file'
            };
        });
        entries.sort((a, b) => {
            const order = {directory: 0, file: 1, unknown: 2};
            const diff = (order[a.type] || 3) - (order[b.type] || 3);
            if (diff !== 0) return diff;
            return a.name.localeCompare(b.name, undefined, {sensitivity: 'base'});
        });
        return entries;
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
            breadcrumbsEl.appendChild(document.createTextNode('/'));
            const btn = document.createElement('button');
            btn.textContent = segment;
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

    async callTool(tool, args = {}) {
        const response = await fetch('/mcps/explorer', {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'},
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: Date.now().toString(),
                method: 'tools/call',
                params: {name: tool, arguments: args}
            })
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        if (data.error) {
            throw new Error(data.error.message);
        }
        const blocks = Array.isArray(data.result?.content) ? data.result.content : [];
        const firstText = blocks.find(block => block?.type === 'text')?.text;
        if (typeof firstText !== 'string') {
            throw new Error('Agent response did not include text content.');
        }
        return {text: firstText, blocks, raw: data.result};
    }

    async newFile() {
        const fileName = prompt('Enter name for the new file:');
        if (!fileName || !fileName.trim()) {
            return;
        }
        const newFilePath = this.joinPath(this.state.path, fileName.trim());
        try {
            await this.callTool('write_file', {path: newFilePath, content: ''});
            this.showStatus(`Successfully created file.`);
            await this.loadDirectory(this.state.path);
        } catch (err) {
            console.error(err);
            this.showStatus(err.message || 'Failed to create file.', true);
        }
    }

    async goUp() {
        const parent = this.parentPath(this.state.path);
        if (parent !== null) {
            await this.loadDirectory(parent);
        }
    }

    async refresh() {
        await this.loadDirectory(this.state.path);
    }

    async newDirectory() {
        const dirName = prompt('Enter name for the new directory:');
        if (!dirName || !dirName.trim()) {
            return;
        }
        const newDirPath = this.joinPath(this.state.path, dirName.trim());
        try {
            await this.callTool('create_directory', {path: newDirPath});
            this.showStatus(`Successfully created directory.`);
            await this.loadDirectory(this.state.path);
        } catch (err) {
            console.error(err);
            this.showStatus(err.message || 'Failed to create directory.', true);
        }
    }

    toggleHiddenFiles(element) {
        this.state.includeHidden = element.checked;
        this.invalidate();
    }
}
