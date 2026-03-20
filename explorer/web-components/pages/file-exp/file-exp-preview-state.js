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
    const canEdit = Boolean(selectedPath && state?.previewMode !== 'media' && !isTruncatedPreview && !showBacklogPanel && !isHistory);
    const fileName = selectedPath.split('/').pop() || '';
    const extensionMatch = fileName.match(/\.([^.]+)$/);
    const extension = extensionMatch ? extensionMatch[1].toLowerCase() : '';
    const isPlainTextFile = !extension || extension === 'txt' || extension === 'text' || extension === 'log';
    const showTextPreview = canEdit
        && isPlainTextFile
        && !state?.selectedIsMarkdown
        && !(isHtml && viewMode === 'web');

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
        showEditAction: canEdit,
        showWrapToggle: showTextPreview,
        wrapEnabled: Boolean(state?.previewWrapEnabled),
        showMarkdownToggle: Boolean(!state?.isEditing && state?.selectedIsMarkdown && selectedPath),
        showWebViewActions: Boolean(isHtml && selectedPath)
    };
}
