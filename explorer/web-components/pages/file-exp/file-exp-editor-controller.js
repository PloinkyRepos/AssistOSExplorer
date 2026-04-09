import { PREVIEW_ACTIONS } from "./file-exp-preview-controller.js";
import { renderCodePreview, renderMarkdownPreview } from "./file-exp-utils.js";
import { getPreviewUiState } from "./file-exp-preview-state.js";
import { isDpuSecretPath, isDpuVirtualPath, openDpuFile, readDpuCurrentItemState, updateDpuFile, updateDpuSecret } from "./file-exp-dpu-provider.js";
import { startCurrentFileViewWatch, stopCurrentFileViewWatch } from "./file-exp-current-file-monitor.js";

function extractDpuUpdatedAt(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return '';
    if (snapshot.kind === 'secret') {
        return String(snapshot.secret?.updatedAt || '');
    }
    if (snapshot.kind === 'confidential') {
        return String(snapshot.object?.updatedAt || '');
    }
    return '';
}

export async function editFile(fileExp) {
    if (!fileExp?.state?.selectedPath) return;
    const selectedPath = fileExp.state.selectedPath || '';
    if (isDpuSecretPath(selectedPath)) {
        await fileExp.beginDpuSecretInlineEdit?.();
        return;
    }
    const isDpuPath = isDpuVirtualPath(selectedPath);
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
    if (isDpuPath) {
        try {
            await openDpuFile(fileExp, selectedPath, {
                invalidate: false
            });
        } catch (error) {
            console.warn('Failed to refresh DPU item before edit', error);
            fileExp.showStatus(error?.message || 'Failed to refresh DPU item before edit.', true);
            return;
        }
    } else {
        try {
            const info = await fileExp.refreshSelectedFileVersionInfo(selectedPath);
            fileExp.setPreviewState({
                selectedFileVersionKey: String(info?.versionKey || ''),
                selectedFileModifiedAt: String(info?.modified || ''),
                selectedFileSize: Number.isFinite(info?.size) ? info.size : null,
                externallyModified: false,
                savePending: false,
                lastSaveError: '',
                lastEditorSaveAt: 0,
                lastEditorSaveMode: ''
            }, { invalidate: false });
        } catch (error) {
            console.warn('Failed to capture file version before edit', error);
            fileExp.showStatus(error?.message || 'Failed to prepare edit session for this file.', true);
            return;
        }
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
        savePending: false,
        isEditing: true,
        lastExternalReloadAt: 0
    });
    stopCurrentFileViewWatch(fileExp);
    fileExp.handleEditorBufferChange?.();
    if (!isDpuPath && !fileExp.state.selectedIsMarkdown) {
        fileExp.startEditorExternalWatch?.();
    }
    fileExp.refreshPreviewUi();
}

export async function saveFile(fileExp, options = {}) {
    fileExp.textarea = fileExp.element.querySelector('.code-input');
    if (!fileExp.textarea) {
        return;
    }

    const preserveEditing = Boolean(options?.preserveEditing);
    const autoSave = Boolean(options?.autoSave);
    const newContent = fileExp.textarea.value;
    const selectedPath = fileExp.state.selectedPath || '';
    const isDpuPath = isDpuVirtualPath(selectedPath);
    const isExternalModificationError = (error) => /updated externally/i.test(String(error?.message || ''));
    if (fileExp.state.savePending) {
        return;
    }
    try {
        fileExp.setPreviewState({
            savePending: true,
            lastSaveError: ''
        }, { invalidate: false });
        fileExp.refreshPreviewUi();
        if (isDpuPath) {
            if (!fileExp.state.dpuSelectedCanWrite) {
                throw new Error('You do not have permission to save this DPU file.');
            }
            const latestSnapshot = await readDpuCurrentItemState(fileExp, selectedPath);
            const latestUpdatedAt = extractDpuUpdatedAt(latestSnapshot);
            const editBaselineUpdatedAt = String(fileExp.state.dpuSelectedUpdatedAt || '');
            if (editBaselineUpdatedAt && latestUpdatedAt && latestUpdatedAt !== editBaselineUpdatedAt) {
                await openDpuFile(fileExp, selectedPath, {
                    invalidate: false
                });
                throw new Error('This item was updated by another user. Review the latest version and apply your changes again.');
            }
            if (isDpuSecretPath(selectedPath)) {
                await updateDpuSecret(fileExp, fileExp.state.selectedPath, {
                    value: newContent
                });
            } else {
                if (!fileExp.state.dpuSelectedObjectId) {
                    throw new Error('You do not have permission to save this Confidential file.');
                }
                await updateDpuFile(fileExp, fileExp.state.selectedPath, {
                    content: newContent
                });
            }
        } else {
            if (fileExp.state.externallyModified) {
                throw new Error('This file was updated externally. Reload it before saving again.');
            }
            const latestInfo = await fileExp.refreshSelectedFileVersionInfo(selectedPath);
            const baselineVersionKey = String(fileExp.state.selectedFileVersionKey || '');
            if (baselineVersionKey && latestInfo?.versionKey && latestInfo.versionKey !== baselineVersionKey) {
                await fileExp.markExternalModificationDetected({ silent: true });
                throw new Error('This file was updated externally. Reload it before saving again.');
            }
            await fileExp.tooling.writeFile(fileExp.state.selectedPath, newContent);
            fileExp.bumpWorkspaceVersion?.();
            fileExp.caches.filePreview.invalidateForPath(fileExp.state.selectedPath);
            fileExp.caches.dirListing.invalidate(fileExp, fileExp.state.path);
        }

        let latestSavedVersion = null;
        if (!isDpuPath) {
            latestSavedVersion = await fileExp.refreshSelectedFileVersionInfo(selectedPath);
        }
        if (!autoSave) {
            fileExp.showStatus(`Successfully saved ${selectedPath}`, false);
        }
        fileExp.setPreviewState({
            fileContent: newContent,
            hasUnsavedChanges: false,
            savePending: false,
            lastSaveError: '',
            lastEditorSaveAt: Date.now(),
            lastEditorSaveMode: autoSave ? 'auto' : 'manual',
            externallyModified: false,
            selectedFileVersionKey: String(latestSavedVersion?.versionKey || fileExp.state.selectedFileVersionKey || ''),
            selectedFileModifiedAt: String(latestSavedVersion?.modified || fileExp.state.selectedFileModifiedAt || ''),
            selectedFileSize: Number.isFinite(latestSavedVersion?.size) ? latestSavedVersion.size : fileExp.state.selectedFileSize
        }, { invalidate: false });

        if (isDpuPath) {
            fileExp.stopEditorExternalWatch?.();
            fileExp.clearEditorAutoSaveTimer?.();
            fileExp.setPreviewState({ isEditing: false });
            fileExp.editorPresenter = null;
            await openDpuFile(fileExp, selectedPath, {
                invalidate: false
            });
            return;
        }

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

        if (preserveEditing) {
            fileExp.startEditorExternalWatch?.();
        } else {
            fileExp.stopEditorExternalWatch?.();
            fileExp.clearEditorAutoSaveTimer?.();
            fileExp.setPreviewState({ isEditing: false }, { invalidate: false });
            fileExp.editorPresenter = null;
            fileExp.startCurrentFileViewWatch?.();
        }
        fileExp.refreshPreviewUi();
    } catch (err) {
        if (!isExternalModificationError(err)) {
            console.error(err);
        }
        fileExp.setPreviewState({
            savePending: false,
            lastSaveError: err?.message || 'Failed to save file.',
            lastEditorSaveMode: '',
            lastExternalReloadAt: 0
        }, { invalidate: false });
        fileExp.refreshPreviewUi();
        fileExp.showStatus(err.message || 'Failed to save file.', true);
    }
}

export async function cancelEdit(fileExp) {
    fileExp.clearEditorAutoSaveTimer?.();
    fileExp.stopEditorExternalWatch?.();
    fileExp.setPreviewState({
        isEditing: false,
        markdownTextView: false,
        hasUnsavedChanges: false,
        savePending: false,
        lastSaveError: '',
        lastEditorSaveAt: 0,
        lastEditorSaveMode: '',
        lastExternalReloadAt: 0,
        externallyModified: false,
        selectedFileVersionKey: '',
        selectedFileModifiedAt: '',
        selectedFileSize: null
    });
    fileExp.editorPresenter = null;
    if (isDpuVirtualPath(fileExp.state.selectedPath)) {
        await openDpuFile(fileExp, fileExp.state.selectedPath, {
            showLoader: false,
            invalidate: false
        });
        return;
    }
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
    startCurrentFileViewWatch(fileExp);
    fileExp.refreshPreviewUi();
}
