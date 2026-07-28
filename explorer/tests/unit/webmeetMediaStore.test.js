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
    await fs.writeFile(path.join(workspaceRoot, 'blobs', `${blobId}.json`), '{}');
    const store = createWebMeetMediaStore({
        fs,
        path,
        agentName: 'explorer',
        validatePath: async (value) => path.join(workspaceRoot, String(value).replace(/^\/+/, ''))
    });
    const asset = await store.commit({
        roomId: 'room_1',
        blobRef: { id: blobId, agent: 'explorer', localPath: `blobs/${blobId}` },
        filename: 'diagram.png',
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
