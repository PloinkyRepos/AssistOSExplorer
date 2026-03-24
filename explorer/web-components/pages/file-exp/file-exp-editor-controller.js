import { PREVIEW_ACTIONS } from "./file-exp-preview-controller.js";
import { renderCodePreview, renderMarkdownPreview } from "./file-exp-utils.js";
import { getPreviewUiState } from "./file-exp-preview-state.js";

export async function editFile(fileExp) {
    if (!fileExp?.state?.selectedPath) return;
    const selectedPath = fileExp.state.selectedPath || '';
    if (selectedPath.endsWith('.history')) {
        fileExp.showStatus('History files are read-only.', true);
        return;
    }
    const previewUiState = getPreviewUiState(fileExp.state);
    if (selectedPath.endsWith('.backlog') && previewUiState.showBacklogPanel) {
        fileExp.showStatus('Backlog is managed by the Backlog panel.', true);
        return;
    }
    if (fileExp.state.fileLoadInfo?.truncated) {
        fileExp.showStatus('Editing is disabled for large files. Please open it locally to modify.', true);
        return;
    }
    if (fileExp.state.selectedIsMarkdown && !fileExp.state.documentId) {
        try {
            const documentModule = window.assistOS?.loadModule?.('document');
            if (documentModule) {
                const doc = await documentModule.loadDocument(fileExp.state.selectedPath);
                fileExp.setPreviewState({ documentId: doc?.id ?? null });
                if (doc?.id && window.assistOS?.workspace) {
                    window.assistOS.workspace.currentDocumentId = doc.id;
                    window.assistOS.workspace.currentDocumentPath = fileExp.state.selectedPath;
                }
            }
        } catch (error) {
            console.warn('Failed to prepare document editor', error);
        }
    }
    fileExp.setPreviewState({
        markdownTextView: false,
        hasUnsavedChanges: false,
        isEditing: true
    });
    fileExp.refreshPreviewUi();
}

export async function saveFile(fileExp) {
    fileExp.textarea = fileExp.element.querySelector('.code-input');
    if (!fileExp.textarea) {
        return;
    }

    const newContent = fileExp.textarea.value;
    try {
        await fileExp.tooling.writeFile(fileExp.state.selectedPath, newContent);
        fileExp.bumpWorkspaceVersion?.();
        fileExp.showStatus(`Successfully saved ${fileExp.state.selectedPath}`, false);
        fileExp.setPreviewState({
            fileContent: newContent,
            hasUnsavedChanges: false
        });
        fileExp.caches.filePreview.invalidateForPath(fileExp.state.selectedPath);
        fileExp.caches.dirListing.invalidate(fileExp, fileExp.state.path);

        if (fileExp.state.selectedIsMarkdown) {
            const previewSource = fileExp.prepareMarkdownPreviewContent(newContent);
            fileExp.setPreviewState({
                previewContent: renderMarkdownPreview(previewSource),
                markdownTextView: false
            });
            try {
                const documentModule = window.assistOS?.loadModule?.('document');
                if (documentModule) {
                    const doc = await documentModule.loadDocument(fileExp.state.selectedPath);
                    fileExp.setPreviewState({ documentId: doc?.id ?? null });
                    if (doc?.id) {
                        window.assistOS.workspace.currentDocumentId = doc.id;
                        window.assistOS.workspace.currentDocumentPath = fileExp.state.selectedPath;
                    }
                }
            } catch (docError) {
                console.warn('Failed to refresh document after save', docError);
            }
        } else {
            fileExp.setPreviewState({
                previewContent: renderCodePreview(newContent, fileExp.state.selectedPath)
            });
        }

        if (fileExp.isHtmlPreviewCandidate(fileExp.state.selectedPath) && fileExp.state.previewViewMode !== 'code') {
            fileExp.dispatchPreview({
                type: PREVIEW_ACTIONS.REFRESH,
                payload: { path: fileExp.state.selectedPath }
            });
        }

        fileExp.setPreviewState({ isEditing: false });
        fileExp.editorPresenter = null;
        fileExp.refreshPreviewUi();
    } catch (err) {
        console.error(err);
        fileExp.showStatus(err.message || 'Failed to save file.', true);
    }
}

export async function cancelEdit(fileExp) {
    fileExp.setPreviewState({
        isEditing: false,
        markdownTextView: false,
        hasUnsavedChanges: false
    });
    fileExp.editorPresenter = null;
    if (fileExp.state.selectedIsMarkdown && fileExp.state.selectedPath) {
        fileExp.bumpWorkspaceVersion?.();
        fileExp.caches.filePreview.invalidateForPath(fileExp.state.selectedPath);
        fileExp.caches.dirListing.invalidate(fileExp, fileExp.state.path);
        await fileExp.openFile(fileExp.state.selectedPath, {
            showLoader: false,
            invalidate: false
        });
        return;
    }
    fileExp.refreshPreviewUi();
}
