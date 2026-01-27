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
                modified: typeof entry.modified === 'string' ? entry.modified : null
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
                modified: typeof entry.modified === 'string' ? entry.modified : null
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

export function scrollToLine(rootElement, lineNumber) {
    if (!rootElement || !Number.isFinite(lineNumber) || lineNumber <= 0) {
        return;
    }
    const linesColumn = rootElement.querySelector('.code-preview-lines');
    const codeColumn = rootElement.querySelector('.code-preview-code');
    const targetLine = linesColumn?.querySelector(`span:nth-child(${lineNumber})`);
    if (!targetLine || !linesColumn || !codeColumn) {
        return;
    }
    const offsetTop = targetLine.offsetTop;
    const parent = linesColumn.parentElement;
    const codeParent = codeColumn.parentElement;
    if (parent) {
        parent.scrollTop = offsetTop - 20;
    }
    if (codeParent) {
        codeParent.scrollTop = offsetTop - 20;
    }
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
    menu.innerHTML = `<button type="button" class="context-paste-action" data-local-action="pasteClipboard" data-target-path="${target}">Paste here</button>`;
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

export function buildEntriesHTML(state, helpers) {
    const { joinPath, formatBytes, formatDate } = helpers;
    const folderIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-folder-fill" viewBox="0 0 16 16">
  <path d="M9.828 3h3.982a2 2 0 0 1 1.992 2.181l-.637 7A2 2 0 0 1 13.174 14H2.826a2 2 0 0 1-1.991-1.819l-.637-7a1.99 1.99 0 0 1 .342-1.31L.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3zm-8.322.12C1.72 3.042 1.95 3 2.19 3h5.396l-.707-.707A1 1 0 0 0 6.172 2H2.5a1 1 0 0 0-1 .981l.006.139z"/>
</svg>`;
    const fileIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-file-earmark-fill" viewBox="0 0 16 16">
  <path d="M4 0h5.5v1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5h1V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2z"/>
  <path d="M9.5 3.5 14 8V3.5A1.5 1.5 0 0 0 12.5 2H9.5v1.5z"/>
</svg>`;
    const rows = [];
    const clipboard = state.clipboard;
    const entries = state.entries || [];

    if (!entries.length) {
        return `<tr><td colspan="5">Empty directory.</td></tr>`;
    }

    entries.forEach((entry, index) => {
        const entryPath = entry?.path ? normalizePath(entry.path) : joinPath(state.path, entry.name);
        const icon = entry.type === 'directory' ? folderIcon : fileIcon;
        const entryAttributes = `data-entry-path="${entryPath}" data-type="${entry.type}"`;
        const isClipboardSource = clipboard?.path === entryPath;
        const clipboardAttr = isClipboardSource ? ` data-clipboard="${clipboard.mode}"` : '';
        const rowClasses = [];
        if (state.selectedPath === entryPath) {
            rowClasses.push('active');
        }
        const classAttr = rowClasses.length ? ` class="${rowClasses.join(' ')}"` : '';
        const isMenuOpen = state.openMenuPath === entryPath;
        const actionMenuClass = `action-menu-container${isMenuOpen ? ' open' : ''}`;
        const menuId = `action-menu-${index}`;
        const canPasteInto = Boolean(clipboard) && entry.type === 'directory';
        const pasteMenuItem = entry.type === 'directory' ? `
                            <button type="button" class="action-menu-item${canPasteInto ? '' : ' disabled'}" data-local-action="pasteClipboard" ${entryAttributes}
                                    data-target-path="${entryPath}" role="menuitem" ${canPasteInto ? '' : 'disabled'}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" class="action-menu-item-icon" viewBox="0 0 16 16" aria-hidden="true">
                                    <path d="M4 1.5A1.5 1.5 0 0 1 5.5 0h5A1.5 1.5 0 0 1 12 1.5V3h1.5A1.5 1.5 0 0 1 15 4.5v9A1.5 1.5 0 0 1 13.5 15h-7A1.5 1.5 0 0 1 5 13.5V12h3.5A1.5 1.5 0 0 0 10 10.5v-7A1.5 1.5 0 0 0 8.5 2H7V1.5A.5.5 0 0 0 6.5 1h-1a.5.5 0 0 0-.5.5V2H4v-.5z"/>
                                    <path d="M6.5 13a.5.5 0 0 1-.5-.5V5A1.5 1.5 0 0 1 7.5 3.5h1A1.5 1.5 0 0 1 10 5v5.5a.5.5 0 0 1-.5.5H6v1a.5.5 0 0 1-.5.5z"/>
                                </svg>
                                <span class="action-menu-item-label">Paste into</span>
                            </button>
            ` : '';
        rows.push(`
            <tr${classAttr}${clipboardAttr} data-entry-path="${entryPath}" data-type="${entry.type}">
                <td class="col-name" ${entryAttributes} data-local-action="selectEntry"><span class="icon">${icon}</span> ${entry.name}</td>
                <td class="col-type" ${entryAttributes} data-local-action="selectEntry">${entry.type}</td>
                <td class="col-size" ${entryAttributes} data-local-action="selectEntry">${entry.type === 'directory' ? '—' : formatBytes(entry.size)}</td>
                <td class="col-modified" ${entryAttributes} data-local-action="selectEntry">${entry.modified ? formatDate(entry.modified) : '—'}</td>
                <td class="actions-cell col-actions">
                    <div class="${actionMenuClass}" data-action-menu="true" data-entry-path="${entryPath}">
                        <button type="button" class="secondary action-menu-trigger" data-local-action="toggleActionMenu" ${entryAttributes}
                                aria-haspopup="true" aria-expanded="${isMenuOpen ? 'true' : 'false'}" aria-controls="${menuId}" title="More actions">
                            <img class="action-menu-trigger-icon" loading="lazy" src="./assets/icons/action-dots.svg" alt="More actions">
                        </button>
                        <div class="action-menu-dropdown" id="${menuId}" role="menu">
                            <button type="button" class="action-menu-item" data-local-action="renameEntry" ${entryAttributes} role="menuitem">
                                <img class="action-menu-item-icon" loading="lazy" src="./assets/icons/edit.svg" alt="">
                                <span class="action-menu-item-label">Rename</span>
                            </button>
                            <button type="button" class="action-menu-item" data-local-action="copyEntry" ${entryAttributes} role="menuitem">
                                <img class="action-menu-item-icon" loading="lazy" src="./assets/icons/copy.svg" alt="">
                                <span class="action-menu-item-label">Copy</span>
                            </button>
                            <button type="button" class="action-menu-item" data-local-action="cutEntry" ${entryAttributes} role="menuitem">
                                <img class="action-menu-item-icon" loading="lazy" src="./assets/icons/cut.svg" alt="">
                                <span class="action-menu-item-label">Cut</span>
                            </button>
                            ${pasteMenuItem}
                            <button type="button" class="action-menu-item destructive" data-local-action="deleteEntry" ${entryAttributes} role="menuitem">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" class="action-menu-item-icon" viewBox="0 0 16 16" aria-hidden="true">
                                    <path d="M5.5 5.5a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0v-6a.5.5 0 0 1 .5-.5zm2.5.5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0v-6zm3-.5a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0v-6a.5.5 0 0 1 .5-.5z"/>
                                    <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1h-1v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-1a1 1 0 0 1 0-2h4.5l1-1h3l1 1H14a1 1 0 0 1 1 1zm-3 1H4v9a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1V4z"/>
                                </svg>
                                <span class="action-menu-item-label">Delete</span>
                            </button>
                        </div>
                    </div>
                </td>
            </tr>`);
    });

    return rows.join('');
}
