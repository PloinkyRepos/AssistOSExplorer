import { callExplorerTool, ensureSuccess, parseToolResult } from '../infrastructure/explorerApi.js';

function parseResult(result) {
    ensureSuccess(result);
    const parsed = parseToolResult(result);
    return parsed && typeof parsed === 'object' ? parsed : {};
}

export function computeTextDelta(previousText = '', nextText = '') {
    const previous = String(previousText ?? '');
    const next = String(nextText ?? '');
    if (previous === next) {
        return null;
    }

    let start = 0;
    const previousLength = previous.length;
    const nextLength = next.length;
    while (
        start < previousLength
        && start < nextLength
        && previous.charCodeAt(start) === next.charCodeAt(start)
    ) {
        start += 1;
    }

    let previousEnd = previousLength;
    let nextEnd = nextLength;
    while (
        previousEnd > start
        && nextEnd > start
        && previous.charCodeAt(previousEnd - 1) === next.charCodeAt(nextEnd - 1)
    ) {
        previousEnd -= 1;
        nextEnd -= 1;
    }

    return {
        type: 'replaceTextRange',
        from: start,
        deleteCount: previousEnd - start,
        insertText: next.slice(start, nextEnd)
    };
}

export async function openMarkdownCrdtDocument(path) {
    return parseResult(await callExplorerTool('open_markdown_crdt_document', { path }, { raw: true, withLoader: false }));
}

export async function applyMarkdownCrdtChange(documentId, change) {
    const operation = String(change?.type || '');
    const payload = { ...(change || {}) };
    delete payload.type;
    return parseResult(await callExplorerTool(
        'apply_markdown_crdt_change',
        { documentId, operation, change: payload, changeJson: JSON.stringify(payload) },
        { raw: true, withLoader: false }
    ));
}

export async function saveMarkdownCrdtDocument({ documentId = '', path = '' } = {}) {
    return parseResult(await callExplorerTool('save_markdown_crdt_document', { documentId, path }, { raw: true, withLoader: false }));
}

export async function syncMarkdownCrdtFromFile(path) {
    return parseResult(await callExplorerTool('sync_markdown_crdt_from_file', { path }, { raw: true, withLoader: false }));
}
