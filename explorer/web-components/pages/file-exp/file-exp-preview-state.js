export function getPreviewUiState(state) {
    const selectedPath = state?.selectedPath || '';
    const isTruncatedPreview = Boolean(state?.fileLoadInfo?.truncated);
    const isBacklog = selectedPath.endsWith('.backlog') || selectedPath.endsWith('.history');
    const isHistory = selectedPath.endsWith('.history');
    const showBacklogPanel = isBacklog && !state?.backlogTextView;
    const isHtml = /\.html?$/i.test(selectedPath);
    const viewMode = isHtml ? (state?.previewViewMode || 'code') : 'code';
    const codeHidden = Boolean(isHtml && viewMode === 'split' && state?.webViewCodePaneHidden);
    const webHidden = Boolean(isHtml && viewMode === 'split' && state?.webViewPaneHidden);

    return {
        selectedPath,
        isBacklog,
        isHistory,
        isHtml,
        viewMode,
        codeHidden,
        webHidden,
        isTruncatedPreview,
        showBacklogPanel,
        showEditingActions: Boolean(state?.isEditing),
        showEditAction: Boolean(selectedPath && state?.previewMode !== 'media' && !isTruncatedPreview && !showBacklogPanel && !isHistory),
        showMarkdownToggle: Boolean(!state?.isEditing && state?.selectedIsMarkdown && selectedPath),
        showWebViewActions: Boolean(isHtml && selectedPath)
    };
}
