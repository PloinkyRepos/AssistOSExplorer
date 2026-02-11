// Wire up search-related behaviors for FileExp without bloating the main presenter.
import { callToolWithLoader } from "../../../utils/globalLoader.js";
import { getKeymap, matchesShortcut } from "../../../utils/keymap.js";
import { getCurrentTheme } from "../../../utils/theme.js";
import { FILE_EXP_REPLACE_COMPLETE_EVENT } from "../../../utils/appEvents.js";
export function attachSearchController(fileExp) {
    const getState = () => fileExp.state;
    const defaultExclude = 'node_modules,.git';
    const setDocumentListener = (key, eventName, handler, options) => {
        if (typeof fileExp.setDocumentListener === 'function') {
            return fileExp.setDocumentListener(key, eventName, handler, options);
        }
        document.addEventListener(eventName, handler, options);
        return () => document.removeEventListener(eventName, handler, options);
    };
    const removeDocumentListener = (key) => {
        if (typeof fileExp.removeDocumentListener === 'function') {
            return fileExp.removeDocumentListener(key);
        }
        return false;
    };
    const setWindowListener = (key, eventName, handler, options) => {
        if (typeof fileExp.setWindowListener === 'function') {
            return fileExp.setWindowListener(key, eventName, handler, options);
        }
        if (typeof fileExp.addWindowListener === 'function') {
            return fileExp.addWindowListener(eventName, handler, options);
        }
        window.addEventListener(eventName, handler, options);
        return () => window.removeEventListener(eventName, handler, options);
    };

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
            setDocumentListener('search-menu-outside', 'click', fileExp.boundOutsideSearchMenuClick, true);
        } else {
            removeDocumentListener('search-menu-outside');
        }
    }

    function setupSearchBindings() {
        if (!fileExp.boundGlobalKeydown) {
            fileExp.boundGlobalKeydown = handleGlobalKeydown;
        }
        setDocumentListener('search-global-keydown', 'keydown', fileExp.boundGlobalKeydown);
        if (!fileExp.boundOutsideSearchMenuClick) {
            fileExp.boundOutsideSearchMenuClick = handleOutsideSearchMenuClick;
        }
    }

    function toggleSearchMenu() {
        const state = getState();
        fileExp.setSearchMenuOpen(!state.searchMenuOpen);
        updateSearchUI();
    }

    function buildDirectorySuggestions() {
        const state = getState();
        const suggestions = new Set(['/']);
        const normalize = (value) => fileExp.normalizePath(value || '/');
        const add = (value) => {
            if (!value) return;
            suggestions.add(normalize(value));
        };

        add(state.path || '/');
        let current = normalize(state.path || '/');
        while (current && current !== '/') {
            const parent = fileExp.parentPath(current) || '/';
            add(parent);
            if (parent === current) break;
            current = parent;
        }

        const entries = Array.isArray(state.allEntries) ? state.allEntries : Array.isArray(state.entries) ? state.entries : [];
        entries.forEach((entry) => {
            if (entry?.type === 'directory' && entry.path) {
                add(entry.path);
            }
        });

        const cachedDirs = fileExp.caches?.dirListing?.keys?.() || [];
        cachedDirs.forEach((dir) => add(dir));

        return Array.from(suggestions).sort();
    }

    async function openSearchModal(mode) {
        const state = getState();
        fileExp.setSearchMenuOpen(false);
        updateSearchUI();

        const result = await assistOS.UI.createReactiveModal('file-search-modal', {
            mode,
            searchByNameQuery: state.searchByNameQuery || '',
            searchByNameExclude: state.searchByNameExclude || defaultExclude,
            searchInFilesQuery: state.searchInFilesQuery || '',
            searchInFilesExclude: state.searchInFilesExclude || defaultExclude,
            searchInFilesCase: Boolean(state.searchInFilesCaseSensitive),
            searchInFilesBasePath: state.searchInFilesBasePath || '/',
            directorySuggestions: buildDirectorySuggestions(),
            basePath: fileExp.normalizePath(state.path || '/')
        }, true);

        if (result && result.path) {
            const normalized = fileExp.normalizePath(result.path);
            const line = Number.parseInt(String(result.line ?? ''), 10);
            if (Number.isFinite(line) && line > 0) {
                fileExp.setPendingHighlight({ path: normalized, line });
            }
            await navigateToPath(normalized);
        }
    }

    async function openSearchByName() {
        await openSearchModal('name');
    }

    async function openSearchInFiles() {
        await openSearchModal('replace');
    }

    async function openReplaceInFiles() {
        await openSearchModal('replace');
    }

    async function openSettingsModal(_target, tab = 'keymap') {
        const state = getState();
        const normalizedTab = tab === 'theme' ? 'theme' : 'keymap';
        fileExp.setSearchMenuOpen(false);
        updateSearchUI();
        const result = await assistOS.UI.createReactiveModal('settings-modal', {
            tab: normalizedTab,
            keymap: state.keymap || getKeymap(),
            theme: getCurrentTheme()
        }, true);
        if (result?.keymap) {
            state.keymap = result.keymap;
        }
    }

    function closeSearchOverlays() {
        fileExp.setSearchMenuOpen(false);
        updateSearchUI();
    }

    function handleGlobalKeydown(event) {
        const keymap = getState().keymap || getKeymap();
        if (keymap.findFile && matchesShortcut(event, keymap.findFile)) {
            event.preventDefault();
            openSearchByName();
            return;
        }
        if (keymap.findInFiles && matchesShortcut(event, keymap.findInFiles)) {
            event.preventDefault();
            openSearchInFiles();
            return;
        }
        if (keymap.replaceInFiles && matchesShortcut(event, keymap.replaceInFiles)) {
            event.preventDefault();
            openReplaceInFiles();
            return;
        }
        if (keymap.saveFile && matchesShortcut(event, keymap.saveFile)) {
            if (getState().isEditing) {
                event.preventDefault();
                fileExp.saveFile();
            }
            return;
        }
        if (keymap.openKeymap && matchesShortcut(event, keymap.openKeymap)) {
            event.preventDefault();
            openSettingsModal(null, 'keymap');
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
            fileExp.setSearchMenuOpen(false);
            updateSearchUI();
        }
    }

    async function handleReplaceComplete(event) {
        const changed = Array.isArray(event?.detail?.changedFiles) ? event.detail.changedFiles : [];
        if (!changed.length) return;
        const state = getState();
        if (state.isEditing && state.hasUnsavedChanges) {
            fileExp.showStatus('Files were replaced on disk. Save or refresh to see changes.', true);
            return;
        }
        try {
            if (fileExp.caches?.dirListing?.invalidate && state.path) {
                fileExp.caches.dirListing.invalidate(fileExp, state.path);
            }
            if (state.selectedPath && changed.includes(state.selectedPath)) {
                await fileExp.withLoader(async () => {
                    await fileExp.openFile(state.selectedPath);
                });
            }
        } catch (error) {
            console.warn('Failed to refresh after replace', error);
            fileExp.showStatus('Replace completed. Manual refresh may be needed.', true);
        }
    }

    async function openSearchResult(element) {
        const path = element?.dataset?.filePath;
        if (!path) return;
        const parsedLine = Number.parseInt(String(element.dataset.line ?? ''), 10);
        const line = Number.isFinite(parsedLine) && parsedLine > 0 ? parsedLine : null;
        const normalized = fileExp.normalizePath(path);
        fileExp.setPendingHighlight(line ? { path: normalized, line } : null);
        closeSearchOverlays();
        await navigateToPath(normalized);
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
                await callToolWithLoader('explorer', 'read_text_file', { path: normalized });
                const parentDir = fileExp.parentPath(normalized) || '/';
                state.path = parentDir;
                const entries = await fileExp.loadDirectoryContent(parentDir);
                await fileExp.setEntries(entries);
                state.selectedPath = normalized;
                state.isEditing = false;
                if (state.pendingHighlight && state.pendingHighlight.path === normalized) {
                    fileExp.caches?.filePreview?.invalidateForPath?.(normalized);
                }
                await fileExp.openFile(normalized);
                history.replaceState(null, '', `#file-exp${normalized}`);
            } catch (error) {
                fileExp.setPendingHighlight(null);
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
        openReplaceInFiles,
        openSettingsModal,
        closeSearchOverlays,
        openSearchResult,
        navigateToPath,
        handleReplaceComplete
    });

    if (!fileExp.boundReplaceComplete) {
        fileExp.boundReplaceComplete = handleReplaceComplete;
    }
    setWindowListener('replace-complete', FILE_EXP_REPLACE_COMPLETE_EVENT, fileExp.boundReplaceComplete);
}
