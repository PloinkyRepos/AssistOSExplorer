import { createStore } from "../../../services/ui/store.js";
import { loadKeymap } from "../../../utils/keymap.js";

const DEFAULT_COLUMN_VISIBILITY = { type: false, size: false, modified: false };

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
        return {
            type: parsed.type !== false,
            size: parsed.size !== false,
            modified: parsed.modified !== false
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
        searchInFilesBasePath: '/',
        searchInFilesResults: [],
        searchInFilesFileResults: [],
        searchInFilesLoading: false,
        searchInFilesError: null,
        searchInFilesTruncated: false,
        keymap: loadKeymap(),
        pendingHighlight: null,
        previewMode: 'none',
        mediaType: null,
        fileLoadInfo: null,
        sortBy: 'name',
        sortDir: 'asc',
        listWidth: null
    };
    return createStore({ initialState });
}
