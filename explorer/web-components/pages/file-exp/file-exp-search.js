// Wire up search-related behaviors for FileExp without bloating the main presenter.
export function attachSearchController(fileExp) {
    const getState = () => fileExp.state;
    const defaultExclude = 'node_modules,.git';

    const getEl = (selector) => fileExp.element?.querySelector(selector);

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
    }

    function setupSearchBindings() {
        if (!fileExp.boundGlobalKeydown) {
            fileExp.boundGlobalKeydown = handleGlobalKeydown;
            document.addEventListener('keydown', fileExp.boundGlobalKeydown);
        }
        if (!fileExp.boundOutsideSearchMenuClick) {
            fileExp.boundOutsideSearchMenuClick = handleOutsideSearchMenuClick;
        }
    }

    function toggleSearchMenu() {
        const state = getState();
        state.searchMenuOpen = !state.searchMenuOpen;
        updateSearchUI();
    }

    async function openSearchModal(mode) {
        const state = getState();
        state.searchMenuOpen = false;
        updateSearchUI();

        const result = await assistOS.UI.createReactiveModal('file-search-modal', {
            mode,
            searchByNameQuery: state.searchByNameQuery || '',
            searchByNameExclude: state.searchByNameExclude || defaultExclude,
            searchInFilesQuery: state.searchInFilesQuery || '',
            searchInFilesExclude: state.searchInFilesExclude || defaultExclude,
            searchInFilesCase: Boolean(state.searchInFilesCaseSensitive),
            basePath: fileExp.normalizePath(state.path || '/')
        }, true);

        if (result && result.path) {
            const normalized = fileExp.normalizePath(result.path);
            if (result.line) {
                state.pendingHighlight = { path: normalized, line: result.line };
            }
            await navigateToPath(normalized);
        }
    }

    async function openSearchByName() {
        await openSearchModal('name');
    }

    async function openSearchInFiles() {
        await openSearchModal('in-files');
    }

    function closeSearchOverlays() {
        const state = getState();
        state.searchMenuOpen = false;
        updateSearchUI();
    }

    function handleGlobalKeydown(event) {
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
        if (event.key === 'Escape') {
            const state = getState();
            if (state.searchMenuOpen) {
                event.preventDefault();
                closeSearchOverlays();
            }
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
        return fileExp.withLoader(async () => {
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
        });
    }

    Object.assign(fileExp, {
        setupSearchBindings,
        updateSearchUI,
        toggleSearchMenu,
        openSearchByName,
        openSearchInFiles,
        closeSearchOverlays,
        openSearchResult,
        navigateToPath
    });
}
