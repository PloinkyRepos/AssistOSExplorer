function hasTasksPluginEnabled() {
    const appPlugins = window.assistOS?.workspace?.appPlugins;
    if (!appPlugins || typeof appPlugins !== 'object' || Array.isArray(appPlugins)) {
        return false;
    }
    return Object.values(appPlugins)
        .flatMap((bucket) => Array.isArray(bucket) ? bucket : [])
        .some((plugin) => plugin?.id === 'tasks');
}

export function getPreviewUiState(state) {
    const selectedPath = state?.selectedPath || '';
    const isConfidentialVirtual = selectedPath === '/Confidential' || selectedPath.startsWith('/Confidential/');
    const isTruncatedPreview = Boolean(state?.fileLoadInfo?.truncated);
    const isBacklog = selectedPath.endsWith('.backlog') || selectedPath.endsWith('.history');
    const isHistory = selectedPath.endsWith('.history');
    const tasksPluginEnabled = hasTasksPluginEnabled();
    const showBacklogPanel = tasksPluginEnabled && isBacklog && !state?.backlogTextView;
    const isHtml = /\.html?$/i.test(selectedPath);
    const isPdf = /\.pdf$/i.test(selectedPath);
    const viewMode = isHtml ? (state?.previewViewMode || 'code') : 'code';
    const codeHidden = Boolean(isHtml && viewMode === 'split' && state?.webViewCodePaneHidden);
    const webHidden = Boolean(isHtml && viewMode === 'split' && state?.webViewPaneHidden);
    const canEditDpuFile = Boolean(
        isConfidentialVirtual
        && state?.dpuSelectedCanWrite
    );
    const canEdit = Boolean(
        selectedPath
        && (!isConfidentialVirtual || canEditDpuFile)
        && state?.previewMode !== 'media'
        && state?.previewMode !== 'pdf'
        && state?.previewMode !== 'onlyoffice'
        && !isPdf
        && !isTruncatedPreview
        && !showBacklogPanel
        && !isHistory
    );
    const fileName = selectedPath.split('/').pop() || '';
    const extensionMatch = fileName.match(/\.([^.]+)$/);
    const extension = extensionMatch ? extensionMatch[1].toLowerCase() : '';
    const isPlainTextFile = !extension || extension === 'txt' || extension === 'text' || extension === 'log';
    const showTextPreview = canEdit
        && isPlainTextFile
        && !state?.selectedIsMarkdown
        && state?.previewMode !== 'dpu-secret'
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
        tasksPluginEnabled,
        showBacklogPanel,
        canToggleBacklogView: Boolean(tasksPluginEnabled && isBacklog),
        showEditingActions: Boolean(state?.isEditing),
        showEditAction: canEdit,
        showWrapToggle: showTextPreview,
        wrapEnabled: Boolean(state?.previewWrapEnabled),
        showMarkdownToggle: Boolean(!state?.isEditing && state?.selectedIsMarkdown && selectedPath),
        showWebViewActions: Boolean(isHtml && selectedPath)
    };
}
