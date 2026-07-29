import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createWebMeetMediaStore, inspectImage } from '../../utils/server/webmeet-media-store.mjs';

function png(width = 2, height = 3) {
    const buffer = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buffer);
    buffer.writeUInt32BE(width, 16);
    buffer.writeUInt32BE(height, 20);
    return buffer;
}

test('WebMeet media validates images and moves one staged blob into the room asset tree', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'explorer-webmeet-media-'));
    const workspaceRoot = path.join(root, 'workspace');
    await fs.mkdir(path.join(workspaceRoot, 'blobs'), { recursive: true });
    const blobId = 'a'.repeat(48);
    await fs.writeFile(path.join(workspaceRoot, 'blobs', blobId), png());
    await fs.writeFile(path.join(workspaceRoot, 'blobs', `${blobId}.json`), JSON.stringify({
        id: blobId,
        agent: 'explorer',
        localPath: `blobs/${blobId}`,
        filename: 'diagram.png',
        mime: 'image/png',
        size: 24
    }));
    const store = createWebMeetMediaStore({
        fs,
        path,
        agentName: 'explorer',
        validatePath: async (value) => path.join(workspaceRoot, String(value).replace(/^\/+/, ''))
    });
    const asset = await store.commit({
        roomId: 'room_1',
        blobRef: { id: blobId, agent: 'explorer', localPath: `blobs/${blobId}` },
        createdBy: 'participant_1'
    });
    assert.equal(asset.mimeType, 'image/png');
    assert.equal(asset.width, 2);
    assert.equal(asset.height, 3);
    assert.match(asset.workspaceUrl, /^\/document-multimedia\/webmeet\/room_1\/assets\/asset_.+\.png$/);
    assert.deepEqual(await store.read('room_1', asset.assetId), asset);
    await assert.rejects(fs.stat(path.join(workspaceRoot, 'blobs', blobId)));
});

test('WebMeet media rejects blob references for another agent or path', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'explorer-webmeet-media-ref-'));
    const store = createWebMeetMediaStore({
        fs,
        path,
        agentName: 'explorer',
        validatePath: async (value) => path.join(root, String(value).replace(/^\/+/, ''))
    });
    const id = 'b'.repeat(48);
    await assert.rejects(
        store.commit({ roomId: 'room_1', blobRef: { id, agent: 'other', localPath: `blobs/${id}` } }),
        /different agent/
    );
    await assert.rejects(
        store.commit({ roomId: 'room_1', blobRef: { id, agent: 'explorer', localPath: 'other/file' } }),
        /does not match its id/
    );
});

test('WebMeet media rejects unsupported image content', () => {
    assert.throws(() => inspectImage(Buffer.from('<svg></svg>')), /Only PNG, JPEG, WebP, and GIF/);
});

test('WebMeet media commits arbitrary files and does not trust an image MIME declaration', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'explorer-webmeet-file-'));
    const workspaceRoot = path.join(root, 'workspace');
    await fs.mkdir(path.join(workspaceRoot, 'blobs'), {recursive: true});
    const blobId = 'c'.repeat(48);
    const content = Buffer.from('%PDF-1.7\nexample');
    await fs.writeFile(path.join(workspaceRoot, 'blobs', blobId), content);
    await fs.writeFile(path.join(workspaceRoot, 'blobs', `${blobId}.json`), JSON.stringify({
        id: blobId,
        agent: 'explorer',
        localPath: `blobs/${blobId}`,
        filename: '../report.pdf',
        mime: 'image/png',
        size: content.length
    }));
    const store = createWebMeetMediaStore({
        fs,
        path,
        agentName: 'explorer',
        validatePath: async (value) => path.join(workspaceRoot, String(value).replace(/^\/+/, ''))
    });
    const asset = await store.commit({
        roomId: 'room_1',
        blobRef: {id: blobId, agent: 'explorer', localPath: `blobs/${blobId}`},
        createdBy: 'participant_1'
    });
    assert.equal(asset.kind, 'file');
    assert.equal(asset.filename, 'report.pdf');
    assert.equal(asset.extension, 'pdf');
    assert.equal(asset.mimeType, 'image/png');
    assert.equal(asset.width, undefined);
    assert.match(asset.workspaceUrl, /^\/document-multimedia\/webmeet\/room_1\/assets\/asset_.+\.bin$/);
    assert.deepEqual(
        await fs.readFile(path.join(workspaceRoot, asset.workspaceUrl.replace(/^\/+/, ''))),
        content
    );
    assert.deepEqual(await store.read('room_1', asset.assetId), asset);
});

test('WebMeet media keeps JSON content separate from its asset metadata', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'explorer-webmeet-json-'));
    const workspaceRoot = path.join(root, 'workspace');
    await fs.mkdir(path.join(workspaceRoot, 'blobs'), {recursive: true});
    const blobId = 'd'.repeat(48);
    const content = Buffer.from('{"answer":42}\n');
    await fs.writeFile(path.join(workspaceRoot, 'blobs', blobId), content);
    await fs.writeFile(path.join(workspaceRoot, 'blobs', `${blobId}.json`), JSON.stringify({
        id: blobId,
        agent: 'explorer',
        localPath: `blobs/${blobId}`,
        filename: 'payload.json',
        mime: 'application/json',
        size: content.length
    }));
    const store = createWebMeetMediaStore({
        fs,
        path,
        agentName: 'explorer',
        validatePath: async (value) => path.join(workspaceRoot, String(value).replace(/^\/+/, ''))
    });
    const asset = await store.commit({
        roomId: 'room_json',
        blobRef: {id: blobId, agent: 'explorer', localPath: `blobs/${blobId}`}
    });
    const assetPath = path.join(workspaceRoot, asset.workspaceUrl.replace(/^\/+/, ''));
    const metadataPath = path.join(path.dirname(assetPath), `${asset.assetId}.metadata.json`);
    assert.equal(asset.extension, 'json');
    assert.match(asset.workspaceUrl, /\.bin$/);
    assert.deepEqual(await fs.readFile(assetPath), content);
    assert.equal(JSON.parse(await fs.readFile(metadataPath, 'utf8')).assetId, asset.assetId);
    assert.deepEqual(await store.read('room_json', asset.assetId), asset);
});

test('WebMeet media stores active non-image content behind an inert extension', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'explorer-webmeet-active-file-'));
    const workspaceRoot = path.join(root, 'workspace');
    await fs.mkdir(path.join(workspaceRoot, 'blobs'), {recursive: true});
    const blobId = 'e'.repeat(48);
    const content = Buffer.from('<script>globalThis.compromised = true</script>');
    await fs.writeFile(path.join(workspaceRoot, 'blobs', blobId), content);
    await fs.writeFile(path.join(workspaceRoot, 'blobs', `${blobId}.json`), JSON.stringify({
        id: blobId,
        agent: 'explorer',
        localPath: `blobs/${blobId}`,
        filename: 'page.html',
        mime: 'text/html',
        size: content.length
    }));
    const store = createWebMeetMediaStore({
        fs,
        path,
        agentName: 'explorer',
        validatePath: async (value) => path.join(workspaceRoot, String(value).replace(/^\/+/, ''))
    });
    const asset = await store.commit({
        roomId: 'room_html',
        blobRef: {id: blobId, agent: 'explorer', localPath: `blobs/${blobId}`}
    });
    assert.equal(asset.filename, 'page.html');
    assert.equal(asset.extension, 'html');
    assert.equal(asset.mimeType, 'text/html');
    assert.match(asset.workspaceUrl, /\.bin$/);
    assert.deepEqual(
        await fs.readFile(path.join(workspaceRoot, asset.workspaceUrl.replace(/^\/+/, ''))),
        content
    );
});
