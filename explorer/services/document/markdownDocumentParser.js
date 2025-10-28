const COMMENT_KEY_PREFIX = 'achiles-ide-';
const COMMENT_KEYS = {
    DOCUMENT: `${COMMENT_KEY_PREFIX}document`,
    CHAPTER: `${COMMENT_KEY_PREFIX}chapter`,
    PARAGRAPH: `${COMMENT_KEY_PREFIX}paragraph`
};
const ALLOWED_METADATA_FIELDS = {
    [COMMENT_KEYS.DOCUMENT]: [
        'id',
        'title',
        'infoText',
        'commands',
        'comments',
        'variables',
        'pluginState',
        'references',
        'attachments',
        'snapshots',
        'tasks',
        'version',
        'updatedAt'
    ],
    [COMMENT_KEYS.CHAPTER]: [
        'id',
        'title',
        'commands',
        'comments',
        'pluginState',
        'references',
        'attachments',
        'snapshots',
        'tasks',
        'variables'
    ],
    [COMMENT_KEYS.PARAGRAPH]: [
        'id',
        'type',
        'commands',
        'comments',
        'pluginState',
        'references',
        'attachments',
        'snapshots',
        'tasks',
        'variables',
        'title'
    ]
};
const DEFAULT_HEADING_LEVEL = 2;

const normalizeLineEndings = (value = '') => value.replace(/\r\n/g, '\n');

const decodeHtmlEntities = (value = '') => {
    if (typeof value !== 'string' || value.length === 0) {
        return value;
    }
    return value
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
};

const decodeMetadataValue = (value) => {
    if (typeof value === 'string') {
        return decodeHtmlEntities(value);
    }
    if (Array.isArray(value)) {
        return value.map((item) => decodeMetadataValue(item));
    }
    if (value && typeof value === 'object') {
        const result = {};
        Object.entries(value).forEach(([key, nestedValue]) => {
            result[key] = decodeMetadataValue(nestedValue);
        });
        return result;
    }
    return value;
};

const extractSpacing = (segment) => {
    const leadingMatch = segment.match(/^\s*/);
    const trailingMatch = segment.match(/\s*$/);
    const leading = leadingMatch ? leadingMatch[0] : '';
    const trailing = trailingMatch ? trailingMatch[0] : '';
    const core = segment.slice(leading.length, segment.length - trailing.length);

    return {
        leading,
        trailing,
        text: core
    };
};

const getMetadataComments = (text) => {
    if (!text) {
        return [];
    }
    const results = [];
    let searchIndex = 0;
    while (searchIndex < text.length) {
        const start = text.indexOf('<!--', searchIndex);
        if (start === -1) {
            break;
        }
        const end = text.indexOf('-->', start + 4);
        if (end === -1) {
            break;
        }
        const raw = text.slice(start + 4, end);
        const trimmed = raw.trim();
        let parsed = null;
        if (trimmed.length > 0) {
            try {
                parsed = JSON.parse(trimmed);
            } catch (error) {
                parsed = null;
            }
        }
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const keys = Object.keys(parsed).filter((key) => typeof key === 'string' && key.startsWith(COMMENT_KEY_PREFIX));
            if (keys.length === 1) {
                const key = keys[0];
                results.push({
                    key,
                    value: parsed[key],
                    start,
                    end: end + 3
                });
            }
        }
        searchIndex = end + 3;
    }
    return results;
};

const stripMetadataCommentBlocks = (text) => {
    if (!text) {
        return '';
    }
    const comments = getMetadataComments(text);
    if (comments.length === 0) {
        return text;
    }
    let result = '';
    let cursor = 0;
    comments.forEach(({ start, end }) => {
        result += text.slice(cursor, start);
        cursor = end;
    });
    result += text.slice(cursor);
    return result;
};

const pruneMetadataValue = (value) => {
    if (value === null || value === undefined) {
        return undefined;
    }
    if (typeof value === 'string') {
        return value.trim().length === 0 ? undefined : value;
    }
    if (Array.isArray(value)) {
        const prunedArray = value
            .map((item) => pruneMetadataValue(item))
            .filter((item) => item !== undefined);
        return prunedArray.length > 0 ? prunedArray : undefined;
    }
    if (typeof value === 'object') {
        const result = {};
        Object.entries(value).forEach(([key, nestedValue]) => {
            if (key === 'id') {
                if (nestedValue !== undefined && nestedValue !== null && String(nestedValue).trim() !== '') {
                    result[key] = nestedValue;
                }
                return;
            }
            const pruned = pruneMetadataValue(nestedValue);
            if (pruned !== undefined) {
                result[key] = pruned;
            }
        });
        return Object.keys(result).length > 0 ? result : undefined;
    }
    return value;
};

const pruneMetadata = (metadata) => {
    if (!metadata || typeof metadata !== 'object') {
        return null;
    }
    const result = {};
    Object.entries(metadata).forEach(([key, value]) => {
        if (key === 'id') {
            if (value !== undefined && value !== null && String(value).trim() !== '') {
                result[key] = value;
            }
            return;
        }
        const pruned = pruneMetadataValue(value);
        if (pruned !== undefined) {
            result[key] = pruned;
        }
    });
    if (!result.id && metadata.id && String(metadata.id).trim() !== '') {
        result.id = metadata.id;
    }
    return result.id ? result : null;
};

const ensureMetadataId = (metadata, fallbackId) => {
    const result = { ...(metadata || {}) };
    if (!result.id && fallbackId) {
        result.id = fallbackId;
    }
    return result;
};

const filterMetadataFields = (key, metadata) => {
    if (!metadata || typeof metadata !== 'object') {
        return metadata;
    }
    const allowed = ALLOWED_METADATA_FIELDS[key];
    if (!allowed || allowed.length === 0) {
        return metadata;
    }
    const filtered = {};
    allowed.forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(metadata, field)) {
            filtered[field] = decodeMetadataValue(metadata[field]);
        }
    });
    return filtered;
};

const createMetadataComment = (key, metadata) => {
    const filtered = filterMetadataFields(key, metadata);
    const pruned = pruneMetadata(filtered);
    if (!pruned) {
        return '';
    }
    const payload = {};
    payload[key] = pruned;
    return `<!-- ${JSON.stringify(payload)} -->\n`;
};

const parseParagraphBlocks = (content) => {
    const comments = getMetadataComments(content).filter((comment) => comment.key === COMMENT_KEYS.PARAGRAPH);
    if (comments.length === 0) {
        const spacing = extractSpacing(content);
        if (spacing.text.trim().length === 0) {
            return [];
        }
        return [{
            metadata: {},
            leading: decodeHtmlEntities(spacing.leading),
            text: decodeHtmlEntities(spacing.text),
            trailing: decodeHtmlEntities(spacing.trailing),
            hasMetadata: false,
            id: null
        }];
    }

    const paragraphs = [];
    comments.forEach((comment, index) => {
        const next = comments[index + 1];
        const segment = content.slice(comment.end, next ? next.start : content.length);
        const spacing = extractSpacing(segment);
        const rawMetadata = filterMetadataFields(COMMENT_KEYS.PARAGRAPH, { ...(comment.value ?? {}) });
        const paragraphId = rawMetadata.id ?? null;
        paragraphs.push({
            metadata: rawMetadata,
            leading: decodeHtmlEntities(spacing.leading),
            text: decodeHtmlEntities(spacing.text),
            trailing: decodeHtmlEntities(spacing.trailing),
            hasMetadata: true,
            id: paragraphId
        });
    });

    return paragraphs;
};

const parseChapterBlock = (chapterComment, block) => {
    const metadata = filterMetadataFields(COMMENT_KEYS.CHAPTER, { ...(chapterComment.value ?? {}) });
    const chapterId = metadata.id ?? null;
    const chapter = {
        id: chapterId,
        metadata,
        heading: {
            level: DEFAULT_HEADING_LEVEL,
            text: '',
            raw: ''
        },
        leading: '',
        paragraphs: []
    };

    if (!block || block.trim().length === 0) {
        return chapter;
    }

    const normalized = normalizeLineEndings(block);
    const lines = normalized.split('\n');

    let headingLineIndex = -1;
    for (let idx = 0; idx < lines.length; idx += 1) {
        const trimmed = lines[idx].trim();
        if (!trimmed) {
            continue;
        }
        if (/^#{1,6}\s+/.test(trimmed)) {
            headingLineIndex = idx;
            const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
            if (headingMatch) {
                chapter.heading.level = headingMatch[1].length;
                chapter.heading.text = decodeHtmlEntities(headingMatch[2].trim());
                chapter.heading.raw = lines[idx];
            }
            break;
        }
    }

    if (headingLineIndex === -1) {
        chapter.paragraphs = parseParagraphBlocks(normalized);
        if (!chapter.heading.text) {
            chapter.heading.text = 'Chapter';
        }
        if (chapter.heading.text && !chapter.metadata.title) {
            chapter.metadata.title = chapter.heading.text;
        }
        return chapter;
    }

    const leadingLines = lines.slice(0, headingLineIndex);
    chapter.leading = decodeHtmlEntities(leadingLines.join('\n'));

    const remainderLines = lines.slice(headingLineIndex + 1);
    const remainder = remainderLines.join('\n');
    chapter.paragraphs = parseParagraphBlocks(remainder);

    if (!chapter.heading.text) {
        chapter.heading.text = 'Chapter';
    }
    if (chapter.heading.text && !chapter.metadata.title) {
        chapter.metadata.title = chapter.heading.text;
    }

    return chapter;
};

const parseMarkdownDocument = (markdown) => {
    const text = normalizeLineEndings(markdown ?? '');
    const metadataComments = getMetadataComments(text);

    const documentComment = metadataComments.find((comment) => comment.key === COMMENT_KEYS.DOCUMENT);
    const chapterComments = metadataComments.filter((comment) => comment.key === COMMENT_KEYS.CHAPTER);

    const documentMetadata = documentComment ? filterMetadataFields(COMMENT_KEYS.DOCUMENT, { ...(documentComment.value ?? {}) }) : {};
    const documentId = documentMetadata.id ?? null;

    const prefaceStart = documentComment ? documentComment.end : 0;
    const firstChapterStart = chapterComments[0]?.start ?? text.length;
    const prefaceSegment = text.slice(prefaceStart, firstChapterStart);
    const preface = decodeHtmlEntities(stripMetadataCommentBlocks(prefaceSegment).trim());

    const chapters = chapterComments.map((chapterComment, index) => {
        const nextChapterStart = chapterComments[index + 1]?.start ?? text.length;
        const chapterBlock = text.slice(chapterComment.end, nextChapterStart);
        return parseChapterBlock(chapterComment, chapterBlock);
    });

    return {
        metadata: documentMetadata,
        preface,
        chapters,
        raw: text,
        documentId
    };
};

const composeParagraph = (paragraph) => {
    const leading = decodeHtmlEntities(paragraph.leading ?? '');
    const text = decodeHtmlEntities(paragraph.text ?? '');
    const trailing = decodeHtmlEntities(paragraph.trailing ?? '');
    const content = `${leading}${text}${trailing}`;
    return content.endsWith('\n') ? content : `${content}\n`;
};

const serializeMarkdownDocument = (document) => {
    if (!document) {
        return '';
    }

    const parts = [];

    const documentMetadata = ensureMetadataId(
        filterMetadataFields(COMMENT_KEYS.DOCUMENT, document.metadata ?? {}),
        document.metadata?.id
    );
    const documentComment = createMetadataComment(COMMENT_KEYS.DOCUMENT, documentMetadata);
    if (documentComment) {
        parts.push(documentComment);
    }

    if (document.preface) {
        const decodedPreface = decodeHtmlEntities(document.preface).trim();
        if (decodedPreface) {
            parts.push(`${decodedPreface}\n\n`);
        }
    }

    (document.chapters ?? []).forEach((chapter, index) => {
        if (index > 0) {
            parts.push('\n');
        }

        const chapterMetadata = ensureMetadataId(
            filterMetadataFields(COMMENT_KEYS.CHAPTER, chapter.metadata ?? {}),
            chapter.id
        );
        const chapterComment = createMetadataComment(COMMENT_KEYS.CHAPTER, chapterMetadata);
        if (chapterComment) {
            parts.push(chapterComment);
        }

        const headingLevel = Math.max(1, Math.min(6, chapter.heading?.level ?? DEFAULT_HEADING_LEVEL));
        const headingText = decodeHtmlEntities(chapter.heading?.text ?? chapter.metadata?.title ?? `Chapter ${index + 1}`);
        parts.push(`${'#'.repeat(headingLevel)} ${headingText}\n`);

        const leadingTrimmed = decodeHtmlEntities(chapter.leading ?? '').trim();
        if (leadingTrimmed) {
            parts.push(`${leadingTrimmed}\n`);
        }

        (chapter.paragraphs ?? []).forEach((paragraph) => {
            const paragraphMetadata = ensureMetadataId(
                filterMetadataFields(COMMENT_KEYS.PARAGRAPH, paragraph.metadata ?? {}),
                paragraph.id
            );
            const paragraphComment = createMetadataComment(COMMENT_KEYS.PARAGRAPH, paragraphMetadata);
            if (paragraphComment) {
                parts.push(paragraphComment);
            }
            parts.push(composeParagraph(paragraph));
        });
    });

    return parts.join('').replace(/\n{4,}/g, '\n\n\n');
};

const stripAchilesComments = (text) => {
    if (!text) {
        return '';
    }
    const withoutComments = stripMetadataCommentBlocks(text);
    return decodeHtmlEntities(normalizeLineEndings(withoutComments)).trim();
};

export default {
    parseMarkdownDocument,
    serializeMarkdownDocument,
    stripAchilesComments
};

export {
    parseMarkdownDocument,
    serializeMarkdownDocument,
    stripAchilesComments
};
