export const FILE_EXP_UI_ACTIONS = Object.freeze({
    RESET_DIRECTORY_CONTEXT: 'file-exp-ui/reset-directory-context',
    SET_PREVIEW_STATE: 'file-exp-ui/set-preview-state',
    SET_TOOLBAR_MENU_OPEN: 'file-exp-ui/set-toolbar-menu-open',
    SET_SEARCH_MENU_OPEN: 'file-exp-ui/set-search-menu-open',
    SET_OPEN_MENU_PATH: 'file-exp-ui/set-open-menu-path',
    SET_PENDING_HIGHLIGHT: 'file-exp-ui/set-pending-highlight',
    SET_SORT: 'file-exp-ui/set-sort',
    SET_LIST_WIDTH: 'file-exp-ui/set-list-width',
    SET_LIST_COLLAPSED: 'file-exp-ui/set-list-collapsed',
    SET_DIRECTORY_VIEW_MODE: 'file-exp-ui/set-directory-view-mode',
    SET_IS_RESIZING: 'file-exp-ui/set-is-resizing',
    SET_COLUMN_VISIBILITY: 'file-exp-ui/set-column-visibility',
    SET_HAS_UNSAVED_CHANGES: 'file-exp-ui/set-has-unsaved-changes',
    SET_FILTER_SPECS: 'file-exp-ui/set-filter-specs'
});

export function getDirectoryResetPatch() {
    return {
        selectedPath: null,
        fileContent: '',
        previewContent: '',
        selectedIsMarkdown: false,
        previewMode: 'none',
        mediaType: null,
        fileLoadInfo: null,
        onlyOfficeConfig: null,
        onlyOfficeStatusText: '',
        markdownTextView: false,
        backlogTextView: false,
        documentId: null,
        dpuSelectedObjectId: null,
        dpuSelectedCanWrite: false,
        dpuSelectedCanComment: false,
        dpuSelectedCommentCount: 0,
        dpuSelectedComments: [],
        dpuCommentsOpen: false,
        isEditing: false,
        hasUnsavedChanges: false,
        openMenuPath: null
    };
}

export function fileExpUiReducer(state, action) {
    if (!action || typeof action !== 'object') {
        return { changed: false };
    }

    switch (action.type) {
        case FILE_EXP_UI_ACTIONS.RESET_DIRECTORY_CONTEXT: {
            const patch = getDirectoryResetPatch();
            const changed = Object.keys(patch).some((key) => state?.[key] !== patch[key]);
            return { changed, patch };
        }
        case FILE_EXP_UI_ACTIONS.SET_PREVIEW_STATE: {
            const rawPatch = action.payload?.patch;
            if (!rawPatch || typeof rawPatch !== 'object') {
                return { changed: false };
            }
            const allowedKeys = new Set([
                'fileContent',
                'previewContent',
                'selectedIsMarkdown',
                'previewMode',
                'previewWrapEnabled',
                'mediaType',
                'fileLoadInfo',
                'onlyOfficeConfig',
                'onlyOfficeStatusText',
                'markdownTextView',
                'backlogTextView',
                'documentId',
                'dpuSelectedObjectId',
                'dpuSelectedCanWrite',
                'dpuSelectedCanComment',
                'dpuSelectedCommentCount',
                'dpuSelectedComments',
                'dpuCommentsOpen',
                'hasUnsavedChanges',
                'isEditing'
            ]);
            const patch = {};
            for (const [key, value] of Object.entries(rawPatch)) {
                if (!allowedKeys.has(key)) continue;
                patch[key] = value;
            }
            if (!Object.keys(patch).length) {
                return { changed: false };
            }
            const changed = Object.keys(patch).some((key) => state?.[key] !== patch[key]);
            return { changed, patch };
        }
        case FILE_EXP_UI_ACTIONS.SET_TOOLBAR_MENU_OPEN: {
            const open = Boolean(action.payload?.open);
            return {
                changed: open !== Boolean(state?.toolbarMenuOpen),
                patch: { toolbarMenuOpen: open }
            };
        }
        case FILE_EXP_UI_ACTIONS.SET_SEARCH_MENU_OPEN: {
            const open = Boolean(action.payload?.open);
            return {
                changed: open !== Boolean(state?.searchMenuOpen),
                patch: { searchMenuOpen: open }
            };
        }
        case FILE_EXP_UI_ACTIONS.SET_OPEN_MENU_PATH: {
            const pathValue = action.payload?.path ? String(action.payload.path) : null;
            return {
                changed: pathValue !== (state?.openMenuPath || null),
                patch: { openMenuPath: pathValue }
            };
        }
        case FILE_EXP_UI_ACTIONS.SET_PENDING_HIGHLIGHT: {
            const highlight = action.payload?.highlight || null;
            const current = state?.pendingHighlight || null;
            const changed = (!highlight && current)
                || (!current && highlight)
                || (highlight && current && (highlight.path !== current.path || highlight.line !== current.line));
            return {
                changed: Boolean(changed),
                patch: { pendingHighlight: highlight }
            };
        }
        case FILE_EXP_UI_ACTIONS.SET_SORT: {
            const sortBy = String(action.payload?.sortBy || state?.sortBy || 'name');
            const sortDir = action.payload?.sortDir === 'desc' ? 'desc' : 'asc';
            const patch = {
                sortBy,
                sortDir
            };
            if (Array.isArray(action.payload?.entries)) {
                patch.entries = action.payload.entries;
            }
            const changed = sortBy !== state?.sortBy
                || sortDir !== state?.sortDir
                || (Array.isArray(patch.entries) && patch.entries !== state?.entries);
            return { changed, patch };
        }
        case FILE_EXP_UI_ACTIONS.SET_LIST_WIDTH: {
            const rawWidth = action.payload?.width;
            const width = Number.isFinite(rawWidth) && rawWidth > 0
                ? Math.max(200, Math.round(rawWidth))
                : null;
            return {
                changed: width !== (state?.listWidth ?? null),
                patch: { listWidth: width }
            };
        }
        case FILE_EXP_UI_ACTIONS.SET_LIST_COLLAPSED: {
            const listCollapsed = Boolean(action.payload?.listCollapsed);
            return {
                changed: listCollapsed !== Boolean(state?.listCollapsed),
                patch: { listCollapsed }
            };
        }
        case FILE_EXP_UI_ACTIONS.SET_DIRECTORY_VIEW_MODE: {
            const directoryViewMode = action.payload?.directoryViewMode === 'tree' ? 'tree' : 'list';
            return {
                changed: directoryViewMode !== String(state?.directoryViewMode || 'list'),
                patch: { directoryViewMode }
            };
        }
        case FILE_EXP_UI_ACTIONS.SET_IS_RESIZING: {
            const isResizing = Boolean(action.payload?.isResizing);
            return {
                changed: isResizing !== Boolean(state?.isResizing),
                patch: { isResizing }
            };
        }
        case FILE_EXP_UI_ACTIONS.SET_COLUMN_VISIBILITY: {
            const column = String(action.payload?.column || '').trim();
            if (!column) {
                return { changed: false };
            }
            const visible = Boolean(action.payload?.visible);
            const currentVisibility = state?.columnVisibility || {};
            if (Boolean(currentVisibility[column]) === visible) {
                return { changed: false };
            }
            return {
                changed: true,
                patch: {
                    columnVisibility: {
                        ...currentVisibility,
                        [column]: visible
                    }
                }
            };
        }
        case FILE_EXP_UI_ACTIONS.SET_HAS_UNSAVED_CHANGES: {
            const hasUnsavedChanges = Boolean(action.payload?.hasUnsavedChanges);
            return {
                changed: hasUnsavedChanges !== Boolean(state?.hasUnsavedChanges),
                patch: { hasUnsavedChanges }
            };
        }
        case FILE_EXP_UI_ACTIONS.SET_FILTER_SPECS: {
            const filterSpecs = Boolean(action.payload?.filterSpecs);
            return {
                changed: filterSpecs !== Boolean(state?.filterSpecs),
                patch: { filterSpecs }
            };
        }
        default:
            return { changed: false };
    }
}
