import { PREVIEW_ACTIONS } from "./file-exp-preview-controller.js";
import { renderCodePreview } from "./file-exp-utils.js";
import { getPreviewUiState } from "./file-exp-preview-state.js";
import { isDpuSecretPath, isDpuVirtualPath, openDpuFile, readDpuCurrentItemState, updateDpuFile, updateDpuSecret } from "./file-exp-dpu-provider.js";
import { startCurrentFileViewWatch, stopCurrentFileViewWatch } from "./file-exp-current-file-monitor.js";
import { emitAuditEvent } from "../../../services/audit/auditService.js";
import {
    applyMarkdownCrdtChange,
    openMarkdownCrdtDocument,
    saveMarkdownCrdtDocument,
    syncMarkdownCrdtFromFile
} from "../../../services/crdt/markdownCrdtClient.js";

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
    fileExp.setPreviewState({
        documentId: null,
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

export async function editSoplangMarkdown(fileExp) {
    if (!fileExp?.state?.selectedPath || !fileExp.state.selectedIsMarkdown) {
        fileExp?.showStatus?.('Select a Markdown file first.', true);
        return;
    }
    const selectedPath = fileExp.state.selectedPath || '';
    if (selectedPath.endsWith('.history')) {
        fileExp.showStatus('History files are read-only.', true);
        return;
    }
    if (fileExp.state.fileLoadInfo?.truncated) {
        fileExp.showStatus('SOPLang tag editing is disabled for large files.', true);
        return;
    }
    try {
        const documentModule = window.assistOS?.loadModule?.('document');
        if (!documentModule) {
            throw new Error('Document module is not available.');
        }
        const doc = await documentModule.loadDocument(selectedPath);
        fileExp.setPreviewState({
            documentId: doc?.id ?? null,
            markdownTextView: false,
            hasUnsavedChanges: false,
            savePending: false,
            isEditing: true,
            lastExternalReloadAt: 0
        });
        if (doc?.id && window.assistOS?.workspace) {
            window.assistOS.workspace.currentDocumentId = doc.id;
            window.assistOS.workspace.currentDocumentPath = selectedPath;
        }
        stopCurrentFileViewWatch(fileExp);
        fileExp.refreshPreviewUi();
    } catch (error) {
        console.warn('Failed to prepare SOPLang tag editor', error);
        fileExp.showStatus(error?.message || 'Failed to open SOPLang tag editor.', true);
    }
}

export async function saveFile(fileExp, options = {}) {
    fileExp.textarea = fileExp.element.querySelector('.code-input');
    if (!fileExp.textarea) {
        return;
    }

    const preserveEditing = Boolean(options?.preserveEditing);
    const autoSave = Boolean(options?.autoSave);
    const newContent = fileExp.textarea.value;
    let savedContent = newContent;
    const selectedPath = fileExp.state.selectedPath || '';
    const isDpuPath = isDpuVirtualPath(selectedPath);
    const isExternalModificationError = (error) => /updated externally/i.test(String(error?.message || ''));
    let markdownCrdtDocumentId = '';
    let markdownInfoMessage = '';
    if (fileExp.state.savePending) {
        return;
    }
    try {
        let markdownEditorPresenter = null;
        if (!isDpuPath && fileExp.state.selectedIsMarkdown) {
            markdownEditorPresenter = fileExp.element.querySelector('markdown-editor')?.webSkelPresenter || null;
            markdownCrdtDocumentId = String(markdownEditorPresenter?.crdtDocumentId || '');
            if (typeof markdownEditorPresenter?.flushPendingCrdtChange === 'function') {
                await markdownEditorPresenter.flushPendingCrdtChange();
                markdownCrdtDocumentId = String(markdownEditorPresenter?.crdtDocumentId || markdownCrdtDocumentId);
            } else if (markdownEditorPresenter?.pendingChange) {
                await markdownEditorPresenter.pendingChange;
                markdownCrdtDocumentId = String(markdownEditorPresenter?.crdtDocumentId || markdownCrdtDocumentId);
            } else {
                const crdt = await openMarkdownCrdtDocument(fileExp.state.selectedPath);
                markdownCrdtDocumentId = String(crdt?.documentId || '');
                const applied = await applyMarkdownCrdtChange(String(crdt?.documentId || ''), {
                    type: 'replaceDocumentFromMarkdown',
                    markdown: newContent
                });
                if (applied?.documentId) {
                    markdownCrdtDocumentId = String(applied.documentId);
                    if (markdownEditorPresenter) {
                        markdownEditorPresenter.crdtDocumentId = markdownCrdtDocumentId;
                    }
                }
            }
        }
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
            if (!fileExp.state.selectedIsMarkdown && fileExp.state.externallyModified) {
                throw new Error('This file was updated externally. Reload it before saving again.');
            }
            const latestInfo = await fileExp.refreshSelectedFileVersionInfo(selectedPath);
            const baselineVersionKey = String(fileExp.state.selectedFileVersionKey || '');
            if (!fileExp.state.selectedIsMarkdown && baselineVersionKey && latestInfo?.versionKey && latestInfo.versionKey !== baselineVersionKey) {
                await fileExp.markExternalModificationDetected({ silent: true });
                throw new Error('This file was updated externally. Reload it before saving again.');
            }
            if (fileExp.state.selectedIsMarkdown) {
                const saveResult = await saveMarkdownCrdtDocument({
                    documentId: markdownCrdtDocumentId || markdownEditorPresenter?.crdtDocumentId || '',
                    path: fileExp.state.selectedPath
                });
                if (typeof saveResult?.markdown === 'string') {
                    savedContent = saveResult.markdown;
                }
                if (Array.isArray(saveResult?.warnings) && saveResult.warnings.length > 0) {
                    markdownInfoMessage = saveResult.warnings.join(' ');
                }
            } else {
                await fileExp.tooling.writeFile(fileExp.state.selectedPath, newContent);
            }
            fileExp.bumpWorkspaceVersion?.();
            fileExp.caches.filePreview.invalidateForPath(fileExp.state.selectedPath);
            fileExp.caches.dirListing.invalidate(fileExp, fileExp.state.path);
        }

        let latestSavedVersion = null;
        if (!isDpuPath) {
            latestSavedVersion = await fileExp.refreshSelectedFileVersionInfo(selectedPath);
        }
        if (!autoSave) {
            fileExp.showStatus(markdownInfoMessage || `Successfully saved ${selectedPath}`, false);
        }
        void emitAuditEvent('file.update', {
            path: selectedPath,
            currentPath: fileExp.normalizePath(fileExp.state.path || '/'),
            selectedPath: fileExp.normalizePath(selectedPath),
            metadata: {
                autoSave,
                preserveEditing,
                isDpu: isDpuPath
            }
        });
        fileExp.setPreviewState({
            fileContent: savedContent,
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
            fileExp.setPreviewState({
                previewContent: '',
                markdownTextView: false,
                documentId: null
            });
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
    const selectedPath = fileExp.state.selectedPath || '';
    const isMarkdownClose = Boolean(fileExp.state.selectedIsMarkdown && selectedPath);
    fileExp.clearEditorAutoSaveTimer?.();
    fileExp.stopEditorExternalWatch?.();
    if (isMarkdownClose) {
        fileExp.setPreviewState({
            savePending: true,
            lastSaveError: ''
        }, { invalidate: false });
        fileExp.refreshPreviewUi();
        try {
            const markdownEditorPresenter = fileExp.element.querySelector('markdown-editor')?.webSkelPresenter || null;
            if (markdownEditorPresenter) {
                if (typeof markdownEditorPresenter.discardPendingCrdtChange === 'function') {
                    await markdownEditorPresenter.discardPendingCrdtChange();
                }
                await syncMarkdownCrdtFromFile(selectedPath);
            }
            const documentViewPresenter = fileExp.element.querySelector('document-view-page')?.webSkelPresenter || null;
            if (typeof documentViewPresenter?.flushPendingEdit === 'function') {
                await documentViewPresenter.flushPendingEdit();
            }
        } catch (error) {
            console.error(error);
            fileExp.setPreviewState({
                savePending: false,
                lastSaveError: error?.message || 'Failed to close Markdown editor.'
            }, { invalidate: false });
            fileExp.refreshPreviewUi();
            fileExp.showStatus(error?.message || 'Failed to close Markdown editor.', true);
            return;
        }
    }
    fileExp.setPreviewState({
        isEditing: false,
        markdownTextView: false,
        hasUnsavedChanges: false,
        savePending: isMarkdownClose,
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
    if (isDpuVirtualPath(selectedPath)) {
        await openDpuFile(fileExp, selectedPath, {
            showLoader: false,
            invalidate: false
        });
        return;
    }
    if (isMarkdownClose) {
        fileExp.refreshPreviewUi();
        try {
            const documentModule = window.assistOS?.loadModule?.('document');
            if (typeof documentModule?.waitForPendingMarkdownChanges === 'function') {
                await documentModule.waitForPendingMarkdownChanges(selectedPath);
            }
            fileExp.bumpWorkspaceVersion?.();
            fileExp.caches.filePreview.invalidateForPath(selectedPath);
            fileExp.caches.dirListing.invalidate(fileExp, fileExp.state.path);
            await fileExp.openFile(selectedPath, {
                showLoader: false,
                invalidate: false,
                preserveSaveStatus: true
            });
            fileExp.setPreviewState({
                savePending: false,
                lastSaveError: ''
            }, { invalidate: false });
            startCurrentFileViewWatch(fileExp);
            fileExp.refreshPreviewUi();
        } catch (error) {
            console.error(error);
            fileExp.setPreviewState({
                savePending: false,
                lastSaveError: error?.message || 'Failed to refresh Markdown preview.'
            }, { invalidate: false });
            fileExp.refreshPreviewUi();
            fileExp.showStatus(error?.message || 'Failed to refresh Markdown preview.', true);
        }
        return;
    }
    startCurrentFileViewWatch(fileExp);
    fileExp.refreshPreviewUi();
}
