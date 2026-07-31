const SUPPORTED_IMAGE_TYPES = new Map([
    ['image/png', 'png'],
    ['image/jpeg', 'jpg'],
    ['image/webp', 'webp'],
    ['image/gif', 'gif']
]);

export const MAX_MARKDOWN_IMAGE_BYTES = 20 * 1024 * 1024;

function splitPath(inputPath = '') {
    const normalized = String(inputPath || '').replace(/\\/g, '/').replace(/\/{2,}/g, '/');
    const slash = normalized.lastIndexOf('/');
    return {
        directory: slash >= 0 ? normalized.slice(0, slash) || '/' : '/',
        filename: slash >= 0 ? normalized.slice(slash + 1) : normalized
    };
}

function sanitizeBaseName(filename = '') {
    const withoutExtension = String(filename || '').replace(/\.[^.]*$/, '');
    const sanitized = withoutExtension
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return sanitized || 'image';
}

export function validateMarkdownImage(file) {
    if (!file) {
        throw new Error('Select an image first.');
    }
    const mime = String(file.type || '').toLowerCase();
    const extension = SUPPORTED_IMAGE_TYPES.get(mime);
    if (!extension) {
        throw new Error('Only PNG, JPEG, WebP, and GIF images are supported.');
    }
    if (!Number.isFinite(file.size) || file.size <= 0) {
        throw new Error('The selected image is empty.');
    }
    if (file.size > MAX_MARKDOWN_IMAGE_BYTES) {
        throw new Error('The selected image exceeds the 20 MB limit.');
    }
    return { extension, mime };
}

export function buildMarkdownImageTarget(documentPath, file, uniqueId = '') {
    const { extension } = validateMarkdownImage(file);
    const { directory, filename: documentName } = splitPath(documentPath);
    if (!documentName.toLowerCase().endsWith('.md')) {
        throw new Error('Markdown image upload requires a .md document path.');
    }
    const documentStem = sanitizeBaseName(documentName.replace(/\.md$/i, ''));
    const imageStem = sanitizeBaseName(file.name);
    const suffix = sanitizeBaseName(uniqueId).slice(0, 12);
    const assetDirectoryName = `${documentStem}.assets`;
    const assetDirectory = directory === '/'
        ? `/${assetDirectoryName}`
        : `${directory}/${assetDirectoryName}`;
    const storedName = `${imageStem}-${suffix}.${extension}`;
    return {
        assetDirectory,
        targetPath: `${assetDirectory}/${storedName}`,
        markdownPath: `./${assetDirectoryName}/${storedName}`,
        altText: imageStem.replace(/[-_]+/g, ' ').trim() || 'image'
    };
}

export function formatMarkdownDestination(value) {
    const destination = String(value || '').trim();
    if (!destination) {
        throw new Error('A URL or path is required.');
    }
    if (/[\s()]/.test(destination)) {
        return `<${destination.replace(/</g, '%3C').replace(/>/g, '%3E')}>`;
    }
    return destination.replace(/\\/g, '\\\\').replace(/\)/g, '\\)');
}

export function validateMarkdownLinkDestination(value) {
    const destination = String(value || '').trim();
    if (!destination) {
        throw new Error('Enter a link URL or relative path.');
    }
    if (/[\u0000-\u001F\u007F]/.test(destination)) {
        throw new Error('The link contains unsupported control characters.');
    }
    const scheme = destination.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase() || '';
    if (scheme && !['http', 'https', 'mailto', 'tel'].includes(scheme)) {
        throw new Error(`The ${scheme}: link scheme is not supported.`);
    }
    return destination;
}

export function escapeMarkdownLabel(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/([\[\]])/g, '\\$1');
}

export function buildMarkdownLink({ label = '', url = '', title = '' } = {}) {
    const destination = formatMarkdownDestination(validateMarkdownLinkDestination(url));
    const linkLabel = escapeMarkdownLabel(String(label || '').trim() || String(url || '').trim());
    const cleanTitle = String(title || '')
        .trim()
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');
    const titleSuffix = cleanTitle ? ` "${cleanTitle}"` : '';
    return `[${linkLabel}](${destination}${titleSuffix})`;
}

export function getEditorSelection(editor) {
    const focus = editor?.getSelection?.(false) || null;
    const anchor = editor?.getSelection?.(true) || focus;
    return focus && anchor
        ? { focus: { ...focus }, anchor: { ...anchor } }
        : null;
}

export function getSelectedEditorText(editor, selection) {
    if (!selection) return '';
    const content = String(editor?.getContent?.() || '');
    const lines = content.split('\n');
    const toOffset = ({ row, col }) => {
        let offset = 0;
        for (let index = 0; index < Math.min(row, lines.length); index += 1) {
            offset += lines[index].length + 1;
        }
        return offset + Math.max(0, col);
    };
    const first = toOffset(selection.focus);
    const second = toOffset(selection.anchor);
    return content.slice(Math.min(first, second), Math.max(first, second));
}

export function insertMarkdownAtSelection(editor, selection, markdown) {
    if (!editor || typeof editor.paste !== 'function') {
        throw new Error('Markdown editor is not ready.');
    }
    editor.e?.focus?.();
    if (selection && typeof editor.setSelection === 'function') {
        editor.setSelection(selection.focus, selection.anchor);
    } else {
        editor.restoreLastSelection?.();
    }
    editor.paste(String(markdown || ''));
}
