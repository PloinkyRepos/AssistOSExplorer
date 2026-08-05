import { parseMarkdownDocument, serializeMarkdownDocument } from '../../../services/document/markdownDocumentParser.js';
import { generateId } from '../../../services/document/idUtils.js';
import { createText, updateText } from './automerge-adapter.mjs';

export const STRUCTURAL_ID_WARNING = 'Structural IDs are managed by the system. Manual ID changes were ignored and the original IDs were preserved.';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function normalizeDocumentId(value = '') {
  const id = String(value || '').trim();
  if (!id) return '';
  return id.replace(/[^a-zA-Z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '');
}

function textValue(value = '') {
  if (value && typeof value.toString === 'function') {
    return value.toString();
  }
  return String(value ?? '');
}

function objectValue(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? cloneJson(value)
    : cloneJson(fallback);
}

function arrayValue(value) {
  return Array.isArray(value) ? cloneJson(value) : [];
}

function commentsValue(value) {
  const comments = objectValue(value, {});
  if (!Array.isArray(comments.messages)) {
    comments.messages = [];
  }
  return comments;
}

function metadataWithFields(source = {}, fields = []) {
  const metadata = objectValue(source.metadata, {});
  fields.forEach((field) => {
    if (source[field] !== undefined) {
      metadata[field] = cloneJson(source[field]);
    }
  });
  return metadata;
}

function exposeMetadataFields(target, metadata, fields = []) {
  fields.forEach((field) => {
    if (field === 'comments') {
      target.comments = commentsValue(metadata.comments);
    } else if ([
      'variables',
      'references',
      'attachments',
      'snapshots',
      'tasks'
    ].includes(field)) {
      target[field] = arrayValue(metadata[field]);
    } else if (field === 'pluginState') {
      target.pluginState = objectValue(metadata.pluginState, {});
    } else if (field === 'commands') {
      target.commands = textValue(metadata.commands);
    } else if (metadata[field] !== undefined) {
      target[field] = cloneJson(metadata[field]);
    }
  });
}

const DOCUMENT_METADATA_FIELDS = [
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
];

const CHAPTER_METADATA_FIELDS = [
  'title',
  'commands',
  'comments',
  'pluginState',
  'references',
  'attachments',
  'snapshots',
  'tasks',
  'variables',
  'anchorId'
];

const PARAGRAPH_METADATA_FIELDS = [
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
];

function nextUniqueId(preferredId, prefix, usedIds) {
  let id = normalizeDocumentId(preferredId);
  if (!id || usedIds.has(id)) {
    do {
      id = generateId(prefix);
    } while (usedIds.has(id));
  }
  usedIds.add(id);
  return id;
}

function warningBucket() {
  return {
    warnings: [],
    ignoredStructuralIdChanges: {
      document: 0,
      chapter: 0,
      paragraph: 0,
      duplicate: 0
    }
  };
}

function addIdWarning(bucket, type) {
  if (!bucket.warnings.includes(STRUCTURAL_ID_WARNING)) {
    bucket.warnings.push(STRUCTURAL_ID_WARNING);
  }
  if (Object.prototype.hasOwnProperty.call(bucket.ignoredStructuralIdChanges, type)) {
    bucket.ignoredStructuralIdChanges[type] += 1;
  }
}

function plainParagraph(paragraph = {}) {
  const metadata = metadataWithFields(paragraph, PARAGRAPH_METADATA_FIELDS);
  return {
    ...cloneJson(paragraph),
    text: textValue(paragraph.text),
    leading: textValue(paragraph.leading),
    trailing: textValue(paragraph.trailing),
    metadata
  };
}

function plainChapter(chapter = {}) {
  const metadata = metadataWithFields(chapter, CHAPTER_METADATA_FIELDS);
  return {
    ...cloneJson(chapter),
    heading: {
      ...(chapter.heading && typeof chapter.heading === 'object' ? cloneJson(chapter.heading) : {}),
      text: textValue(chapter.heading?.text)
    },
    leading: textValue(chapter.leading),
    metadata,
    paragraphs: Array.isArray(chapter.paragraphs)
      ? chapter.paragraphs.map(plainParagraph)
      : []
  };
}

export function materializeMarkdownModel(document = {}) {
  const metadata = metadataWithFields(document, DOCUMENT_METADATA_FIELDS);
  const documentId = normalizeDocumentId(document.documentId || document.id || metadata.id) || generateId('doc');
  metadata.id = documentId;
  const chapters = Array.isArray(document.chapters)
    ? document.chapters.map(plainChapter)
    : [];
  const model = {
    id: documentId,
    documentId,
    metadata,
    preface: textValue(document.preface),
    chapters,
    blocks: buildBlocks({
      documentId,
      metadata,
      preface: textValue(document.preface),
      chapters
    })
  };
  exposeMetadataFields(model, metadata, DOCUMENT_METADATA_FIELDS);
  model.chapters.forEach((chapter) => {
    exposeMetadataFields(chapter, chapter.metadata || {}, CHAPTER_METADATA_FIELDS);
    chapter.paragraphs.forEach((paragraph) => {
      exposeMetadataFields(paragraph, paragraph.metadata || {}, PARAGRAPH_METADATA_FIELDS);
    });
  });
  return model;
}

export function serializeMarkdownState(document = {}) {
  return serializeMarkdownDocument(materializeMarkdownModel(document));
}

function isScriptaMetadataComment(comment = '') {
  const body = String(comment || '').replace(/^<!--|-->$/g, '').trim();
  if (/^<achilles-ide-references>$/i.test(body)) return true;
  if (!body.startsWith('{') || !body.endsWith('}')) return false;
  try {
    const parsed = JSON.parse(body);
    return parsed !== null
      && typeof parsed === 'object'
      && !Array.isArray(parsed)
      && Object.keys(parsed).some((key) => [
        'achilles-ide-document',
        'achilles-ide-chapter',
        'achilles-ide-paragraph',
        'achilles-ide-toc',
        'achilles-ide-references',
      ].includes(key));
  } catch {
    return false;
  }
}

export function stripScriptaMetadataComments(markdown = '') {
  return String(markdown || '').replace(
    /<!--[\s\S]*?-->/g,
    (comment) => (isScriptaMetadataComment(comment) ? '' : comment)
  );
}

export function serializeMarkdownContent(document = {}) {
  const model = materializeMarkdownModel(document);
  const body = stripScriptaMetadataComments(serializeMarkdownState(model))
    .replace(/<a\s+id="chapter-[^"]+"><\/a>\s*/g, '')
    .trim();
  if (/^#(?!#)\s+\S/.test(body)) return body;
  const title = String(model.metadata?.title || model.title || 'Untitled').trim() || 'Untitled';
  return `# ${title}${body ? `\n\n${body}` : ''}`;
}

export function parseMarkdownState(markdown, existingState = null) {
  const bucket = warningBucket();
  const parsed = parseMarkdownDocument(String(markdown ?? ''));
  const existing = existingState ? materializeMarkdownModel(existingState) : null;
  const usedIds = new Set();

  const parsedMetadata = parsed.metadata && typeof parsed.metadata === 'object'
    ? cloneJson(parsed.metadata)
    : {};
  const existingDocumentId = existing?.documentId ? normalizeDocumentId(existing.documentId) : '';
  const parsedDocumentId = normalizeDocumentId(parsedMetadata.id || parsed.documentId);
  const documentId = existingDocumentId || parsedDocumentId || generateId('doc');
  if (existingDocumentId && parsedDocumentId && parsedDocumentId !== existingDocumentId) {
    addIdWarning(bucket, 'document');
  }
  usedIds.add(documentId);
  parsedMetadata.id = documentId;

  const chapterIds = new Set();
  const paragraphIds = new Set();
  const chapters = (Array.isArray(parsed.chapters) ? parsed.chapters : []).map((chapter, chapterIndex) => {
    const previousChapter = existing?.chapters?.[chapterIndex] || null;
    const chapterMetadata = chapter.metadata && typeof chapter.metadata === 'object'
      ? cloneJson(chapter.metadata)
      : {};
    const parsedChapterId = normalizeDocumentId(chapter.id || chapterMetadata.id);
    let chapterId = normalizeDocumentId(previousChapter?.id || previousChapter?.metadata?.id);
    if (chapterId) {
      if (parsedChapterId && parsedChapterId !== chapterId) {
        addIdWarning(bucket, 'chapter');
      }
      if (chapterIds.has(chapterId)) {
        addIdWarning(bucket, 'duplicate');
        chapterId = '';
      }
    }
    chapterId = nextUniqueId(chapterId || parsedChapterId, 'chapter', chapterIds);
    chapterMetadata.id = chapterId;

    const paragraphs = (Array.isArray(chapter.paragraphs) ? chapter.paragraphs : []).map((paragraph, paragraphIndex) => {
      const previousParagraph = previousChapter?.paragraphs?.[paragraphIndex] || null;
      const paragraphMetadata = paragraph.metadata && typeof paragraph.metadata === 'object'
        ? cloneJson(paragraph.metadata)
        : {};
      const parsedParagraphId = normalizeDocumentId(paragraph.id || paragraphMetadata.id);
      let paragraphId = normalizeDocumentId(previousParagraph?.id || previousParagraph?.metadata?.id);
      if (paragraphId) {
        if (parsedParagraphId && parsedParagraphId !== paragraphId) {
          addIdWarning(bucket, 'paragraph');
        }
        if (paragraphIds.has(paragraphId)) {
          addIdWarning(bucket, 'duplicate');
          paragraphId = '';
        }
      }
      paragraphId = nextUniqueId(paragraphId || parsedParagraphId, 'paragraph', paragraphIds);
      paragraphMetadata.id = paragraphId;
      return {
        ...plainParagraph(paragraph),
        id: paragraphId,
        metadata: paragraphMetadata
      };
    });

    return {
      ...plainChapter(chapter),
      id: chapterId,
      metadata: chapterMetadata,
      paragraphs
    };
  });

  const model = {
    id: documentId,
    documentId,
    metadata: parsedMetadata,
    preface: textValue(parsed.preface),
    chapters,
    blocks: []
  };
  model.blocks = buildBlocks(model);
  const normalizedModel = materializeMarkdownModel(model);
  return {
    model: normalizedModel,
    warnings: bucket.warnings,
    ignoredStructuralIdChanges: bucket.ignoredStructuralIdChanges
  };
}

export function buildBlocks(model = {}) {
  const blocks = [{
    id: `${model.documentId}:document`,
    type: 'document-metadata',
    documentId: model.documentId
  }];
  if (model.preface) {
    blocks.push({
      id: `${model.documentId}:preface`,
      type: 'preface'
    });
  }
  (model.chapters || []).forEach((chapter) => {
    blocks.push({
      id: chapter.id,
      type: 'chapter',
      chapterId: chapter.id
    });
    (chapter.paragraphs || []).forEach((paragraph) => {
      blocks.push({
        id: paragraph.id,
        type: 'paragraph',
        chapterId: chapter.id,
        paragraphId: paragraph.id
      });
    });
  });
  return blocks;
}

export function writeMarkdownModelToDraft(draft, model) {
  const normalized = materializeMarkdownModel(model);
  draft.schemaVersion = 2;
  draft.documentId = normalized.documentId;
  draft.id = normalized.documentId;
  draft.metadata = cloneJson(normalized.metadata);
  draft.preface = createText(normalized.preface || '');
  draft.chapters = normalized.chapters.map((chapter) => ({
    id: chapter.id,
    metadata: cloneJson(chapter.metadata || {}),
    heading: {
      ...(chapter.heading || {}),
      text: createText(chapter.heading?.text || '')
    },
    leading: createText(chapter.leading || ''),
    paragraphs: (chapter.paragraphs || []).map((paragraph) => ({
      id: paragraph.id,
      metadata: cloneJson(paragraph.metadata || {}),
      leading: createText(paragraph.leading || ''),
      text: createText(paragraph.text || ''),
      trailing: createText(paragraph.trailing || ''),
      hasMetadata: Boolean(paragraph.hasMetadata)
    }))
  }));
  draft.blocks = cloneJson(normalized.blocks);
  delete draft.markdownText;
}

function updateDraftText(draft, path, value) {
  updateText(draft, path, String(value ?? ''));
}

function makeDraftParagraph(paragraph) {
  return {
    id: paragraph.id,
    metadata: cloneJson(paragraph.metadata || {}),
    leading: createText(paragraph.leading || ''),
    text: createText(paragraph.text || ''),
    trailing: createText(paragraph.trailing || ''),
    hasMetadata: Boolean(paragraph.hasMetadata)
  };
}

function makeDraftChapter(chapter) {
  return {
    id: chapter.id,
    metadata: cloneJson(chapter.metadata || {}),
    heading: {
      ...(chapter.heading || {}),
      text: createText(chapter.heading?.text || '')
    },
    leading: createText(chapter.leading || ''),
    paragraphs: (chapter.paragraphs || []).map(makeDraftParagraph)
  };
}

function updateParagraphsInDraft(draft, chapterIndex, draftChapter, nextParagraphs) {
  const current = Array.isArray(draftChapter.paragraphs) ? draftChapter.paragraphs : [];
  const sameShape = current.length === nextParagraphs.length
    && nextParagraphs.every((paragraph, index) => current[index]?.id === paragraph.id);
  if (!sameShape) {
    draftChapter.paragraphs = nextParagraphs.map(makeDraftParagraph);
    return;
  }
  nextParagraphs.forEach((paragraph, index) => {
    const draftParagraph = draftChapter.paragraphs[index];
    draftParagraph.id = paragraph.id;
    draftParagraph.metadata = cloneJson(paragraph.metadata || {});
    updateDraftText(draft, ['chapters', chapterIndex, 'paragraphs', index, 'leading'], paragraph.leading || '');
    updateDraftText(draft, ['chapters', chapterIndex, 'paragraphs', index, 'text'], paragraph.text || '');
    updateDraftText(draft, ['chapters', chapterIndex, 'paragraphs', index, 'trailing'], paragraph.trailing || '');
    draftParagraph.hasMetadata = Boolean(paragraph.hasMetadata);
  });
}

export function updateMarkdownModelInDraft(draft, model) {
  const normalized = materializeMarkdownModel(model);
  draft.schemaVersion = 2;
  draft.documentId = normalized.documentId;
  draft.id = normalized.documentId;
  draft.metadata = cloneJson(normalized.metadata);
  updateDraftText(draft, ['preface'], normalized.preface || '');

  const currentChapters = Array.isArray(draft.chapters) ? draft.chapters : [];
  const sameChapterShape = currentChapters.length === normalized.chapters.length
    && normalized.chapters.every((chapter, index) => currentChapters[index]?.id === chapter.id);
  if (!sameChapterShape) {
    draft.chapters = normalized.chapters.map(makeDraftChapter);
  } else {
    normalized.chapters.forEach((chapter, index) => {
      const draftChapter = draft.chapters[index];
      draftChapter.id = chapter.id;
      draftChapter.metadata = cloneJson(chapter.metadata || {});
      draftChapter.heading = {
        ...(chapter.heading || {}),
        text: draftChapter.heading?.text ?? ''
      };
      updateDraftText(draft, ['chapters', index, 'heading', 'text'], chapter.heading?.text || '');
      updateDraftText(draft, ['chapters', index, 'leading'], chapter.leading || '');
      updateParagraphsInDraft(draft, index, draftChapter, chapter.paragraphs || []);
    });
  }
  draft.blocks = cloneJson(normalized.blocks);
  delete draft.markdownText;
}
