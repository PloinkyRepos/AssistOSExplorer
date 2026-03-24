import { unescapeHtmlEntities } from "../../../imports.js";
import { stripAchilesComments as stripDocumentComments } from "../../../services/document/markdownDocumentParser.js";
import { highlightCode } from "../../../utils/highlight.js";

export function normalizePath(pathStr) {
    if (!pathStr) return '/';
    const parts = String(pathStr).split('/').filter(Boolean);
    return '/' + parts.join('/');
}

export function joinPath(base, name) {
    const cleanedBase = normalizePath(base);
    const target = cleanedBase === '/' ? name : `${cleanedBase}/${name}`;
    const segments = String(target).split('/').filter(Boolean);
    return '/' + segments.join('/');
}

export function parentPath(p) {
    const normalized = normalizePath(p);
    if (normalized === '/') return null;
    const segments = normalized.split('/').filter(Boolean);
    segments.pop();
    return segments.length ? `/${segments.join('/')}` : '/';
}

export function formatBytes(value) {
    if (!Number.isFinite(value) || value < 0) return '—';
    if (value === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const sized = value / Math.pow(1024, exponent);
    return `${sized.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function formatDate(value) {
    if (!value) return '—';
    try {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleString();
    } catch (_) {
        return value;
    }
}

export function sanitizeEntryName(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    if (!trimmed || trimmed === '.' || trimmed === '..' || /[\\/]/.test(trimmed)) {
        return null;
    }
    return trimmed;
}

export function splitFileName(fileName) {
    if (!fileName || typeof fileName !== 'string') {
        return { stem: '', ext: '' };
    }
    const lastDot = fileName.lastIndexOf('.');
    if (lastDot <= 0) {
        return { stem: fileName, ext: '' };
    }
    return {
        stem: fileName.slice(0, lastDot),
        ext: fileName.slice(lastDot)
    };
}

export function generateCopyName(baseName, existingNames = new Set(), fallbackEntries = []) {
    const names = existingNames instanceof Set
        ? new Set(existingNames)
        : new Set(Array.from(existingNames || []));
    if (!names.size && Array.isArray(fallbackEntries)) {
        fallbackEntries.forEach(entry => {
            if (entry?.name) {
                names.add(entry.name);
            }
        });
    }
    const safeBase = sanitizeEntryName(baseName) ?? baseName;
    if (!names.has(safeBase)) {
        return safeBase;
    }
    const { stem, ext } = splitFileName(safeBase);
    let index = 1;
    let candidate = '';
    do {
        const suffix = index === 1 ? ' copy' : ` copy ${index}`;
        candidate = `${stem}${suffix}${ext}`;
        index += 1;
    } while (names.has(candidate));
    return candidate;
}

export function parsePatterns(input) {
    if (!input || typeof input !== 'string') return [];
    return input
        .split(/[,\n]/)
        .map((part) => part.trim())
        .filter(Boolean);
}

export function groupMatchesByFile(matches = []) {
    const grouped = new Map();
    matches.forEach((item) => {
        const existing = grouped.get(item.path) || { path: item.path, count: 0, firstLine: null, preview: '' };
        existing.count += 1;
        if (existing.firstLine === null && item.line) {
            existing.firstLine = item.line;
        }
        if (!existing.preview && item.preview) {
            existing.preview = item.preview;
        }
        grouped.set(item.path, existing);
    });
    return Array.from(grouped.values());
}

export function parseDirectoryListing(text) {
    const lines = (text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const entries = lines.map(line => {
        const match = line.match(/^(?:<pre>)?\s*\[(DIR|FILE)\]\s+(.*)$/);
        if (!match) {
            return { name: line, type: 'unknown' };
        }
        return {
            name: match[2].trim(),
            type: match[1] === 'DIR' ? 'directory' : 'file'
        };
    });
    entries.sort((a, b) => {
        const order = { directory: 0, file: 1, unknown: 2 };
        const diff = (order[a.type] || 3) - (order[b.type] || 3);
        if (diff !== 0) return diff;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    return entries;
}

export function parseDetailedDirectoryListing(text) {
    if (!text) return [];
    if (Array.isArray(text)) {
        return text
            .filter(entry => entry && typeof entry.name === 'string')
            .map(entry => ({
                name: entry.name,
                type: entry.type === 'directory' || entry.type === 'file' ? entry.type : 'other',
                size: Number.isFinite(entry.size) ? entry.size : null,
                modified: typeof entry.modified === 'string' ? entry.modified : null,
                isSymlink: Boolean(entry.isSymlink),
                linkTarget: typeof entry.linkTarget === 'string' ? entry.linkTarget : null
            }));
    }
    try {
        let parsed = JSON.parse(text);
        if (typeof parsed === 'string') {
            try {
                parsed = JSON.parse(parsed);
            } catch {
                return [];
            }
        }
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter(entry => entry && typeof entry.name === 'string')
            .map(entry => ({
                name: entry.name,
                type: entry.type === 'directory' || entry.type === 'file' ? entry.type : 'other',
                size: Number.isFinite(entry.size) ? entry.size : null,
                modified: typeof entry.modified === 'string' ? entry.modified : null,
                isSymlink: Boolean(entry.isSymlink),
                linkTarget: typeof entry.linkTarget === 'string' ? entry.linkTarget : null
            }));
    } catch (error) {
        console.warn('Falling back to plain directory listing parsing.', error);
        return parseDirectoryListing(text);
    }
}

export function isMarkdownFile(path) {
    return typeof path === 'string' && /\.md$/i.test(path);
}

export function escapeCssId(value) {
    if (!value) return '';
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        return CSS.escape(value);
    }
    return value.replace(/([ !"#$%&'()*+,./:;<=>?@[\]^`{|}~])/g, '\\$1');
}

export function scrollPreviewToAnchor(previewRoot, targetId) {
    if (!previewRoot || !targetId) return;
    const selector = escapeCssId(targetId);
    const target = selector
        ? previewRoot.querySelector(`[id="${selector}"], a[name="${selector}"], a[href="#${selector}"]`)
        : null;
    if (!target) return;
    if (typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
        const container = previewRoot.parentElement || previewRoot;
        const offset = target.getBoundingClientRect().top - previewRoot.getBoundingClientRect().top;
        container.scrollTop += offset;
    }
}

export function getFileTypeFromPath(path) {
    if (!path || typeof path !== 'string') return '';
    const parts = path.split('.');
    if (parts.length < 2) return '';
    return parts.pop().toLowerCase();
}

const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tiff', 'tif'];
const audioExtensions = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'];
const videoExtensions = ['mp4', 'webm', 'ogv', 'mov', 'm4v', 'avi', 'mkv'];
const pdfExtensions = ['pdf'];

export function isImageFile(path) {
    const ext = getFileTypeFromPath(path);
    return imageExtensions.includes(ext);
}

export function isAudioFile(path) {
    const ext = getFileTypeFromPath(path);
    return audioExtensions.includes(ext);
}

export function isVideoFile(path) {
    const ext = getFileTypeFromPath(path);
    return videoExtensions.includes(ext);
}

export function isPdfFile(path) {
    const ext = getFileTypeFromPath(path);
    return pdfExtensions.includes(ext);
}

export function prepareMarkdownPreviewContent(rawText) {
    if (!rawText) return '';
    const unescaped = unescapeHtmlEntities(rawText);
    const cleaned = stripDocumentComments(unescaped);
    return cleaned.replace(/\u00A0/g, ' ');
}

export function renderMarkdownPreview(markdown) {
    if (!markdown) return '';
    const escapeHtml = (value) => value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    const renderInline = (value) => {
        let result = value;
        result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        result = result.replace(/(\*|_)([^*_]+?)\1/g, '<em>$2</em>');
        result = result.replace(/`([^`]+?)`/g, '<code>$1</code>');
        result = result.replace(/\[([^\]]+)]\(([^)]+)\)/g, (match, text, href) => {
            const isInternal = /^#/.test(href);
            const safeHref = escapeHtml(href);
            const safeText = escapeHtml(text);
            return isInternal
                ? `<a href="${safeHref}">${safeText}</a>`
                : `<a href="${safeHref}" target="_blank" rel="noopener">${safeText}</a>`;
        });
        return result;
    };

    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    const html = [];
    let activeList = null;
    let inCodeBlock = false;
    let codeLanguage = '';
    let paragraphBuffer = [];

    const flushParagraph = () => {
        if (!paragraphBuffer.length) return;
        const text = paragraphBuffer.join(' ');
        html.push(`<p>${renderInline(text)}</p>`);
        paragraphBuffer = [];
    };

    const closeActiveList = () => {
        if (!activeList) return;
        html.push(activeList.type === 'ol' ? '</ol>' : '</ul>');
        activeList = null;
    };

    const ensureList = (type, startNumber = 1) => {
        if (activeList?.type === type) return;
        closeActiveList();
        if (type === 'ol') {
            const startAttr = startNumber > 1 ? ` start="${startNumber}"` : '';
            html.push(`<ol${startAttr}>`);
        } else {
            html.push('<ul>');
        }
        activeList = { type };
    };

    const isTableRow = (line) => {
        const trimmed = (line || '').trim();
        if (!trimmed.includes('|')) return false;
        const pipes = (trimmed.match(/\|/g) || []).length;
        if (pipes < 2) return false;
        return /^\|?.*\|.*$/.test(trimmed);
    };
    const isTableDivider = (line) => {
        const trimmed = (line || '').trim();
        if (!trimmed.includes('|')) return false;
        const cells = trimmed.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
        return cells.length >= 2 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
    };
    const parseTableRow = (line) => {
        const trimmed = (line || '').trim();
        return trimmed
            .replace(/^\||\|$/g, '')
            .split('|')
            .map(cell => renderInline(escapeHtml(cell.trim())));
    };

    for (let idx = 0; idx < lines.length; idx += 1) {
        const rawLine = lines[idx];
        const line = rawLine.trimEnd();

        if (line.trim().startsWith('```')) {
            if (inCodeBlock) {
                html.push('</code></pre>');
                inCodeBlock = false;
                codeLanguage = '';
            } else {
                flushParagraph();
                closeActiveList();
                inCodeBlock = true;
                codeLanguage = line.trim().slice(3).trim();
                const langClass = codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : '';
                html.push(`<pre><code${langClass}>`);
            }
            continue;
        }

        if (inCodeBlock) {
            html.push(`${escapeHtml(rawLine)}\n`);
            continue;
        }

        if (/^\s*$/.test(line)) {
            flushParagraph();
            closeActiveList();
            continue;
        }

        if (isTableRow(line) && isTableDivider(lines[idx + 1] || '')) {
            flushParagraph();
            closeActiveList();
            const headerCells = parseTableRow(line);
            const bodyRows = [];
            idx += 2; // skip divider line as well
            while (idx < lines.length && isTableRow(lines[idx])) {
                bodyRows.push(parseTableRow(lines[idx]));
                idx += 1;
            }
            idx -= 1; // compensate for loop increment

            const headerHtml = headerCells.map(cell => `<th>${cell}</th>`).join('');
            const bodyHtml = bodyRows
                .map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`)
                .join('');

            html.push(`<table class="markdown-table"><thead><tr>${headerHtml}</tr></thead>${bodyRows.length ? `<tbody>${bodyHtml}</tbody>` : ''}</table>`);
            continue;
        }

        const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
        if (headingMatch) {
            flushParagraph();
            closeActiveList();
            const level = headingMatch[1].length;
            let headingContent = headingMatch[2].trim();
            const anchorMatch = headingContent.match(/\{#([^}]+)\}\s*$/);
            const anchorId = anchorMatch ? anchorMatch[1] : null;
            if (anchorMatch) {
                headingContent = headingContent.replace(/\s*\{#[^}]+\}\s*$/, '').trim();
            }
            const rendered = renderInline(escapeHtml(headingContent));
            const anchorHtml = anchorId ? `<a id="${escapeHtml(anchorId)}"></a>` : '';
            html.push(`${anchorHtml}<h${level}>${rendered}</h${level}>`);
            continue;
        }

        const listMatch = line.match(/^[-*+]\s+(.*)$/);
        if (listMatch) {
            flushParagraph();
            ensureList('ul');
            html.push(`<li>${renderInline(escapeHtml(listMatch[1]))}</li>`);
            continue;
        }

        const orderedMatch = line.match(/^\s*(\d+)\.\s+(.*)$/);
        if (orderedMatch) {
            flushParagraph();
            const startNumber = parseInt(orderedMatch[1], 10) || 1;
            ensureList('ol', startNumber);
            html.push(`<li>${renderInline(escapeHtml(orderedMatch[2]))}</li>`);
            continue;
        }

        paragraphBuffer.push(escapeHtml(line.trim()));
    }

    if (inCodeBlock) {
        html.push('</code></pre>');
    }
    closeActiveList();
    flushParagraph();

    return html.join('\n');
}

export function renderCodePreview(content, filePath) {
    const type = getFileTypeFromPath(filePath);
    const highlighted = highlightCode(content || '', type);
    const lines = (content || '').split('\n').length || 1;
    const lineNumbers = Array.from({ length: lines }, (_, idx) => `<span>${idx + 1}</span>`).join('');
    return `
        <div class="code-preview-lines">${lineNumbers}</div>
        <pre class="code-preview-code"><code class="language-${type}">${highlighted}</code></pre>
    `;
}

function ensureLineHighlight(container, top, height) {
    if (!container) return;
    let highlight = container.querySelector('.line-highlight');
    if (!highlight) {
        highlight = document.createElement('div');
        highlight.className = 'line-highlight';
        container.appendChild(highlight);
    }
    if (getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
    }
    highlight.style.top = `${top}px`;
    highlight.style.height = `${height}px`;
}

export function clearLineHighlight(rootElement) {
    if (!rootElement) return;
    rootElement.querySelectorAll('.line-highlight').forEach((el) => el.remove());
}

export function scrollToLine(rootElement, lineNumber) {
    if (!rootElement || !Number.isFinite(lineNumber) || lineNumber <= 0) {
        return false;
    }
    const linesColumn = rootElement.querySelector('.code-preview-lines');
    const codeColumn = rootElement.querySelector('.code-preview-code');
    const rawView = rootElement.querySelector('.markdown-raw-view');
    const previewBody = rootElement.querySelector('.preview-body');

    if (linesColumn && codeColumn) {
        const targetLine = linesColumn.querySelector(`span:nth-child(${lineNumber})`);
        if (!targetLine) return false;
        const lineHeight = Number.parseFloat(getComputedStyle(linesColumn).lineHeight)
            || Number.parseFloat(getComputedStyle(codeColumn).lineHeight)
            || 16;
        const linesPaddingTop = Number.parseFloat(getComputedStyle(linesColumn).paddingTop) || 0;
        const codePaddingTop = Number.parseFloat(getComputedStyle(codeColumn).paddingTop) || 0;
        const offsetTop = linesPaddingTop + (lineNumber - 1) * lineHeight;
        ensureLineHighlight(linesColumn, offsetTop, lineHeight);
        ensureLineHighlight(codeColumn, codePaddingTop + (lineNumber - 1) * lineHeight, lineHeight);
        if (typeof targetLine.scrollIntoView === 'function') {
            try {
                targetLine.scrollIntoView({ block: 'center', inline: 'nearest' });
            } catch (_) {
                // ignore scrollIntoView failures
            }
        }
        const codeScrollable = codeColumn.scrollHeight > codeColumn.clientHeight ? codeColumn : null;
        const linesScrollable = linesColumn.scrollHeight > linesColumn.clientHeight ? linesColumn : null;
        const bodyScrollable = previewBody && previewBody.scrollHeight > previewBody.clientHeight ? previewBody : null;
        if (linesScrollable) {
            linesScrollable.scrollTop = offsetTop - 20;
        }
        if (codeScrollable) {
            codeScrollable.scrollTop = linesScrollable ? linesScrollable.scrollTop : (offsetTop - 20);
        }
        if (!codeScrollable && bodyScrollable) {
            bodyScrollable.scrollTop = offsetTop - 20;
        }
        return true;
    }

    if (rawView) {
        const computed = window.getComputedStyle(rawView);
        const lineHeight = Number.parseFloat(computed.lineHeight) || 16;
        const paddingTop = Number.parseFloat(computed.paddingTop) || 0;
        const offsetTop = paddingTop + (lineNumber - 1) * lineHeight;
        ensureLineHighlight(rawView, offsetTop, lineHeight);
        const rawScrollable = rawView.scrollHeight > rawView.clientHeight ? rawView : null;
        const bodyScrollable = previewBody && previewBody.scrollHeight > previewBody.clientHeight ? previewBody : null;
        if (rawScrollable) {
            rawScrollable.scrollTop = offsetTop - 20;
        } else if (bodyScrollable) {
            bodyScrollable.scrollTop = offsetTop - 20;
        }
        return true;
    }
    return false;
}

let activeContextPasteCleanup = null;

export function showContextPasteMenu({ x, y, targetPath, hostElement }) {
    // Ensure only one paste context menu is visible at a time
    if (typeof activeContextPasteCleanup === 'function') {
        activeContextPasteCleanup();
    }

    const menu = document.createElement('div');
    menu.className = 'context-paste-menu';
    menu.style.position = 'fixed';
    menu.style.top = `${y}px`;
    menu.style.left = `${x}px`;
    const target = typeof targetPath === 'string' ? targetPath : '';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'context-paste-action';
    button.dataset.localAction = 'pasteClipboard';
    button.dataset.targetPath = target;
    button.textContent = 'Paste here';
    menu.appendChild(button);
    const mount = hostElement instanceof HTMLElement ? hostElement : document.body;
    mount.appendChild(menu);
    const cleanup = () => {
        menu.remove();
        document.removeEventListener('click', onOutside, true);
        if (activeContextPasteCleanup === cleanup) {
            activeContextPasteCleanup = null;
        }
    };
    const onOutside = (e) => {
        if (!menu.contains(e.target)) {
            cleanup();
        }
    };
    menu.addEventListener('click', () => {
        setTimeout(cleanup, 0);
    });
    document.addEventListener('click', onOutside, true);
    activeContextPasteCleanup = cleanup;
    return cleanup;
}
