import { generateId } from '../../../services/document/idUtils.js';
import {
  changeDocument,
  createText,
  createDocument,
  getDocumentHeads,
  loadDocument,
  mergeDocuments,
  saveDocument
} from './automerge-adapter.mjs';
import {
  materializeMarkdownModel,
  parseMarkdownState,
  serializeMarkdownState,
  updateMarkdownModelInDraft,
  writeMarkdownModelToDraft
} from './markdown-crdt-model.mjs';

const STORE_ROOT = ['.ploinky', 'data', 'explorer', 'automerge', 'documents'];

function isMarkdownPath(filePath, pathApi) {
  return pathApi.extname(String(filePath || '')).toLowerCase() === '.md';
}

function normalizeDocumentId(value = '') {
  const id = String(value || '').trim();
  if (!id) return '';
  return id.replace(/[^a-zA-Z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '');
}

async function pathExists(fsApi, filePath) {
  try {
    await fsApi.access(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function getVersionKey(stats) {
  if (!stats) return '';
  return `${Math.round(stats.mtimeMs)}:${stats.size}`;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function ensureDocumentId(model) {
  return materializeMarkdownModel(model || {});
}

function modelFromMarkdown(markdown) {
  return parseMarkdownState(String(markdown ?? '')).model;
}

function markdownFromModel(model) {
  return serializeMarkdownState(model);
}

function markdownFromDocument(document) {
  return serializeMarkdownState(document);
}

function documentIdFromState(document) {
  return normalizeDocumentId(document?.documentId || document?.metadata?.id || document?.id);
}

function applyTextDelta(baseText, change) {
  const base = String(baseText ?? '');
  const from = Math.max(0, Math.min(base.length, Number.parseInt(String(change.from ?? 0), 10) || 0));
  const deleteCount = Math.max(0, Number.parseInt(String(change.deleteCount ?? 0), 10) || 0);
  const end = Math.min(base.length, from + deleteCount);
  return `${base.slice(0, from)}${String(change.insertText ?? '')}${base.slice(end)}`;
}

function normalizePosition(list, position) {
  const items = Array.isArray(list) ? list : [];
  if (position === null || typeof position === 'undefined') return items.length;
  const parsed = Number.parseInt(String(position), 10);
  if (!Number.isFinite(parsed)) return items.length;
  return Math.max(0, Math.min(items.length, parsed));
}

function findChapter(model, chapterId) {
  return (model.chapters || []).find((chapter) => chapter.id === chapterId) || null;
}

function findParagraph(model, chapterId, paragraphId) {
  const chapter = findChapter(model, chapterId);
  if (!chapter) return { chapter: null, paragraph: null, index: -1 };
  const index = (chapter.paragraphs || []).findIndex((paragraph) => paragraph.id === paragraphId);
  return {
    chapter,
    paragraph: index >= 0 ? chapter.paragraphs[index] : null,
    index
  };
}

function copyModelToDraft(draft, model) {
  updateMarkdownModelInDraft(draft, model);
}

function copyMarkdownToDraft(draft, markdown, existingState = null) {
  const text = String(markdown ?? '');
  const { model, warnings, ignoredStructuralIdChanges } = parseMarkdownState(text, existingState);
  copyModelToDraft(draft, model);
  draft.warnings = warnings;
  draft.ignoredStructuralIdChanges = ignoredStructuralIdChanges;
}

function updateModelMetadata(model, patch = {}) {
  const currentId = normalizeDocumentId(model.documentId || model.id || model.metadata?.id) || generateId('doc');
  const metadataPatch = {
    ...(patch.metadata && typeof patch.metadata === 'object' ? patch.metadata : patch)
  };
  delete metadataPatch.id;
  model.metadata = {
    ...(model.metadata || {}),
    ...cloneJson(metadataPatch),
    id: currentId
  };
  if (typeof patch.title === 'string') {
    model.metadata.title = patch.title;
  }
  if (typeof patch.infoText === 'string') {
    model.metadata.infoText = patch.infoText;
  }
  model.documentId = currentId;
  model.id = model.documentId;
}

function applySemanticOperation(model, change) {
  const type = String(change.type || '');
  if (type === 'replaceDocumentFromMarkdown') {
    return modelFromMarkdown(change.markdown ?? '');
  }
  if (type === 'replaceDocumentModel') {
    return ensureDocumentId(change.model && typeof change.model === 'object' ? change.model : model);
  }
  if (type === 'updateDocument' || type === 'updateDocumentMetadata') {
    updateModelMetadata(model, change);
    return model;
  }
  if (type === 'addChapter') {
    const chapter = cloneJson(change.chapter || {});
    if (!chapter.id) chapter.id = chapter.metadata?.id || generateId('chapter');
    chapter.metadata = { ...(chapter.metadata || {}), id: chapter.id };
    chapter.paragraphs = Array.isArray(chapter.paragraphs) ? chapter.paragraphs : [];
    const position = normalizePosition(model.chapters, change.position);
    model.chapters.splice(position, 0, chapter);
    return model;
  }
  if (type === 'deleteChapter') {
    const index = model.chapters.findIndex((chapter) => chapter.id === change.chapterId);
    if (index < 0) throw new Error(`Chapter ${change.chapterId || ''} not found.`);
    model.chapters.splice(index, 1);
    return model;
  }
  if (type === 'reorderChapter') {
    const index = model.chapters.findIndex((chapter) => chapter.id === change.chapterId);
    if (index < 0) throw new Error(`Chapter ${change.chapterId || ''} not found.`);
    const [chapter] = model.chapters.splice(index, 1);
    model.chapters.splice(normalizePosition(model.chapters, change.position), 0, chapter);
    return model;
  }
  if (type === 'updateChapter') {
    const chapter = findChapter(model, change.chapterId);
    if (!chapter) throw new Error(`Chapter ${change.chapterId || ''} not found.`);
    if (change.patch && typeof change.patch === 'object') {
      Object.assign(chapter, cloneJson(change.patch));
    }
    if (typeof change.title === 'string') {
      chapter.metadata = { ...(chapter.metadata || {}), title: change.title };
      chapter.heading = { ...(chapter.heading || {}), text: change.title };
    }
    if (change.metadata && typeof change.metadata === 'object') {
      chapter.metadata = { ...(chapter.metadata || {}), ...cloneJson(change.metadata), id: chapter.id };
    }
    return model;
  }
  if (type === 'addParagraph') {
    const chapter = findChapter(model, change.chapterId);
    if (!chapter) throw new Error(`Chapter ${change.chapterId || ''} not found.`);
    chapter.paragraphs = Array.isArray(chapter.paragraphs) ? chapter.paragraphs : [];
    const paragraph = cloneJson(change.paragraph || {});
    if (!paragraph.id) paragraph.id = paragraph.metadata?.id || generateId('paragraph');
    paragraph.metadata = { ...(paragraph.metadata || {}), id: paragraph.id };
    chapter.paragraphs.splice(normalizePosition(chapter.paragraphs, change.position), 0, paragraph);
    return model;
  }
  if (type === 'deleteParagraph') {
    const { chapter, index } = findParagraph(model, change.chapterId, change.paragraphId);
    if (!chapter || index < 0) throw new Error(`Paragraph ${change.paragraphId || ''} not found.`);
    chapter.paragraphs.splice(index, 1);
    return model;
  }
  if (type === 'reorderParagraph') {
    const { chapter, index } = findParagraph(model, change.chapterId, change.paragraphId);
    if (!chapter || index < 0) throw new Error(`Paragraph ${change.paragraphId || ''} not found.`);
    const [paragraph] = chapter.paragraphs.splice(index, 1);
    chapter.paragraphs.splice(normalizePosition(chapter.paragraphs, change.position), 0, paragraph);
    return model;
  }
  if (type === 'updateParagraph') {
    const { paragraph } = findParagraph(model, change.chapterId, change.paragraphId);
    if (!paragraph) throw new Error(`Paragraph ${change.paragraphId || ''} not found.`);
    if (change.patch && typeof change.patch === 'object') {
      Object.assign(paragraph, cloneJson(change.patch));
    }
    if (typeof change.text === 'string') {
      paragraph.text = change.text;
    }
    if (change.metadata && typeof change.metadata === 'object') {
      paragraph.metadata = { ...(paragraph.metadata || {}), ...cloneJson(change.metadata), id: paragraph.id };
    }
    return model;
  }
  if (type === 'updateMetadata') {
    if (change.target === 'chapter') {
      const chapter = findChapter(model, change.chapterId);
      if (!chapter) throw new Error(`Chapter ${change.chapterId || ''} not found.`);
      chapter.metadata = { ...(chapter.metadata || {}), ...cloneJson(change.metadata || {}), id: chapter.id };
      return model;
    }
    if (change.target === 'paragraph') {
      const { paragraph } = findParagraph(model, change.chapterId, change.paragraphId);
      if (!paragraph) throw new Error(`Paragraph ${change.paragraphId || ''} not found.`);
      paragraph.metadata = { ...(paragraph.metadata || {}), ...cloneJson(change.metadata || {}), id: paragraph.id };
      return model;
    }
    updateModelMetadata(model, change.metadata || {});
    return model;
  }
  throw new Error(`Unsupported Markdown CRDT change type '${type}'.`);
}

function makeDraftParagraphFromChange(paragraph = {}) {
  const id = normalizeDocumentId(paragraph.id || paragraph.metadata?.id) || generateId('paragraph');
  return {
    id,
    metadata: {
      ...(paragraph.metadata && typeof paragraph.metadata === 'object' ? cloneJson(paragraph.metadata) : {}),
      id
    },
    leading: createText(paragraph.leading || ''),
    text: createText(paragraph.text || ''),
    trailing: createText(paragraph.trailing || '\n\n'),
    hasMetadata: true
  };
}

function makeDraftChapterFromChange(chapter = {}) {
  const id = normalizeDocumentId(chapter.id || chapter.metadata?.id) || generateId('chapter');
  const metadata = {
    ...(chapter.metadata && typeof chapter.metadata === 'object' ? cloneJson(chapter.metadata) : {}),
    id
  };
  return {
    id,
    metadata,
    heading: {
      ...(chapter.heading && typeof chapter.heading === 'object' ? cloneJson(chapter.heading) : {}),
      level: chapter.heading?.level || 2,
      text: createText(chapter.heading?.text || metadata.title || 'Chapter')
    },
    leading: createText(chapter.leading || ''),
    paragraphs: Array.isArray(chapter.paragraphs)
      ? chapter.paragraphs.map(makeDraftParagraphFromChange)
      : []
  };
}

export function createMarkdownCrdtStore({
  fs,
  path,
  workspaceRoot,
  validatePath,
  writeFileContent,
  invalidateCachesForPath
}) {
  const storeRoot = path.join(workspaceRoot, ...STORE_ROOT);

  function statePathForDocumentId(documentId) {
    const safeId = normalizeDocumentId(documentId);
    if (!safeId) throw new Error('Invalid Markdown CRDT document id.');
    return path.join(storeRoot, `${safeId}.automerge`);
  }

  async function readAutomergeState(documentId) {
    const statePath = statePathForDocumentId(documentId);
    if (!await pathExists(fs, statePath)) return null;
    const binary = await fs.readFile(statePath);
    return loadDocument(binary);
  }

  async function readAutomergeStateByPath(validPath) {
    if (!await pathExists(fs, storeRoot)) return null;
    const entries = await fs.readdir(storeRoot);
    for (const entry of entries) {
      if (!entry.endsWith('.automerge')) continue;
      const statePath = path.join(storeRoot, entry);
      const document = loadDocument(await fs.readFile(statePath));
      if (document?.path === validPath) {
        return document;
      }
    }
    return null;
  }

  async function writeAutomergeState(document) {
    await fs.mkdir(storeRoot, { recursive: true });
    const statePath = statePathForDocumentId(document.documentId);
    await fs.writeFile(statePath, Buffer.from(saveDocument(document)));
  }

  async function readMarkdownFile(validPath) {
    const raw = await fs.readFile(validPath, 'utf8');
    const stats = await fs.stat(validPath);
    return { raw, stats, versionKey: getVersionKey(stats) };
  }

  async function initializeDocument(validPath) {
    const { raw, versionKey } = await readMarkdownFile(validPath);
    const { model, warnings, ignoredStructuralIdChanges } = parseMarkdownState(raw);
    let document = createDocument({});
    document = changeDocument(document, (draft) => {
      writeMarkdownModelToDraft(draft, model);
      draft.path = validPath;
      draft.fileVersionKey = versionKey;
      draft.lastSavedMarkdown = raw;
      draft.reviewItems = [];
      draft.warnings = warnings;
      draft.ignoredStructuralIdChanges = ignoredStructuralIdChanges;
      draft.updatedAt = new Date().toISOString();
    });
    await writeAutomergeState(document);
    return document;
  }

  async function loadByPath(inputPath) {
    const validPath = await validatePath(inputPath);
    if (!isMarkdownPath(validPath, path)) {
      throw new Error('Markdown CRDT tools only support .md files.');
    }
    const { raw, versionKey } = await readMarkdownFile(validPath);
    const parsed = parseMarkdownState(raw).model;
    let document = await readAutomergeState(parsed.metadata.id) || await readAutomergeStateByPath(validPath);
    if (!document) {
      return await initializeDocument(validPath);
    }
    if (document.schemaVersion !== 2 || !Array.isArray(document.blocks)) {
      return await initializeDocument(validPath);
    }
    if (document.path !== validPath || document.fileVersionKey !== versionKey) {
      document = await syncFromMarkdown(document, validPath, raw, versionKey);
    }
    return document;
  }

  async function loadByDocumentId(documentId) {
    const document = await readAutomergeState(documentId);
    if (!document) {
      throw new Error(`Markdown CRDT document '${documentId}' was not found.`);
    }
    return document;
  }

  async function syncFromMarkdown(document, validPath, markdown, versionKey) {
    const currentMarkdown = markdownFromDocument(document);
    const lastSavedMarkdown = String(document.lastSavedMarkdown ?? currentMarkdown);
    if (markdown === currentMarkdown || markdown === lastSavedMarkdown) {
      const synced = changeDocument(document, (draft) => {
        draft.path = validPath;
        draft.fileVersionKey = versionKey;
        draft.lastSavedMarkdown = markdown;
        draft.updatedAt = new Date().toISOString();
      });
      await writeAutomergeState(synced);
      return synced;
    }

    if (currentMarkdown === lastSavedMarkdown) {
      const imported = changeDocument(document, (draft) => {
        copyMarkdownToDraft(draft, markdown, document);
        draft.path = validPath;
        draft.fileVersionKey = versionKey;
        draft.lastSavedMarkdown = markdown;
        draft.reviewItems = [];
        draft.updatedAt = new Date().toISOString();
      });
      await writeAutomergeState(imported);
      return imported;
    }

    const reviewItem = {
      id: generateId('markdown-review'),
      type: 'external-file-change',
      path: validPath,
      versionKey,
      markdown,
      createdAt: new Date().toISOString()
    };
    const marked = changeDocument(document, (draft) => {
      draft.path = validPath;
      draft.fileVersionKey = versionKey;
      draft.reviewItems = [...(draft.reviewItems || []), reviewItem];
      draft.updatedAt = new Date().toISOString();
    });
    await writeAutomergeState(marked);
    return marked;
  }

  function responseFor(document, extra = {}) {
    const model = ensureDocumentId(document);
    return {
      ok: true,
      documentId: model.documentId,
      path: document.path,
      markdown: markdownFromDocument(document),
      model,
      heads: getDocumentHeads(document),
      versionKey: document.fileVersionKey || '',
      reviewItems: cloneJson(document.reviewItems || []),
      warnings: cloneJson(document.warnings || []),
      ignoredStructuralIdChanges: cloneJson(document.ignoredStructuralIdChanges || {
        document: 0,
        chapter: 0,
        paragraph: 0,
        duplicate: 0
      }),
      ...extra
    };
  }

  async function open(inputPath) {
    const document = await loadByPath(inputPath);
    return responseFor(document);
  }

  async function applyChange(args) {
    const documentId = normalizeDocumentId(args.documentId);
    const change = args.change && typeof args.change === 'object' ? args.change : {};
    let document = await loadByDocumentId(documentId);
    if (change.type === 'replaceTextRange') {
      const nextMarkdown = applyTextDelta(markdownFromDocument(document), change);
      document = changeDocument(document, (draft) => {
        copyMarkdownToDraft(draft, nextMarkdown, document);
        draft.updatedAt = new Date().toISOString();
      });
      await writeAutomergeState(document);
      return responseFor(document);
    }
    if (change.type === 'addParagraph') {
      document = changeDocument(document, (draft) => {
        const chapterIndex = (draft.chapters || []).findIndex((chapter) => chapter.id === change.chapterId);
        if (chapterIndex < 0) throw new Error(`Chapter ${change.chapterId || ''} not found.`);
        const chapter = draft.chapters[chapterIndex];
        if (!Array.isArray(chapter.paragraphs)) chapter.paragraphs = [];
        const position = normalizePosition(chapter.paragraphs, change.position);
        chapter.paragraphs.splice(position, 0, makeDraftParagraphFromChange(change.paragraph || {}));
        draft.blocks = materializeMarkdownModel(draft).blocks;
        draft.updatedAt = new Date().toISOString();
      });
      await writeAutomergeState(document);
      return responseFor(document);
    }
    if (change.type === 'addChapter') {
      document = changeDocument(document, (draft) => {
        if (!Array.isArray(draft.chapters)) draft.chapters = [];
        const position = normalizePosition(draft.chapters, change.position);
        draft.chapters.splice(position, 0, makeDraftChapterFromChange(change.chapter || {}));
        draft.blocks = materializeMarkdownModel(draft).blocks;
        draft.updatedAt = new Date().toISOString();
      });
      await writeAutomergeState(document);
      return responseFor(document);
    }
    const next = applySemanticOperation(ensureDocumentId(document), change);
    document = changeDocument(document, (draft) => {
      copyModelToDraft(draft, next);
      draft.updatedAt = new Date().toISOString();
    });
    await writeAutomergeState(document);
    return responseFor(document);
  }

  async function mergeState(args) {
    const documentId = normalizeDocumentId(args.documentId);
    if (!documentId) {
      throw new Error('merge_markdown_crdt_document requires documentId.');
    }
    const local = await loadByDocumentId(documentId);
    let remote = null;
    if (typeof args.remoteStateBase64 === 'string' && args.remoteStateBase64.trim()) {
      remote = loadDocument(Buffer.from(args.remoteStateBase64.trim(), 'base64'));
    } else if (args.remoteDocumentId) {
      remote = await loadByDocumentId(args.remoteDocumentId);
    } else {
      throw new Error('merge_markdown_crdt_document requires remoteDocumentId or remoteStateBase64.');
    }

    const remoteDocumentId = documentIdFromState(remote);
    if (!remoteDocumentId) {
      throw new Error('Cannot merge a Markdown CRDT state without documentId.');
    }
    if (remoteDocumentId !== documentId) {
      throw new Error(`Cannot merge Markdown CRDT document '${remoteDocumentId}' into '${documentId}'.`);
    }

    let document = mergeDocuments(local, remote);
    document = changeDocument(document, (draft) => {
      draft.documentId = documentId;
      draft.id = documentId;
      draft.metadata = {
        ...(draft.metadata || {}),
        id: documentId
      };
      draft.path = draft.path || local.path || remote.path || '';
      draft.blocks = materializeMarkdownModel(draft).blocks;
      draft.updatedAt = new Date().toISOString();
    });
    await writeAutomergeState(document);
    if (document.path) {
      invalidateCachesForPath(document.path);
    }
    return responseFor(document, {
      status: 'merged'
    });
  }

  async function save(args) {
    if (!args.documentId && !args.path) {
      throw new Error('save_markdown_crdt_document requires documentId or path.');
    }
    let document = args.documentId
      ? await loadByDocumentId(args.documentId)
      : await loadByPath(args.path);
    const validPath = args.path ? await validatePath(args.path) : document.path;
    if (!isMarkdownPath(validPath, path)) {
      throw new Error('Markdown CRDT tools only support .md files.');
    }
    const markdown = markdownFromDocument(document);
    const saveWarnings = cloneJson(document.warnings || []);
    const saveIgnoredStructuralIdChanges = cloneJson(document.ignoredStructuralIdChanges || {
      document: 0,
      chapter: 0,
      paragraph: 0,
      duplicate: 0
    });
    await writeFileContent(validPath, markdown);
    invalidateCachesForPath(validPath);
    const stats = await fs.stat(validPath);
    const versionKey = getVersionKey(stats);
    document = changeDocument(document, (draft) => {
      draft.path = validPath;
      draft.fileVersionKey = versionKey;
      draft.lastSavedMarkdown = markdown;
      draft.warnings = [];
      draft.ignoredStructuralIdChanges = {
        document: 0,
        chapter: 0,
        paragraph: 0,
        duplicate: 0
      };
      draft.updatedAt = new Date().toISOString();
    });
    await writeAutomergeState(document);
    return responseFor(document, {
      status: 'saved',
      versionKey,
      warnings: saveWarnings,
      ignoredStructuralIdChanges: saveIgnoredStructuralIdChanges
    });
  }

  async function syncFromFile(args) {
    const validPath = await validatePath(args.path);
    if (!isMarkdownPath(validPath, path)) {
      throw new Error('Markdown CRDT tools only support .md files.');
    }
    const { raw, versionKey } = await readMarkdownFile(validPath);
    const parsed = modelFromMarkdown(raw);
    let document = await readAutomergeState(parsed.metadata.id) || await readAutomergeStateByPath(validPath);
    if (!document) {
      document = await initializeDocument(validPath);
    } else {
      document = changeDocument(document, (draft) => {
        copyMarkdownToDraft(draft, raw, document);
        draft.path = validPath;
        draft.fileVersionKey = versionKey;
        draft.lastSavedMarkdown = raw;
        draft.reviewItems = [];
        draft.updatedAt = new Date().toISOString();
      });
      await writeAutomergeState(document);
    }
    return responseFor(document, {
      status: 'synced'
    });
  }

  return {
    open,
    applyChange,
    merge: mergeState,
    save,
    syncFromFile
  };
}
