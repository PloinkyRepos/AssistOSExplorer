export function getNextMarkdownToggle(state) {
    if (!state?.selectedIsMarkdown || state?.isEditing) {
        return { changed: false };
    }
    return {
        changed: true,
        patch: {
            markdownTextView: !state.markdownTextView
        }
    };
}

export function getNextBacklogViewToggle(state) {
    if (state?.isEditing && state?.hasUnsavedChanges) {
        return {
            blocked: true,
            changed: false
        };
    }

    const nextBacklogTextView = !Boolean(state?.backlogTextView);
    return {
        blocked: false,
        changed: true,
        patch: {
            backlogTextView: nextBacklogTextView,
            isEditing: false
        },
        shouldReloadSelection: Boolean(nextBacklogTextView && state?.selectedPath)
    };
}

export const PREVIEW_ACTIONS = Object.freeze({
    RESET: 'preview/reset',
    SYNC_PATH: 'preview/sync-path',
    SET_VIEW_MODE: 'preview/set-view-mode',
    REFRESH: 'preview/refresh'
});

export function getPreviewResetPatch() {
    return {
        previewViewMode: 'code',
        webViewUrl: '',
        webViewReloadToken: 0,
        webViewCodePaneHidden: false,
        webViewPaneHidden: false
    };
}

export function getNextPreviewViewMode(state, mode) {
    const normalizedMode = mode === 'web' || mode === 'split' ? mode : 'code';
    const patch = {
        previewViewMode: normalizedMode,
        webViewCodePaneHidden: false,
        webViewPaneHidden: false
    };
    return {
        changed: normalizedMode !== state?.previewViewMode
            || Boolean(state?.webViewCodePaneHidden || state?.webViewPaneHidden),
        patch
    };
}

export function previewReducer(state, action) {
    if (!action || typeof action !== 'object') {
        return { changed: false };
    }

    switch (action.type) {
        case PREVIEW_ACTIONS.RESET: {
            const patch = getPreviewResetPatch();
            const changed = Object.keys(patch).some((key) => state?.[key] !== patch[key]);
            return { changed, patch };
        }
        case PREVIEW_ACTIONS.SYNC_PATH: {
            const pathValue = String(action.payload?.path || '');
            const buildWebViewUrl = action.payload?.buildWebViewUrl;
            if (!/\.html?$/i.test(pathValue)) {
                return previewReducer(state, { type: PREVIEW_ACTIONS.RESET });
            }
            const nextUrl = typeof buildWebViewUrl === 'function' ? buildWebViewUrl(pathValue) : '';
            const patch = {
                webViewUrl: nextUrl,
                webViewCodePaneHidden: false,
                webViewPaneHidden: false
            };
            const changed = Object.keys(patch).some((key) => state?.[key] !== patch[key]);
            return { changed, patch };
        }
        case PREVIEW_ACTIONS.SET_VIEW_MODE:
            return getNextPreviewViewMode(state, action.payload?.mode);
        case PREVIEW_ACTIONS.REFRESH: {
            const selectedPath = String(action.payload?.path || state?.selectedPath || '');
            if (!/\.html?$/i.test(selectedPath)) {
                return { changed: false };
            }
            return {
                changed: true,
                patch: {
                    webViewReloadToken: Number(state?.webViewReloadToken || 0) + 1
                }
            };
        }
        default:
            return { changed: false };
    }
}
