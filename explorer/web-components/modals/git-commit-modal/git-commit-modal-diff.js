function escapeHtml(value) {
    return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function escapeHtmlKeepSpaces(value) {
    return escapeHtml(value).replaceAll(' ', '&nbsp;');
}

function parseHunkHeader(line) {
    // @@ -a,b +c,d @@ optional
    const match = /^@@\s+\-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(line);
    if (!match) return null;
    return {
        leftStart: Number.parseInt(match[1], 10),
        rightStart: Number.parseInt(match[3], 10)
    };
}

function formatLineNumber(n) {
    if (n === null || n === undefined) return '    ';
    const s = String(n);
    return s.length >= 4 ? s.slice(-4) : s.padStart(4, ' ');
}

function splitCommonParts(oldText, newText) {
    const a = String(oldText || '');
    const b = String(newText || '');
    const minLen = Math.min(a.length, b.length);
    let start = 0;
    while (start < minLen && a[start] === b[start]) start += 1;
    let end = 0;
    while (end < minLen - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end += 1;
    const aMid = a.slice(start, a.length - end);
    const bMid = b.slice(start, b.length - end);
    return {
        prefix: a.slice(0, start),
        oldMid: aMid,
        newMid: bMid,
        suffix: end ? a.slice(a.length - end) : ''
    };
}

function renderSplitLine({ lineNo, sign, text, type, highlight = null }) {
    const ln = `<span class="ln">${formatLineNumber(lineNo)}</span>`;
    const sg = `<span class="sg">${escapeHtml(sign || ' ')}</span>`;
    let body = '';
    if (highlight) {
        const { prefix, mid, suffix, midClass } = highlight;
        body = `${escapeHtmlKeepSpaces(prefix)}<span class="${midClass}">${escapeHtmlKeepSpaces(mid)}</span>${escapeHtmlKeepSpaces(suffix)}`;
    } else {
        body = escapeHtmlKeepSpaces(text || '');
    }
    return `<span class="diff-line ${type}">${ln}${sg}<span class="tx">${body}</span></span>`;
}

export function unifiedToSplitHtml(diffText) {
    const left = [];
    const right = [];

    let leftLine = null;
    let rightLine = null;

    const lines = String(diffText || '').split('\n');
    let i = 0;

    const meta = {
        diff: null,
        index: null,
        oldFile: null,
        newFile: null,
        hunks: 0
    };

    while (i < lines.length) {
        const raw = lines[i] ?? '';
        // Avoid emitting an extra trailing blank row that appears as `<span class="diff-line meta"></span>`.
        if (i === lines.length - 1 && raw === '') break;
        if (raw.startsWith('diff --git')) {
            meta.diff = raw;
            i += 1;
            continue;
        }
        if (raw.startsWith('index ')) {
            meta.index = raw;
            i += 1;
            continue;
        }
        if (raw.startsWith('--- ')) {
            meta.oldFile = raw;
            i += 1;
            continue;
        }
        if (raw.startsWith('+++ ')) {
            meta.newFile = raw;
            i += 1;
            continue;
        }

        const hunk = parseHunkHeader(raw);
        if (hunk) {
            leftLine = hunk.leftStart;
            rightLine = hunk.rightStart;
            meta.hunks += 1;
            i += 1;
            continue;
        }

        const ch = raw[0];
        if (ch === ' ') {
            const content = raw.slice(1);
            left.push(renderSplitLine({ lineNo: leftLine, sign: ' ', text: content, type: 'ctx' }));
            right.push(renderSplitLine({ lineNo: rightLine, sign: ' ', text: content, type: 'ctx' }));
            if (leftLine !== null) leftLine += 1;
            if (rightLine !== null) rightLine += 1;
            i += 1;
            continue;
        }

        if (ch === '-') {
            const removed = [];
            while (i < lines.length && (lines[i] || '')[0] === '-') {
                removed.push((lines[i] || '').slice(1));
                i += 1;
            }
            const added = [];
            while (i < lines.length && (lines[i] || '')[0] === '+') {
                added.push((lines[i] || '').slice(1));
                i += 1;
            }

            const max = Math.max(removed.length, added.length);
            for (let k = 0; k < max; k += 1) {
                const l = removed[k] ?? null;
                const r = added[k] ?? null;

                if (l !== null && r !== null) {
                    const parts = splitCommonParts(l, r);
                    left.push(renderSplitLine({
                        lineNo: leftLine,
                        sign: '-',
                        text: l,
                        type: 'remove',
                        highlight: { prefix: parts.prefix, mid: parts.oldMid, suffix: parts.suffix, midClass: 'chg chg-remove' }
                    }));
                    right.push(renderSplitLine({
                        lineNo: rightLine,
                        sign: '+',
                        text: r,
                        type: 'add',
                        highlight: { prefix: parts.prefix, mid: parts.newMid, suffix: parts.suffix, midClass: 'chg chg-add' }
                    }));
                    if (leftLine !== null) leftLine += 1;
                    if (rightLine !== null) rightLine += 1;
                } else if (l !== null) {
                    left.push(renderSplitLine({ lineNo: leftLine, sign: '-', text: l, type: 'remove' }));
                    right.push(renderSplitLine({ lineNo: null, sign: ' ', text: '', type: 'empty' }));
                    if (leftLine !== null) leftLine += 1;
                } else if (r !== null) {
                    left.push(renderSplitLine({ lineNo: null, sign: ' ', text: '', type: 'empty' }));
                    right.push(renderSplitLine({ lineNo: rightLine, sign: '+', text: r, type: 'add' }));
                    if (rightLine !== null) rightLine += 1;
                }
            }
            continue;
        }

        if (ch === '+') {
            const content = raw.slice(1);
            left.push(renderSplitLine({ lineNo: null, sign: ' ', text: '', type: 'empty' }));
            right.push(renderSplitLine({ lineNo: rightLine, sign: '+', text: content, type: 'add' }));
            if (rightLine !== null) rightLine += 1;
            i += 1;
            continue;
        }

        // Other / non-standard (keep it, but without cluttering split panes).
        i += 1;
    }

    return { leftHtml: left.join('\n'), rightHtml: right.join('\n'), meta };
}

export function stripUnifiedDiffFileHeaders(diffText) {
    const out = [];
    const lines = String(diffText || '').split('\n');
    for (const raw of lines) {
        if (!raw) continue;
        if (raw.startsWith('diff --git')) continue;
        if (raw.startsWith('index ')) continue;
        if (raw.startsWith('--- ')) continue;
        if (raw.startsWith('+++ ')) continue;
        out.push(raw);
    }
    return out.join('\n');
}

export function stripUnifiedDiffHeaders(diffText) {
    const out = [];
    const lines = stripUnifiedDiffFileHeaders(diffText).split('\n');
    for (const raw of lines) {
        if (!raw) continue;
        // Also drop hunk headers (WebStorm-like compact view).
        if (/^@@\s+\-/.test(raw)) continue;
        out.push(raw);
    }
    return out.join('\n');
}

export function summarizeUnifiedDiffMeta(meta) {
    if (!meta) return '';
    const parts = [];
    if (meta.oldFile && meta.newFile) {
        const oldPath = meta.oldFile.replace(/^---\s+/, '').trim();
        const newPath = meta.newFile.replace(/^\+\+\+\s+/, '').trim();
        if (oldPath && newPath) parts.push(`${oldPath} → ${newPath}`);
    }
    if (meta.index) {
        const idx = meta.index.replace(/^index\s+/, '').trim();
        if (idx) parts.push(idx);
    }
    if (meta.hunks) parts.push(`${meta.hunks} hunk${meta.hunks === 1 ? '' : 's'}`);
    return parts.join(' · ');
}
