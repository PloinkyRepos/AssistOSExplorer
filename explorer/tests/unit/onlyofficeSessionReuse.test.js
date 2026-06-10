import assert from 'node:assert/strict';
import test from 'node:test';

import { createFileExpCaches } from '../../web-components/pages/file-exp/file-exp-caches.js';
import {
    tryLoadOnlyOfficePreview,
    invalidateOnlyOfficeSession
} from '../../services/onlyoffice/onlyoffice-preview-service.js';
import {
    buildConfigKey,
    isOnlyOfficeEditorActive,
    renderOnlyOfficeEditor
} from '../../services/onlyoffice/onlyoffice-editor-host.js';

const DOC_PATH = '/Confidential/My Space/report.docx';

function buildSession(id, { documentKey = 'doc-key-1' } = {}) {
    return {
        ok: true,
        sessionId: `session-${id}`,
        preview: {
            storageKind: 'dpu',
            requestedPath: DOC_PATH,
            objectId: `obj-${id}`,
            canWrite: true,
            canComment: true
        },
        config: {
            document: {
                key: documentKey,
                title: 'report.docx',
                fileType: 'docx',
                url: `http://127.0.0.1:9100/internal/document/token-${id}`,
                permissions: { edit: true, comment: true, review: true }
            },
            documentType: 'word',
            editorConfig: {
                callbackUrl: `http://127.0.0.1:9100/internal/callback/token-${id}`,
                mode: 'edit',
                user: { id: 'user-1', name: 'User One' }
            },
            token: `jwt-${id}`,
            documentServerUrl: 'http://127.0.0.1:8082'
        }
    };
}

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
    return {
        ok,
        status,
        headers: {
            get(name) {
                return name === 'content-type' ? 'application/json' : '';
            }
        },
        async json() {
            return payload;
        }
    };
}

function stubFetch(t, responder) {
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
        calls.push({ url, options });
        return responder(calls.length, { url, options });
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
    });
    return calls;
}

function createFileExpStub({ entries = [] } = {}) {
    return {
        state: {
            previewMode: 'code',
            onlyOfficeConfig: null,
            selectedPath: '',
            allEntries: entries,
            entries
        },
        caches: createFileExpCaches(),
        previewDom: null,
        element: { querySelector: () => null },
        invalidateCalls: 0,
        refreshCalls: 0,
        normalizePath(pathValue) {
            return String(pathValue || '');
        },
        getEntryByPath(pathValue) {
            return (this.state.allEntries || []).find((entry) => entry?.path === pathValue) || null;
        },
        setPreviewState(patch) {
            Object.assign(this.state, patch);
        },
        invalidate() {
            this.invalidateCalls += 1;
        },
        refreshPreviewUi() {
            this.refreshCalls += 1;
        }
    };
}

function createLiveEditorHost(config, { mountedAs = 'iframe' } = {}) {
    return {
        __onlyOfficeRuntime: {
            editor: { destroyEditor() {} },
            containerId: 'onlyoffice-editor-test',
            scriptUrl: '',
            configKey: buildConfigKey(config)
        },
        // DocsAPI.DocEditor replaces the .onlyoffice-editor-frame container
        // div with the editor iframe, so a live host typically matches
        // 'iframe' while a not-yet-instantiated host matches the class.
        querySelector(selector) {
            return selector === mountedAs ? {} : null;
        }
    };
}

function docEntry(overrides = {}) {
    return {
        path: DOC_PATH,
        name: 'report.docx',
        type: 'file',
        modified: '2026-06-10T10:00:00.000Z',
        size: 1234,
        ...overrides
    };
}

test('configKey ignores per-session transport fields but tracks document identity', () => {
    const first = buildSession(1).config;
    const second = buildSession(2).config;
    assert.equal(buildConfigKey(first), buildConfigKey(second));

    const changed = buildSession(3, { documentKey: 'doc-key-2' }).config;
    assert.notEqual(buildConfigKey(first), buildConfigKey(changed));
});

test('re-opening the same unchanged document reuses the cached session', async (t) => {
    const calls = stubFetch(t, (count) => jsonResponse(buildSession(count)));
    const fileExp = createFileExpStub({ entries: [docEntry()] });

    assert.equal(await tryLoadOnlyOfficePreview(fileExp, DOC_PATH), true);
    assert.equal(calls.length, 1);
    assert.equal(fileExp.invalidateCalls, 1);
    const firstConfig = fileExp.state.onlyOfficeConfig;
    assert.equal(firstConfig.token, 'jwt-1');

    assert.equal(await tryLoadOnlyOfficePreview(fileExp, DOC_PATH), true);
    assert.equal(calls.length, 1, 'second open must not mint a new session');
    assert.equal(fileExp.state.onlyOfficeConfig, firstConfig);
});

test('re-opening with a live editor refreshes the preview without a full invalidate', async (t) => {
    const calls = stubFetch(t, (count) => jsonResponse(buildSession(count)));
    const fileExp = createFileExpStub({ entries: [docEntry()] });

    await tryLoadOnlyOfficePreview(fileExp, DOC_PATH);
    assert.equal(fileExp.invalidateCalls, 1);

    fileExp.previewDom = { componentMount: createLiveEditorHost(fileExp.state.onlyOfficeConfig) };
    await tryLoadOnlyOfficePreview(fileExp, DOC_PATH);

    assert.equal(calls.length, 1);
    assert.equal(fileExp.invalidateCalls, 1, 'live editor must not trigger a full re-render');
    assert.equal(fileExp.refreshCalls, 1);
});

test('concurrent opens of the same path share one in-flight session fetch', async (t) => {
    let release;
    const gate = new Promise((resolve) => {
        release = resolve;
    });
    const calls = stubFetch(t, async (count) => {
        await gate;
        return jsonResponse(buildSession(count));
    });
    const fileExp = createFileExpStub({ entries: [docEntry()] });

    const first = tryLoadOnlyOfficePreview(fileExp, DOC_PATH);
    const second = tryLoadOnlyOfficePreview(fileExp, DOC_PATH);
    release();
    assert.deepEqual(await Promise.all([first, second]), [true, true]);

    assert.equal(calls.length, 1);
    assert.equal(fileExp.state.onlyOfficeConfig.token, 'jwt-1');
});

test('a changed file version forces a fresh session', async (t) => {
    const calls = stubFetch(t, (count) => jsonResponse(buildSession(count, {
        documentKey: `doc-key-${count}`
    })));
    const entry = docEntry();
    const fileExp = createFileExpStub({ entries: [entry] });

    await tryLoadOnlyOfficePreview(fileExp, DOC_PATH);
    entry.modified = '2026-06-10T11:30:00.000Z';
    await tryLoadOnlyOfficePreview(fileExp, DOC_PATH);

    assert.equal(calls.length, 2);
    assert.equal(fileExp.state.onlyOfficeConfig.token, 'jwt-2');
});

test('filePreview invalidation for the path also drops the cached session', async (t) => {
    const calls = stubFetch(t, (count) => jsonResponse(buildSession(count)));
    const fileExp = createFileExpStub({ entries: [docEntry()] });

    await tryLoadOnlyOfficePreview(fileExp, DOC_PATH);
    fileExp.caches.filePreview.invalidateForPath('/somewhere/else.docx');
    await tryLoadOnlyOfficePreview(fileExp, DOC_PATH);
    assert.equal(calls.length, 1, 'unrelated invalidation must keep the session');

    fileExp.caches.filePreview.invalidateForPath(DOC_PATH);
    await tryLoadOnlyOfficePreview(fileExp, DOC_PATH);
    assert.equal(calls.length, 2, 'path invalidation must mint a fresh session');
});

test('invalidateOnlyOfficeSession clears the slot explicitly', async (t) => {
    const calls = stubFetch(t, (count) => jsonResponse(buildSession(count)));
    const fileExp = createFileExpStub({ entries: [docEntry()] });

    await tryLoadOnlyOfficePreview(fileExp, DOC_PATH);
    invalidateOnlyOfficeSession(fileExp, DOC_PATH);
    await tryLoadOnlyOfficePreview(fileExp, DOC_PATH);

    assert.equal(calls.length, 2);
});

test('opening a different document replaces the cached session', async (t) => {
    const calls = stubFetch(t, (count) => jsonResponse(buildSession(count, {
        documentKey: `doc-key-${count}`
    })));
    const otherPath = '/Confidential/My Space/other.docx';
    const fileExp = createFileExpStub({
        entries: [docEntry(), docEntry({ path: otherPath, name: 'other.docx' })]
    });

    await tryLoadOnlyOfficePreview(fileExp, DOC_PATH);
    await tryLoadOnlyOfficePreview(fileExp, otherPath);

    assert.equal(calls.length, 2);
    assert.equal(fileExp.caches.officeSession.get()?.path, otherPath);
});

test('a failed session fetch clears the in-flight slot and allows retry', async (t) => {
    const calls = stubFetch(t, (count) => (count === 1
        ? jsonResponse({ ok: false, error: 'missing_confidential_delegation' }, { ok: false, status: 403 })
        : jsonResponse(buildSession(count))));
    const fileExp = createFileExpStub({ entries: [docEntry()] });

    await assert.rejects(
        () => tryLoadOnlyOfficePreview(fileExp, DOC_PATH),
        /missing_confidential_delegation/
    );
    assert.equal(fileExp.caches.officeSession.get(), null);

    assert.equal(await tryLoadOnlyOfficePreview(fileExp, DOC_PATH), true);
    assert.equal(calls.length, 2);
    assert.equal(fileExp.state.onlyOfficeConfig.token, 'jwt-2');
});

test('entries without any version signal never time-reuse a session', async (t) => {
    const calls = stubFetch(t, (count) => jsonResponse(buildSession(count)));
    // DPU-shaped entry: no modified/updatedAt and no finite size.
    const fileExp = createFileExpStub({
        entries: [docEntry({ modified: null, size: null })]
    });

    await tryLoadOnlyOfficePreview(fileExp, DOC_PATH);
    await tryLoadOnlyOfficePreview(fileExp, DOC_PATH);
    assert.equal(calls.length, 2, 'no version signal and no live editor must refetch');

    fileExp.previewDom = { componentMount: createLiveEditorHost(fileExp.state.onlyOfficeConfig) };
    await tryLoadOnlyOfficePreview(fileExp, DOC_PATH);
    assert.equal(calls.length, 2, 'a live editor still allows reuse without a version signal');
});

test('non-office files never touch the session endpoint', async (t) => {
    const calls = stubFetch(t, () => {
        throw new Error('fetch must not be called');
    });
    const fileExp = createFileExpStub();

    assert.equal(await tryLoadOnlyOfficePreview(fileExp, '/notes/readme.md'), false);
    assert.equal(calls.length, 0);
});

test('renderOnlyOfficeEditor is a no-op while the same config is mounted', async () => {
    const config = buildSession(1).config;
    const host = createLiveEditorHost(config);

    // Outside a browser the non-early path throws; resolving proves the
    // mounted-editor early return engaged.
    await renderOnlyOfficeEditor(host, config);

    const detachedHost = createLiveEditorHost(config);
    detachedHost.querySelector = () => null;
    await assert.rejects(
        () => renderOnlyOfficeEditor(detachedHost, config),
        /not available outside the browser/
    );
});

test('isOnlyOfficeEditorActive only reports an attached editor with matching config', () => {
    const config = buildSession(1).config;
    const host = createLiveEditorHost(config);

    assert.equal(isOnlyOfficeEditorActive(host, config), true);
    assert.equal(isOnlyOfficeEditorActive(host, buildSession(2).config), true,
        'token-only differences must not count as a config change');
    assert.equal(isOnlyOfficeEditorActive(host, buildSession(3, { documentKey: 'doc-key-2' }).config), false);
    assert.equal(isOnlyOfficeEditorActive(host, null), false);
    assert.equal(isOnlyOfficeEditorActive(null, config), false);

    const preInstantiation = createLiveEditorHost(config, { mountedAs: '.onlyoffice-editor-frame' });
    assert.equal(isOnlyOfficeEditorActive(preInstantiation, config), true,
        'the container div before DocEditor replaces it must count as mounted');

    const detached = createLiveEditorHost(config);
    detached.isConnected = false;
    assert.equal(isOnlyOfficeEditorActive(detached, config), false);

    const emptied = createLiveEditorHost(config, { mountedAs: 'nothing-matches' });
    assert.equal(isOnlyOfficeEditorActive(emptied, config), false,
        'a host whose editor DOM was wiped must not count as mounted');

    const noRuntime = { querySelector: () => ({}) };
    assert.equal(isOnlyOfficeEditorActive(noRuntime, config), false);
});
