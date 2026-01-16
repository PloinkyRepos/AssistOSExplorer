import {
    isImageFile,
    isAudioFile,
    isVideoFile,
    renderMarkdownPreview,
    renderCodePreview,
    scrollToLine,
    scrollPreviewToAnchor
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

        fileExp.state.previewMode = 'media';
        fileExp.state.mediaType = type;
        fileExp.state.previewContent = markup;
        fileExp.state.selectedIsMarkdown = false;
        fileExp.state.selectedIsBacklog = false;
        fileExp.state.fileContent = '';
        fileExp.state.markdownTextView = false;
        fileExp.state.documentId = null;
        fileExp.state.hasUnsavedChanges = false;
        return true;
    } catch (err) {
        console.warn('Media preview failed', err);
        fileExp.showStatus(err.message || 'Could not preview media file.', true);
        fileExp.state.previewMode = 'code';
        fileExp.state.mediaType = null;
        return false;
    }
}

export async function openFile(fileExp, filePath, { largeFilePreviewLimitBytes, largeFilePreviewLines }) {
    await fileExp.withLoader(async () => {
        try {
            fileExp.state.previewMode = 'code';
            fileExp.state.mediaType = null;
            fileExp.state.fileLoadInfo = null;
            if (await tryLoadMediaPreview(fileExp, filePath)) {
                fileExp.invalidate();
                return;
            }

            const entry = (fileExp.state.allEntries || []).find((item) => item?.path === filePath);
            const entrySize = Number.isFinite(entry?.size) ? entry.size : null;
            const shouldPreviewPartial = entrySize !== null && entrySize > largeFilePreviewLimitBytes;
            const cacheKey = fileExp.caches.filePreview.buildKey(filePath, entry, shouldPreviewPartial);
            const cachedPreview = fileExp.caches.filePreview.get(cacheKey);
            if (cachedPreview) {
                fileExp.state.fileContent = cachedPreview.fileContent;
                fileExp.state.selectedIsMarkdown = cachedPreview.selectedIsMarkdown;
                fileExp.state.selectedIsBacklog = cachedPreview.selectedIsBacklog;
                fileExp.state.previewContent = cachedPreview.previewContent;
                fileExp.state.previewMode = cachedPreview.previewMode;
                fileExp.state.fileLoadInfo = cachedPreview.fileLoadInfo;
                fileExp.state.markdownTextView = false;
                fileExp.state.documentId = null;
                fileExp.state.hasUnsavedChanges = false;
                fileExp.state.isEditing = false;
                fileExp.state.pendingHighlight = null;
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
                    args.head = largeFilePreviewLines;
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

            if (truncated) {
                fileExp.state.fileLoadInfo = {
                    truncated: true,
                    size: entrySize,
                    previewLines: largeFilePreviewLines,
                    message: `File is ${entrySize ? fileExp.formatBytes(entrySize) : 'large'}; showing first ${largeFilePreviewLines} lines. Editing is disabled in this view.`
                };
            } else {
                fileExp.state.fileLoadInfo = null;
            }

            fileExp.state.fileContent = contentResult.text;
            fileExp.state.selectedIsBacklog = fileExp.isBacklogFile(filePath);
            fileExp.state.selectedIsMarkdown = fileExp.isMarkdownFile(filePath);
            fileExp.state.markdownTextView = false;
            fileExp.state.documentId = null;
            fileExp.state.hasUnsavedChanges = false;
            if (fileExp.state.selectedIsBacklog) {
                fileExp.state.previewContent = '';
                fileExp.state.previewMode = 'backlog';
            } else if (fileExp.state.selectedIsMarkdown) {
                const previewSource = fileExp.prepareMarkdownPreviewContent(fileExp.state.fileContent);
                fileExp.state.previewContent = renderMarkdownPreview(previewSource || '') || '';
                fileExp.state.markdownTextView = false;
                fileExp.state.previewMode = 'markdown';
            } else {
                fileExp.state.previewContent = renderCodePreview(fileExp.state.fileContent, filePath);
                fileExp.state.markdownTextView = false;
                fileExp.state.previewMode = 'code';
            }
            fileExp.caches.filePreview.set(cacheKey, {
                fileContent: fileExp.state.fileContent,
                selectedIsMarkdown: fileExp.state.selectedIsMarkdown,
                selectedIsBacklog: fileExp.state.selectedIsBacklog,
                previewContent: fileExp.state.previewContent,
                previewMode: fileExp.state.previewMode,
                fileLoadInfo: fileExp.state.fileLoadInfo
            });
            if (fileExp.state.pendingHighlight && fileExp.state.pendingHighlight.path === fileExp.normalizePath(filePath)) {
                const lineNumber = fileExp.state.pendingHighlight.line;
                fileExp.state.pendingHighlight = null;
                setTimeout(() => scrollToLine(fileExp.element, lineNumber), 0);
            } else {
                fileExp.state.pendingHighlight = null;
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
