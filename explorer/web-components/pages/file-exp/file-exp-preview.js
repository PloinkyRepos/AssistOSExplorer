import {
    isImageFile,
    isAudioFile,
    isVideoFile,
    renderMarkdownPreview,
    renderCodePreview,
    scrollToLine,
    scrollPreviewToAnchor,
    clearLineHighlight
} from "./file-exp-utils.js";
import { callToolWithLoader } from "../../../utils/globalLoader.js";

export async function tryLoadMediaPreview(fileExp, filePath) {
    const isMedia = isImageFile(filePath) || isAudioFile(filePath) || isVideoFile(filePath);
    if (!isMedia) {
        return false;
    }
    try {
        const result = await callToolWithLoader('explorer', 'read_media_file', { path: filePath });
        const blocks = Array.isArray(result?.blocks) ? result.blocks : [];
        const content = Array.isArray(result?.content) ? result.content : [];
        const block = [...blocks, ...content].find((item) => item?.data || item?.resource?.uri);
        if (!block) {
            throw new Error('No media data returned.');
        }

        const mimeType = block.mimeType || block.resource?.mimeType || 'application/octet-stream';
        const src = block.resource?.uri
            ? block.resource.uri
            : `data:${mimeType};base64,${block.data}`;

        const type = block.type === 'image' || mimeType.startsWith('image/')
            ? 'image'
            : block.type === 'audio' || mimeType.startsWith('audio/')
                ? 'audio'
                : block.type === 'video' || mimeType.startsWith('video/')
                    ? 'video'
                    : 'resource';

        let markup = '';
        if (type === 'audio') {
            markup = `<audio controls class="media-audio" preload="metadata" src="${src}"></audio>`;
        } else if (type === 'video') {
            markup = `<video controls class="media-video" preload="metadata" src="${src}"></video>`;
        } else if (type === 'image') {
            markup = `<img src="${src}" alt="Preview of ${filePath.split('/').pop()}" class="media-image">`;
        } else {
            markup = `<a href="${src}" target="_blank" rel="noopener">Open media</a>`;
        }

        fileExp.setPreviewState({
            previewMode: 'media',
            mediaType: type,
            previewContent: markup,
            selectedIsMarkdown: false,
            fileContent: '',
            markdownTextView: false,
            documentId: null,
            hasUnsavedChanges: false,
            isEditing: false
        });
        return true;
    } catch (err) {
        console.warn('Media preview failed', err);
        fileExp.showStatus(err.message || 'Could not preview media file.', true);
        fileExp.setPreviewState({
            previewMode: 'code',
            mediaType: null
        });
        return false;
    }
}

export async function openFile(fileExp, filePath, { largeFilePreviewLimitBytes, largeFilePreviewLines }) {
    await fileExp.withLoader(async () => {
        try {
            clearLineHighlight(fileExp.element);
            fileExp.setPreviewState({
                previewMode: 'code',
                mediaType: null,
                fileLoadInfo: null
            });
            if (await tryLoadMediaPreview(fileExp, filePath)) {
                fileExp.invalidate();
                return;
            }

            const entry = (fileExp.state.allEntries || []).find((item) => item?.path === filePath);
            const entrySize = Number.isFinite(entry?.size) ? entry.size : null;
            const pendingHighlight = fileExp.state.pendingHighlight;
            const hasPendingForFile = pendingHighlight
                && fileExp.normalizePath(pendingHighlight.path || '') === fileExp.normalizePath(filePath);
            const pendingLine = hasPendingForFile
                ? Number.parseInt(String(pendingHighlight.line ?? ''), 10)
                : null;
            const effectivePendingLine = Number.isFinite(pendingLine) && pendingLine > 0 ? pendingLine : null;
            const previewLineBudget = effectivePendingLine
                ? Math.max(largeFilePreviewLines, effectivePendingLine + 80)
                : largeFilePreviewLines;
            const shouldPreviewPartial = entrySize !== null && entrySize > largeFilePreviewLimitBytes;
            const cacheKey = fileExp.caches.filePreview.buildKey(filePath, entry, shouldPreviewPartial);
            const isBacklogFile = String(filePath || '').endsWith('.backlog') || String(filePath || '').endsWith('.history');
            const cachedPreview = (isBacklogFile || hasPendingForFile) ? null : fileExp.caches.filePreview.get(cacheKey);
            if (cachedPreview) {
                fileExp.setPreviewState({
                    fileContent: cachedPreview.fileContent,
                    selectedIsMarkdown: cachedPreview.selectedIsMarkdown,
                    previewContent: cachedPreview.previewContent,
                    previewMode: cachedPreview.previewMode,
                    fileLoadInfo: cachedPreview.fileLoadInfo,
                    markdownTextView: false,
                    documentId: null,
                    hasUnsavedChanges: false,
                    isEditing: false
                });
                if (fileExp.state.pendingHighlight && fileExp.state.pendingHighlight.path !== fileExp.normalizePath(filePath)) {
                    fileExp.setPendingHighlight(null);
                }
                fileExp.invalidate();
                return;
            }

            const isPayloadTooLargeError = (error) => {
                const message = error?.message || '';
                return /payloadtoo?large/i.test(message) || /entity too large/i.test(message) || error?.status === 413;
            };

            const readText = async (usePartial = false) => {
                const args = { path: filePath };
                if (usePartial) {
                    args.head = previewLineBudget;
                }
                return callToolWithLoader('explorer', 'read_text_file', args);
            };

            let contentResult;
            let truncated = false;
            try {
                contentResult = await readText(shouldPreviewPartial);
                truncated = shouldPreviewPartial;
            } catch (error) {
                if (!shouldPreviewPartial && isPayloadTooLargeError(error)) {
                    contentResult = await readText(true);
                    truncated = true;
                } else {
                    throw error;
                }
            }

            const fileLoadInfo = truncated ? {
                truncated: true,
                size: entrySize,
                previewLines: previewLineBudget,
                message: `File is ${entrySize ? fileExp.formatBytes(entrySize) : 'large'}; showing first ${previewLineBudget} lines. Editing is disabled in this view.`
            } : null;

            const fileContent = String(contentResult?.text || '');
            const selectedIsMarkdown = fileExp.isMarkdownFile(filePath);
            const useMarkdownTextViewForHighlight = Boolean(hasPendingForFile && selectedIsMarkdown);
            const previewContent = selectedIsMarkdown
                ? (renderMarkdownPreview(fileExp.prepareMarkdownPreviewContent(fileContent) || '') || '')
                : renderCodePreview(fileContent, filePath);
            const previewMode = selectedIsMarkdown ? 'markdown' : 'code';

            fileExp.setPreviewState({
                fileLoadInfo,
                fileContent,
                selectedIsMarkdown,
                markdownTextView: useMarkdownTextViewForHighlight,
                documentId: null,
                hasUnsavedChanges: false,
                previewContent,
                previewMode,
                mediaType: null,
                isEditing: false
            });
            if (!isBacklogFile) {
                fileExp.caches.filePreview.set(cacheKey, {
                    fileContent: fileExp.state.fileContent,
                    selectedIsMarkdown: fileExp.state.selectedIsMarkdown,
                    previewContent: fileExp.state.previewContent,
                    previewMode: fileExp.state.previewMode,
                    fileLoadInfo: fileExp.state.fileLoadInfo
                });
            }
            if (fileExp.state.pendingHighlight && fileExp.state.pendingHighlight.path !== fileExp.normalizePath(filePath)) {
                fileExp.setPendingHighlight(null);
            }
            fileExp.invalidate();
        } catch (err) {
            console.error(err);
            fileExp.showStatus(err.message || 'Failed to read file.', true);
        }
    });
}

export function attachPreviewAnchorHandler(fileExp) {
    const previewRoot = fileExp.element.querySelector('#filePreview');
    if (!previewRoot) {
        return;
    }
    previewRoot.removeEventListener('click', fileExp.boundPreviewAnchorHandler);
    previewRoot.addEventListener('click', fileExp.boundPreviewAnchorHandler);
}

export function detachPreviewAnchorHandler(fileExp) {
    const previewRoot = fileExp.element.querySelector('#filePreview');
    if (!previewRoot) {
        return;
    }
    previewRoot.removeEventListener('click', fileExp.boundPreviewAnchorHandler);
}

export function handlePreviewAnchorClick(fileExp, event) {
    const anchor = event.target?.closest?.('a[href^="#"]');
    if (!anchor) {
        return;
    }
    const href = anchor.getAttribute('href');
    if (!href || href.length <= 1) {
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    const targetId = href.slice(1);
    if (!targetId) {
        return;
    }
    const previewRoot = fileExp.element.querySelector('#filePreview');
    if (!previewRoot) {
        return;
    }
    scrollPreviewToAnchor(previewRoot, targetId);
}
