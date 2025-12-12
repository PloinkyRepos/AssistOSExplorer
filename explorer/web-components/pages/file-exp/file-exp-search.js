import { parsePatterns, groupMatchesByFile } from "./file-exp-utils.js";

// Wire up search-related behaviors for FileExp without bloating the main presenter.
export function attachSearchController(fileExp) {
    const getState = () => fileExp.state;
    const getEl = (selector) => fileExp.element?.querySelector(selector);
    const defaultExclude = 'node_modules,.git';

    function resetSearchByNameForm() {
        const state = getState();
        state.searchByNameQuery = '';
        state.searchByNameExclude = defaultExclude;
        state.searchByNameResults = [];
        state.searchByNameLoading = false;
        state.searchByNameError = null;
        if (fileExp.searchByNameTimer) {
            clearTimeout(fileExp.searchByNameTimer);
            fileExp.searchByNameTimer = null;
        }
    }

    function resetSearchInFilesForm() {
        const state = getState();
        state.searchInFilesQuery = '';
        state.searchInFilesExclude = defaultExclude;
        state.searchInFilesCaseSensitive = false;
        state.searchInFilesResults = [];
        state.searchInFilesFileResults = [];
        state.searchInFilesLoading = false;
        state.searchInFilesError = null;
        state.searchInFilesTruncated = false;
    }

    function updateSearchUI() {
        const state = getState();
        const menu = getEl('#searchMenuDropdown');
        const menuButton = getEl('#searchMenuButton');
        if (menu && menuButton) {
            menu.classList.toggle('open', state.searchMenuOpen);
            menuButton.setAttribute('aria-expanded', state.searchMenuOpen ? 'true' : 'false');
        }
        if (state.searchMenuOpen) {
            document.addEventListener('click', fileExp.boundOutsideSearchMenuClick, true);
        } else {
            document.removeEventListener('click', fileExp.boundOutsideSearchMenuClick, true);
        }

        const nameOverlay = getEl('#searchByNameOverlay');
        const textOverlay = getEl('#searchInFilesOverlay');
        if (nameOverlay) {
            nameOverlay.classList.toggle('open', state.searchOverlay === 'name');
            nameOverlay.setAttribute('aria-hidden', state.searchOverlay === 'name' ? 'false' : 'true');
        }
        if (textOverlay) {
            textOverlay.classList.toggle('open', state.searchOverlay === 'in-files');
            textOverlay.setAttribute('aria-hidden', state.searchOverlay === 'in-files' ? 'false' : 'true');
        }

        const syncInput = (id, value) => {
            const input = getEl(id);
            if (input && input.value !== value) {
                input.value = value;
            }
        };
        syncInput('#searchByNameInput', state.searchByNameQuery);
        syncInput('#searchByNameExclude', state.searchByNameExclude);
        syncInput('#searchInFilesQuery', state.searchInFilesQuery);
        syncInput('#searchInFilesExclude', state.searchInFilesExclude);
        const searchInFilesCase = getEl('#searchInFilesCase');
        if (searchInFilesCase) {
            searchInFilesCase.checked = Boolean(state.searchInFilesCaseSensitive);
        }

        renderSearchByNameResults();
        renderSearchInFilesResults();
    }

    function setupSearchBindings() {
        const state = getState();
        if (!fileExp.boundGlobalKeydown) {
            fileExp.boundGlobalKeydown = handleGlobalKeydown;
            document.addEventListener('keydown', fileExp.boundGlobalKeydown);
        }
        if (!fileExp.boundOutsideSearchMenuClick) {
            fileExp.boundOutsideSearchMenuClick = handleOutsideSearchMenuClick;
        }

        const searchByNameInput = getEl('#searchByNameInput');
        if (searchByNameInput && !searchByNameInput.dataset.bound) {
            searchByNameInput.addEventListener('input', (event) => {
                state.searchByNameQuery = event.target.value;
                scheduleSearchByName();
            });
            searchByNameInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    runSearchByName();
                }
            });
            searchByNameInput.dataset.bound = 'true';
        }

        const searchByNameExclude = getEl('#searchByNameExclude');
        if (searchByNameExclude && !searchByNameExclude.dataset.bound) {
            searchByNameExclude.addEventListener('change', (event) => {
                state.searchByNameExclude = event.target.value;
                scheduleSearchByName();
            });
            searchByNameExclude.dataset.bound = 'true';
        }

        const searchInFilesQuery = getEl('#searchInFilesQuery');
        if (searchInFilesQuery && !searchInFilesQuery.dataset.bound) {
            searchInFilesQuery.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    runSearchInFiles();
                }
            });
            searchInFilesQuery.addEventListener('input', (event) => {
                state.searchInFilesQuery = event.target.value;
            });
            searchInFilesQuery.dataset.bound = 'true';
        }

        const searchInFilesExclude = getEl('#searchInFilesExclude');
        if (searchInFilesExclude && !searchInFilesExclude.dataset.bound) {
            searchInFilesExclude.addEventListener('change', (event) => {
                state.searchInFilesExclude = event.target.value;
            });
            searchInFilesExclude.dataset.bound = 'true';
        }

        const searchInFilesCase = getEl('#searchInFilesCase');
        if (searchInFilesCase && !searchInFilesCase.dataset.bound) {
            searchInFilesCase.addEventListener('change', (event) => {
                state.searchInFilesCaseSensitive = Boolean(event.target.checked);
            });
            searchInFilesCase.dataset.bound = 'true';
        }
    }

    function toggleSearchMenu() {
        const state = getState();
        state.searchMenuOpen = !state.searchMenuOpen;
        updateSearchUI();
    }

    function openSearchByName() {
        const state = getState();
        resetSearchByNameForm();
        state.searchOverlay = 'name';
        state.searchMenuOpen = false;
        updateSearchUI();
        setTimeout(() => getEl('#searchByNameInput')?.focus(), 0);
    }

    function openSearchInFiles() {
        const state = getState();
        resetSearchInFilesForm();
        state.searchOverlay = 'in-files';
        state.searchMenuOpen = false;
        updateSearchUI();
        setTimeout(() => getEl('#searchInFilesQuery')?.focus(), 0);
    }

    function closeSearchOverlays() {
        const state = getState();
        state.searchOverlay = null;
        state.searchMenuOpen = false;
        updateSearchUI();
    }

    function handleGlobalKeydown(event) {
        const state = getState();
        const isMeta = event.metaKey || event.ctrlKey;
        if (isMeta && !event.shiftKey && event.key.toLowerCase() === 'p') {
            event.preventDefault();
            openSearchByName();
            return;
        }
        if (isMeta && event.shiftKey && event.key.toLowerCase() === 'f') {
            event.preventDefault();
            openSearchInFiles();
            return;
        }
        if (event.key === 'Escape' && state.searchOverlay) {
            event.preventDefault();
            closeSearchOverlays();
        }
    }

    function handleOutsideSearchMenuClick(event) {
        const state = getState();
        if (!state.searchMenuOpen) return;
        const dropdown = fileExp.element.querySelector('.search-dropdown');
        if (dropdown && !dropdown.contains(event.target)) {
            state.searchMenuOpen = false;
            updateSearchUI();
        }
    }

    function scheduleSearchByName() {
        if (fileExp.searchByNameTimer) {
            clearTimeout(fileExp.searchByNameTimer);
        }
        fileExp.searchByNameTimer = setTimeout(() => runSearchByName(), 220);
    }

    async function runSearchByName() {
        const state = getState();
        const query = (state.searchByNameQuery || '').trim();
        if (!query) {
            state.searchByNameResults = [];
            state.searchByNameError = null;
            updateSearchUI();
            return;
        }
        if (query.length < 2) {
            state.searchByNameResults = [];
            state.searchByNameError = 'Type at least 2 characters.';
            updateSearchUI();
            return;
        }
        state.searchByNameLoading = true;
        state.searchByNameError = null;
        updateSearchUI();
        try {
            const excludePatterns = parsePatterns(state.searchByNameExclude);
            const result = await window.webSkel.appServices.callTool('explorer', 'search_files', {
                path: '/',
                pattern: query,
                excludePatterns
            });
            const lines = (result.text || '')
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line && !line.toLowerCase().includes('no matches'));
            const items = lines.map((line) => {
                const normalized = fileExp.normalizePath(line.startsWith('/') ? line : `/${line}`);
                const name = normalized.split('/').pop() || '/';
                return {
                    path: normalized,
                    name,
                    displayPath: normalized
                };
            });
            state.searchByNameResults = items;
        } catch (error) {
            console.error('search_files failed', error);
            state.searchByNameError = error?.message || 'Search failed.';
            state.searchByNameResults = [];
        } finally {
            state.searchByNameLoading = false;
            updateSearchUI();
        }
    }

    function renderSearchByNameResults() {
        const state = getState();
        const container = getEl('#searchByNameResults');
        const status = getEl('#searchByNameStatus');
        if (!container || !status) {
            return;
        }
        container.innerHTML = '';
        status.className = 'search-status';

        if (state.searchByNameLoading) {
            status.textContent = 'Searching...';
            return;
        }
        if (state.searchByNameError) {
            status.textContent = state.searchByNameError;
            status.classList.add('error');
            return;
        }
        if (!state.searchByNameQuery.trim()) {
            status.textContent = 'Type to search for files or folders.';
            return;
        }
        if (!state.searchByNameResults.length) {
            status.textContent = 'No matches found.';
            return;
        }

        status.textContent = `${state.searchByNameResults.length} match${state.searchByNameResults.length === 1 ? '' : 'es'}`;
        state.searchByNameResults.forEach((item) => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'search-result-item';
            row.setAttribute('data-local-action', 'openSearchResult');
            row.dataset.filePath = item.path;
            const name = document.createElement('div');
            name.className = 'search-result-path';
            name.textContent = item.name;
            const preview = document.createElement('div');
            preview.className = 'search-result-preview';
            preview.textContent = item.displayPath;
            row.appendChild(name);
            row.appendChild(preview);
            container.appendChild(row);
        });
    }

    async function runSearchInFiles() {
        const state = getState();
        const query = (state.searchInFilesQuery || '').trim();
        if (!query) {
            state.searchInFilesResults = [];
            state.searchInFilesError = 'Enter text to search for.';
            updateSearchUI();
            return;
        }
        state.searchInFilesLoading = true;
        state.searchInFilesError = null;
        state.searchInFilesTruncated = false;
        updateSearchUI();
        try {
            const excludePatterns = parsePatterns(state.searchInFilesExclude);
            const result = await window.webSkel.appServices.callTool('explorer', 'search_text', {
                path: '/',
                query,
                caseSensitive: state.searchInFilesCaseSensitive,
                excludePatterns
            });
            let payload = result.json;
            if (!payload) {
                try {
                    payload = JSON.parse(result.text || '{}');
                } catch (_) {
                    payload = null;
                }
            }
            const matches = payload?.results || [];
            state.searchInFilesResults = matches.map((match) => ({
                path: match.path ? fileExp.normalizePath(match.path) : '/',
                line: match.line || null,
                preview: match.preview || ''
            }));
            state.searchInFilesFileResults = groupMatchesByFile(state.searchInFilesResults);
            state.searchInFilesTruncated = Boolean(payload?.truncated);
        } catch (error) {
            console.error('search_text failed', error);
            state.searchInFilesError = error?.message || 'Search failed.';
            state.searchInFilesResults = [];
            state.searchInFilesFileResults = [];
            state.searchInFilesTruncated = false;
        } finally {
            state.searchInFilesLoading = false;
            updateSearchUI();
        }
    }

    function renderSearchInFilesResults() {
        const state = getState();
        const container = getEl('#searchInFilesResults');
        const status = getEl('#searchInFilesStatus');
        if (!container || !status) {
            return;
        }
        container.innerHTML = '';
        status.className = 'search-status';

        const files = state.searchInFilesFileResults;
        if (state.searchInFilesLoading) {
            status.textContent = 'Searching across files...';
            return;
        }
        if (state.searchInFilesError) {
            status.textContent = state.searchInFilesError;
            status.classList.add('error');
            return;
        }
        if (!state.searchInFilesQuery.trim()) {
            status.textContent = 'Search the workspace for text.';
            return;
        }
        if (!files.length) {
            status.textContent = 'No matches found.';
            return;
        }

        const truncatedNote = state.searchInFilesTruncated ? ' (truncated)' : '';
        status.textContent = `${files.length} file${files.length === 1 ? '' : 's'}${truncatedNote}`;
        if (state.searchInFilesTruncated) {
            status.classList.add('strong');
        }

        files.forEach((item) => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'search-result-item';
            row.setAttribute('data-local-action', 'openSearchResult');
            row.dataset.filePath = item.path;
            if (item.firstLine) {
                row.dataset.line = item.firstLine;
            }
            const pathLabel = document.createElement('div');
            pathLabel.className = 'search-result-path';
            pathLabel.textContent = item.firstLine ? `${item.path}:${item.firstLine}` : item.path;
            const meta = document.createElement('div');
            meta.className = 'search-result-meta';
            meta.textContent = `${item.count} match${item.count === 1 ? '' : 'es'}`;
            const preview = document.createElement('div');
            preview.className = 'search-result-preview';
            preview.textContent = item.preview || '';
            row.appendChild(pathLabel);
            row.appendChild(meta);
            row.appendChild(preview);
            container.appendChild(row);
        });
    }

    async function openSearchResult(element) {
        const path = element?.dataset?.filePath;
        if (!path) return;
        const line = element.dataset.line ? Number.parseInt(element.dataset.line, 10) : null;
        const state = getState();
        state.pendingHighlight = line ? { path, line } : null;
        closeSearchOverlays();
        await navigateToPath(path);
    }

    async function navigateToPath(targetPath) {
        const normalized = fileExp.normalizePath(targetPath);
        const state = getState();
        if (state.isEditing && state.hasUnsavedChanges) {
            if (!confirm("You have unsaved changes. Navigate away?")) {
                return;
            }
            await fileExp.cancelEdit();
        }
        try {
            await window.webSkel.appServices.callTool('explorer', 'read_text_file', { path: normalized });
            const parentDir = fileExp.parentPath(normalized) || '/';
            state.path = parentDir;
            const entries = await fileExp.loadDirectoryContent(parentDir);
            await fileExp.setEntries(entries);
            state.selectedPath = normalized;
            state.isEditing = false;
            await fileExp.openFile(normalized);
            history.replaceState(null, '', `#file-exp${normalized}`);
        } catch (error) {
            state.pendingHighlight = null;
            await fileExp.loadDirectory(normalized);
            history.replaceState(null, '', `#file-exp${normalized}`);
        }
    }

    Object.assign(fileExp, {
        setupSearchBindings,
        updateSearchUI,
        toggleSearchMenu,
        openSearchByName,
        openSearchInFiles,
        closeSearchOverlays,
        scheduleSearchByName,
        runSearchByName,
        renderSearchByNameResults,
        runSearchInFiles,
        renderSearchInFilesResults,
        openSearchResult,
        navigateToPath
    });
}
