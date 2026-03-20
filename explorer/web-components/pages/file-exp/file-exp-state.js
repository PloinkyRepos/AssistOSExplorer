import { createStore } from "../../../services/ui/store.js";
import { loadKeymap } from "../../../utils/keymap.js";

const DEFAULT_COLUMN_VISIBILITY = { type: false, size: false, modified: false };
const DEFAULT_LIST_WIDTH = null;

export function loadWorkspaceVersionSeed() {
    try {
        const raw = typeof window !== 'undefined'
            ? window.__assistosExplorerWorkspaceVersion
            : 0;
        const parsed = Number.parseInt(String(raw ?? '0'), 10);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    } catch (_) {
        return 0;
    }
}

export function loadFilterSpecsPreference() {
    try {
        const stored = window.localStorage.getItem('assistosExplorerFilterSpecs');
        return stored === 'true';
    } catch (_) {
        return false;
    }
}

export function saveFilterSpecsPreference(value) {
    try {
        window.localStorage.setItem('assistosExplorerFilterSpecs', value ? 'true' : 'false');
    } catch (_) {
        // ignore
    }
}

export function loadColumnVisibilityPreference() {
    try {
        const raw = window.localStorage.getItem('assistosExplorerColumnVisibility');
        if (!raw) return DEFAULT_COLUMN_VISIBILITY;
        const parsed = JSON.parse(raw);
        const toVisible = (value) => value === true || value === 'true';
        return {
            type: toVisible(parsed?.type),
            size: toVisible(parsed?.size),
            modified: toVisible(parsed?.modified)
        };
    } catch (_) {
        return DEFAULT_COLUMN_VISIBILITY;
    }
}

export function saveColumnVisibilityPreference(value) {
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

export function loadListWidthPreference() {
    try {
        const raw = window.localStorage.getItem('assistosExplorerListWidth');
        const value = Number.parseInt(String(raw ?? ''), 10);
        return Number.isFinite(value) && value >= 200 ? value : DEFAULT_LIST_WIDTH;
    } catch (_) {
        return DEFAULT_LIST_WIDTH;
    }
}

export function saveListWidthPreference(value) {
    try {
        const next = Number.parseInt(String(value ?? ''), 10);
        if (!Number.isFinite(next) || next < 200) {
            window.localStorage.removeItem('assistosExplorerListWidth');
            return;
        }
        window.localStorage.setItem('assistosExplorerListWidth', String(next));
    } catch (_) {
        // ignore
    }
}

export function createFileExpState() {
    const initialState = {
        path: '/',
        entries: [],
        allEntries: [],
        selectedPath: null,
        fileContent: "",
        previewContent: "",
        selectedIsMarkdown: false,
        markdownTextView: false,
        backlogTextView: false,
        documentId: null,
        isEditing: false,
        hasUnsavedChanges: false,
        isResizing: false,
        clipboard: null,
        openMenuPath: null,
        filterSpecs: loadFilterSpecsPreference(),
        columnVisibility: loadColumnVisibilityPreference(),
        searchMenuOpen: false,
        toolbarMenuOpen: false,
        workspaceVersion: loadWorkspaceVersionSeed(),
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
        searchInFilesRegex: false,
        searchInFilesWholeWord: false,
        searchInFilesBasePath: '/',
        searchInFilesResults: [],
        searchInFilesFileResults: [],
        searchInFilesLoading: false,
        searchInFilesError: null,
        searchInFilesTruncated: false,
        keymap: loadKeymap(),
        pendingHighlight: null,
        previewMode: 'none',
        previewViewMode: 'code',
        webViewUrl: '',
        webViewReloadToken: 0,
        webViewCodePaneHidden: false,
        webViewPaneHidden: false,
        mediaType: null,
        fileLoadInfo: null,
        sortBy: 'name',
        sortDir: 'asc',
        listWidth: loadListWidthPreference()
    };
    return createStore({ initialState });
}
