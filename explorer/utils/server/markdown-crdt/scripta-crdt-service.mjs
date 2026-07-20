import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  createScriptaDocumentModel,
  mutateScriptaDocument,
  normalizeScriptaDocumentModel,
  projectScriptaDocument
} from '../../../shared/document/scripta-document.js';
import {
  applyDocumentChanges,
  changeDocument,
  createDocument,
  documentHasHeads,
  getDocumentChangesSince,
  getDocumentHeads,
  loadDocument,
  saveDocument
} from './automerge-adapter.mjs';

const EXCLUDED_WORKSPACE_FOLDERS = new Set(['.data', '.git', '.ploinky', 'node_modules']);
const MAX_COLLABORATION_CHANGES = 128;
const MAX_COLLABORATION_BYTES = 2 * 1024 * 1024;

export function createScriptaCrdtService({
  fs,
  path,
  workspaceRoot,
  validatePath,
  markdownCrdtStore
}) {
  const collaborationRoot = path.join(
    workspaceRoot,
    '.ploinky',
    'data',
    'explorer',
    'automerge',
    'scripta-collaboration'
  );

  function clone(value) {
    return JSON.parse(JSON.stringify(value ?? null));
  }

  function publicModelForCollaboration(model) {
    const publicModel = clone(model);
    for (const chapter of Array.isArray(publicModel?.chapters) ? publicModel.chapters : []) {
      for (const paragraph of Array.isArray(chapter?.paragraphs) ? chapter.paragraphs : []) {
        const pluginStates = [
          paragraph?.pluginState,
          paragraph?.metadata?.pluginState
        ].filter((value) => value && typeof value === 'object' && !Array.isArray(value));
        for (const pluginState of pluginStates) {
          const scripta = pluginState.scripta;
          if (!scripta || typeof scripta !== 'object' || Array.isArray(scripta)) continue;
          for (const variant of Array.isArray(scripta.variants) ? scripta.variants : []) {
            if (variant && typeof variant === 'object') delete variant.createdBy;
          }
          scripta.reactionsByVariant = {};
        }
      }
    }
    return publicModel;
  }

  function safeDocumentId(value) {
    const id = String(value || '').trim();
    if (!id || !/^[a-zA-Z0-9_.:-]+$/.test(id)) throw new Error('Invalid SCRIPTA collaboration document id.');
    return id;
  }

  function collaborationPath(documentId) {
    return path.join(collaborationRoot, `${safeDocumentId(documentId)}.automerge`);
  }

  async function writeCollaborationDocument(documentId, document) {
    await fs.mkdir(collaborationRoot, { recursive: true });
    const target = collaborationPath(documentId);
    const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, Buffer.from(saveDocument(document)));
      await fs.rename(temporary, target);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
  }

  async function readCollaborationDocument(documentId) {
    try {
      return loadDocument(await fs.readFile(collaborationPath(documentId)));
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function removeCollaborationDocument(documentId) {
    await fs.rm(collaborationPath(documentId), { force: true });
  }

  function reconcilePublicObject(draft, next) {
    for (const key of Object.keys(draft)) {
      if (!Object.prototype.hasOwnProperty.call(next, key)) delete draft[key];
    }
    for (const [key, value] of Object.entries(next)) {
      const current = draft[key];
      if (Array.isArray(value)) {
        if (!Array.isArray(current)) {
          draft[key] = clone(value);
          continue;
        }
        const keyed = value.every((entry) => entry && typeof entry === 'object' && String(entry.id || ''))
          && current.every((entry) => entry && typeof entry === 'object' && String(entry.id || ''));
        const commonLength = Math.min(current.length, value.length);
        const commonOrder = keyed && Array.from(
          { length: commonLength },
          (_, index) => String(current[index].id) === String(value[index].id)
        ).every(Boolean);
        if (keyed && commonOrder) {
          for (let index = 0; index < commonLength; index += 1) {
            reconcilePublicObject(current[index], value[index]);
          }
          if (value.length > current.length) {
            current.push(...clone(value.slice(current.length)));
          } else if (current.length > value.length) {
            current.splice(value.length, current.length - value.length);
          }
          continue;
        }
        if (!keyed && current.length === value.length) {
          for (let index = 0; index < value.length; index += 1) {
            const nextEntry = value[index];
            if (
              nextEntry && typeof nextEntry === 'object' && !Array.isArray(nextEntry)
              && current[index] && typeof current[index] === 'object' && !Array.isArray(current[index])
            ) {
              reconcilePublicObject(current[index], nextEntry);
            } else if (!isDeepStrictEqual(clone(current[index]), nextEntry)) {
              current[index] = clone(nextEntry);
            }
          }
          continue;
        }
        draft[key] = clone(value);
        continue;
      }
      if (value && typeof value === 'object') {
        if (!current || typeof current !== 'object' || Array.isArray(current)) {
          draft[key] = clone(value);
        } else {
          reconcilePublicObject(current, value);
        }
        continue;
      }
      if (current !== value) draft[key] = value;
    }
  }

  function replacePublicModel(document, model) {
    const next = publicModelForCollaboration(model);
    return changeDocument(document, (draft) => reconcilePublicObject(draft, next));
  }

  async function publicDocumentForModel(model) {
    const documentId = safeDocumentId(model.documentId || model.id || model.metadata?.id);
    const publicModel = publicModelForCollaboration(model);
    const existing = await readCollaborationDocument(documentId);
    if (existing && isDeepStrictEqual(clone(existing), publicModel)) return existing;
    const synchronized = existing
      ? replacePublicModel(existing, publicModel)
      : createDocument(publicModel);
    await writeCollaborationDocument(documentId, synchronized);
    return synchronized;
  }

  function encodeBinary(value) {
    return Buffer.from(value).toString('base64');
  }

  function decodeChanges(values) {
    if (!Array.isArray(values) || !values.length || values.length > MAX_COLLABORATION_CHANGES) {
      throw new Error('SCRIPTA collaboration changes must contain between 1 and 128 entries.');
    }
    let total = 0;
    return values.map((value) => {
      const binary = Buffer.from(String(value || ''), 'base64');
      total += binary.byteLength;
      if (!binary.byteLength || total > MAX_COLLABORATION_BYTES) {
        throw new Error('SCRIPTA collaboration change payload is invalid or too large.');
      }
      return binary;
    });
  }

  function variantFor(model, chapterId, paragraphId, variantId) {
    const chapter = (model.chapters || []).find((item) => item.id === chapterId);
    const paragraph = (chapter?.paragraphs || []).find((item) => item.id === paragraphId);
    const variants = paragraph?.pluginState?.scripta?.variants || [];
    return variants.find((item) => item.id === variantId) || null;
  }

  function assertTextEditOnly(before, candidate, args) {
    const expectedText = String(args.text ?? '');
    const beforeVariant = variantFor(before, args.chapterId, args.paragraphId, args.variantId);
    const candidateVariant = variantFor(candidate, args.chapterId, args.paragraphId, args.variantId);
    if (!beforeVariant || !candidateVariant) throw new Error('SCRIPTA collaboration variant was not found.');
    if (String(candidateVariant.text ?? '') !== expectedText) {
      throw new Error(`SCRIPTA collaboration change does not match the requested text edit (received ${JSON.stringify(candidateVariant.text ?? '')}).`);
    }
    const normalizedBefore = clone(before);
    const normalizedCandidate = clone(candidate);
    const normalizedBeforeVariant = variantFor(normalizedBefore, args.chapterId, args.paragraphId, args.variantId);
    const normalizedVariant = variantFor(normalizedCandidate, args.chapterId, args.paragraphId, args.variantId);
    delete normalizedBeforeVariant.text;
    delete normalizedVariant.text;
    if (!isDeepStrictEqual(normalizedCandidate, normalizedBefore)) {
      throw new Error('SCRIPTA collaboration change attempted to modify fields outside the selected variant text.');
    }
  }

  function collaborationResponse(document, result, args = {}, extra = {}) {
    const model = clone(result.model);
    return {
      ok: true,
      documentId: result.documentId,
      heads: getDocumentHeads(document),
      stateBase64: encodeBinary(saveDocument(document)),
      projection: projectScriptaDocument(model, {
        resourceId: args.resourceId,
        view: args.view,
        viewerHash: args.viewerHash,
        participantMap: args.participantMap
      }),
      ...extra
    };
  }

  function collaborationApplyResponse(document, result, args = {}, {
    changesBase64 = [],
    resetRequired = false
  } = {}) {
    const model = clone(result.model);
    return {
      ok: true,
      documentId: result.documentId,
      heads: getDocumentHeads(document),
      changesBase64,
      resetRequired,
      ...(resetRequired ? { stateBase64: encodeBinary(saveDocument(document)) } : {}),
      projection: projectScriptaDocument(model, {
        resourceId: args.resourceId,
        view: args.view,
        viewerHash: args.viewerHash,
        participantMap: args.participantMap
      })
    };
  }

  function collaborationPullResponse(document, result, {
    changesBase64 = [],
    resetRequired = false
  } = {}) {
    return {
      ok: true,
      documentId: result.documentId,
      heads: getDocumentHeads(document),
      changesBase64,
      resetRequired,
      ...(resetRequired ? { stateBase64: encodeBinary(saveDocument(document)) } : {})
    };
  }

  function virtualPath(absolutePath) {
    return `/${path.relative(workspaceRoot, absolutePath).replace(/\\/g, '/')}`;
  }

  async function ensureFolder({ folderPath }) {
    const target = await validatePath(folderPath);
    await fs.mkdir(target, { recursive: true });
    return { ok: true, folderPath: virtualPath(target) };
  }

  async function listWorkspace({ defaultFolder }) {
    const root = await fs.realpath(workspaceRoot);
    const folders = ['/'];
    const documents = [];

    async function visit(directory, depth = 0) {
      if (depth > 8 || documents.length >= 500) return;
      const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (EXCLUDED_WORKSPACE_FOLDERS.has(entry.name) || documents.length >= 500) continue;
        const target = path.join(directory, entry.name);
        const candidate = virtualPath(target);
        if (entry.isDirectory()) {
          if (folders.length < 500) folders.push(candidate);
          await visit(target, depth + 1);
        } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.md') {
          documents.push(candidate);
        }
      }
    }

    await visit(root);
    const canonicalFolder = virtualPath(await validatePath(defaultFolder));
    const prefix = `${canonicalFolder.replace(/\/$/, '')}/`;
    return {
      ok: true,
      defaultFolder: canonicalFolder,
      defaultDocuments: documents.filter((entry) => entry.startsWith(prefix) && !entry.slice(prefix.length).includes('/')),
      folders,
      documents
    };
  }

  async function create(args) {
    const model = createScriptaDocumentModel(args);
    const documentId = safeDocumentId(model.documentId || model.id || model.metadata?.id);
    let publicDocument = null;
    const result = await markdownCrdtStore.create({
      path: args.path,
      model,
      onCompleted: async (saved) => {
        publicDocument = await publicDocumentForModel(saved.model);
      },
      onRollback: async () => {
        await removeCollaborationDocument(documentId);
      }
    });
    return {
      ...result,
      path: virtualPath(result.path),
      collaborationHeads: getDocumentHeads(publicDocument),
      projection: projectScriptaDocument(result.model, {
        resourceId: args.resourceId,
        view: args.view,
        viewerHash: args.viewerHash
      })
    };
  }

  async function open(args) {
    const fileName = path.basename(String(args.path || ''), path.extname(String(args.path || ''))) || 'Untitled';
    let publicDocument = null;
    const result = await markdownCrdtStore.mutateAndSave({
      path: args.path,
      onCompleted: async (saved) => {
        publicDocument = await publicDocumentForModel(saved.model);
      }
    }, (model) => {
      const normalized = normalizeScriptaDocumentModel(model, {
        fallbackTitle: fileName,
        createdBy: args.viewerHash
      });
      return JSON.stringify(normalized) === JSON.stringify(model) ? null : normalized;
    });
    return {
      ...result,
      path: virtualPath(result.path),
      collaborationHeads: getDocumentHeads(publicDocument),
      projection: projectScriptaDocument(result.model, {
        resourceId: args.resourceId,
        view: args.view,
        viewerHash: args.viewerHash,
        participantMap: args.participantMap
      })
    };
  }

  async function mutate(args) {
    let focusTarget = null;
    let nextPublicDocument = null;
    let savedDocumentId = '';
    const saved = await markdownCrdtStore.mutateAndSave({
      path: args.path,
      historyAction: args.operation === 'undo' ? 'undo' : 'push',
      onCommitted: async (committed) => {
        if (nextPublicDocument) {
          await writeCollaborationDocument(savedDocumentId, nextPublicDocument);
          return;
        }
        if (args.operation === 'undo') {
          await publicDocumentForModel(committed.model);
        }
      }
    }, (model) => {
      const result = mutateScriptaDocument(model, args.operation, args.args, args.participant);
      focusTarget = result.focusTarget;
      return publicDocumentForModel(model).then((publicDocument) => {
        nextPublicDocument = replacePublicModel(publicDocument, result.document);
        savedDocumentId = result.document.documentId;
        return result.document;
      });
    });
    const projectionView = focusTarget
      ? {
          ...(args.view || {}),
          mode: 'document',
          chapterId: focusTarget.chapterId,
          paragraphId: focusTarget.paragraphId,
          focusTargetType: focusTarget.type,
          autoFocusRevision: Number(saved.model?.metadata?.version || saved.model?.version || 0)
        }
      : args.view;
    return {
      ...saved,
      path: virtualPath(saved.path),
      focusTarget,
      projection: projectScriptaDocument(saved.model, {
        resourceId: args.resourceId,
        view: projectionView,
        viewerHash: args.viewerHash,
        participantMap: args.participantMap
      })
    };
  }

  async function collaborationOpen(args) {
    return markdownCrdtStore.inspect({ path: args.path }, async (result) => {
      const document = await publicDocumentForModel(result.model);
      return collaborationResponse(document, result, args);
    });
  }

  async function collaborationPull(args) {
    return markdownCrdtStore.inspect({ path: args.path }, async (result) => {
      const document = await publicDocumentForModel(result.model);
      const knownHeads = Array.isArray(args.knownHeads) ? args.knownHeads : [];
      if (!documentHasHeads(document, knownHeads)) {
        return collaborationPullResponse(document, result, {
          changesBase64: [],
          resetRequired: true
        });
      }
      try {
        const changes = getDocumentChangesSince(document, knownHeads);
        return collaborationPullResponse(document, result, {
          changesBase64: changes.map(encodeBinary),
          resetRequired: false
        });
      } catch {
        return collaborationPullResponse(document, result, {
          changesBase64: [],
          resetRequired: true
        });
      }
    });
  }

  async function collaborationApply(args) {
    if (args.operation !== 'p-variant-edit') throw new Error('Only incremental SCRIPTA text edits are accepted from browser replicas.');
    const changes = decodeChanges(args.changesBase64);
    let committedPublicDocument = null;
    let documentId = '';
    const saved = await markdownCrdtStore.mutateAndSave({
      path: args.path,
      historyAction: 'push',
      onCommitted: async () => {
        await writeCollaborationDocument(documentId, committedPublicDocument);
      }
    }, async (model) => {
      const publicDocument = await publicDocumentForModel(model);
      const candidateDocument = applyDocumentChanges(publicDocument, changes);
      const candidateModel = clone(candidateDocument);
      assertTextEditOnly(clone(publicDocument), candidateModel, args.args || {});
      const normalized = mutateScriptaDocument(model, 'p-variant-edit', args.args, args.participant).document;
      committedPublicDocument = replacePublicModel(candidateDocument, normalized);
      documentId = safeDocumentId(normalized.documentId);
      return normalized;
    });
    let responseChanges = [];
    let resetRequired = false;
    try {
      responseChanges = getDocumentChangesSince(
        committedPublicDocument,
        Array.isArray(args.baseHeads) ? args.baseHeads : []
      ).map(encodeBinary);
    } catch {
      resetRequired = true;
    }
    return collaborationApplyResponse(committedPublicDocument, saved, args, {
      changesBase64: responseChanges,
      resetRequired
    });
  }

  async function remove(args) {
    if (args.phase === 'prepare') {
      let documentId = String(args.documentId || '').trim();
      if (!documentId) {
        documentId = await markdownCrdtStore.inspect({ path: args.path }, (result) => result.documentId);
      }
      return markdownCrdtStore.prepareRemove({
        documentId,
        path: args.path,
        relatedArtifacts: [{
          name: 'collaboration.automerge',
          path: collaborationPath(documentId),
          optional: true
        }]
      });
    }
    if (args.phase === 'commit') {
      return markdownCrdtStore.commitRemove({ transactionId: args.transactionId });
    }
    if (args.phase === 'rollback') {
      return markdownCrdtStore.rollbackRemove({ transactionId: args.transactionId });
    }
    throw new Error('Unsupported SCRIPTA deletion phase.');
  }

  return {
    ensureFolder,
    listWorkspace,
    create,
    open,
    mutate,
    remove,
    collaborationOpen,
    collaborationPull,
    collaborationApply
  };
}
