import * as Automerge from '../../../shared/vendor/automerge/dist/mjs/entrypoints/fullfat_node.js';

export function createDocument(initialState = {}) {
  return Automerge.from(initialState);
}

export function loadDocument(binary) {
  if (!binary || binary.length === 0) {
    return createDocument();
  }
  return Automerge.load(binary);
}

export function saveDocument(document) {
  return Automerge.save(document);
}

export function changeDocument(document, callback) {
  return Automerge.change(document, callback);
}

export function getDocumentHeads(document) {
  return Automerge.getHeads(document);
}

export function mergeDocuments(local, remote) {
  return Automerge.merge(local, remote);
}

export function createText(value = '') {
  return String(value ?? '');
}

export function spliceText(document, path, index, deleteCount, insertText = '') {
  return Automerge.splice(document, path, index, deleteCount, String(insertText ?? ''));
}

export function updateText(document, path, value = '') {
  return Automerge.updateText(document, path, String(value ?? ''));
}

export const load = loadDocument;
export const save = saveDocument;
export const change = changeDocument;
export const merge = mergeDocuments;
export const getHeads = getDocumentHeads;
