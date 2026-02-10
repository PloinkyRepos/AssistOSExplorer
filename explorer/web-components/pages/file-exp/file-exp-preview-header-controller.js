export function createPreviewHeaderController(host) {
    const getElements = () => {
        const root = host?.element;
        if (!root) return null;
        return {
            previewTitle: root.querySelector('.preview-title'),
            headerExtras: root.querySelector('#previewHeaderExtras'),
            editorActions: root.querySelector('#editorActions'),
            editingActions: root.querySelector('#editingActions'),
            markdownViewActions: root.querySelector('#markdownViewActions'),
            toggleMarkdownViewButton: root.querySelector('#toggleMarkdownViewButton'),
            webViewActions: root.querySelector('#webViewActions'),
            showCodeViewButton: root.querySelector('#showCodeViewButton'),
            showWebViewButton: root.querySelector('#showWebViewButton'),
            showSplitViewButton: root.querySelector('#showSplitViewButton'),
            fileNameLabel: root.querySelector('#editorFileName')
        };
    };

    const syncEditActions = (elements, previewUiState) => {
        const { editorActions, editingActions } = elements;
        if (!editorActions || !editingActions) return;
        if (previewUiState.showEditingActions) {
            editorActions.classList.add('hidden');
            editingActions.classList.remove('hidden');
            return;
        }
        editingActions.classList.add('hidden');
        editorActions.classList.toggle('hidden', !previewUiState.showEditAction);
    };

    const syncMarkdownActions = (elements, previewUiState) => {
        const { markdownViewActions, toggleMarkdownViewButton } = elements;
        if (!markdownViewActions || !toggleMarkdownViewButton) return;
        if (!previewUiState.showMarkdownToggle) {
            markdownViewActions.classList.add('hidden');
            return;
        }
        markdownViewActions.classList.remove('hidden');
        toggleMarkdownViewButton.textContent = host.state.markdownTextView ? 'View as preview' : 'View as text';
    };

    const syncWebActions = (elements, previewUiState) => {
        const {
            webViewActions,
            showCodeViewButton,
            showWebViewButton,
            showSplitViewButton
        } = elements;

        if (!webViewActions) return;
        const splitActive = previewUiState.viewMode === 'split';
        webViewActions.classList.toggle('hidden', !previewUiState.showWebViewActions || splitActive);
        if (!previewUiState.showWebViewActions) return;

        const modeButtons = {
            code: showCodeViewButton,
            web: showWebViewButton,
            split: showSplitViewButton
        };
        Object.entries(modeButtons).forEach(([mode, button]) => {
            if (!button) return;
            button.classList.toggle('active', previewUiState.viewMode === mode);
            button.style.display = splitActive ? 'none' : '';
        });
    };

    const syncFileName = (elements) => {
        const { fileNameLabel } = elements;
        if (!fileNameLabel) return;
        const fallbackName = host.state.selectedPath ? host.state.selectedPath.split('/').pop() : '';
        fileNameLabel.textContent = fallbackName;
    };

    return {
        sync(previewUiState) {
            const elements = getElements();
            if (!elements) return;

            if (elements.headerExtras && !previewUiState.showBacklogPanel && elements.headerExtras.children.length) {
                elements.headerExtras.innerHTML = '';
            }
            if (elements.previewTitle) {
                elements.previewTitle.classList.toggle('hidden', previewUiState.showBacklogPanel);
            }

            syncEditActions(elements, previewUiState);
            syncMarkdownActions(elements, previewUiState);
            syncWebActions(elements, previewUiState);
            syncFileName(elements);

            if (previewUiState.isBacklog && typeof host.renderBacklogViewToggle === 'function') {
                host.renderBacklogViewToggle(elements.headerExtras, previewUiState.showBacklogPanel);
            }
        }
    };
}
