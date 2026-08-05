import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createStoreContext } from '../../lib/webmeetStore.mjs';
import {
    createRoomRecord,
    listRoomRecords,
} from '../../lib/store/roomRecords.mjs';

test('room records remain durable without automatic expiration', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webmeet-room-retention-'));
    const previous = {
        dataDir: process.env.WEBMEET_DATA_DIR,
        masterKey: process.env.PLOINKY_WEBMEET_MASTER_KEY,
    };

    try {
        process.env.WEBMEET_DATA_DIR = path.join(root, 'data');
        process.env.PLOINKY_WEBMEET_MASTER_KEY = 'room-retention-test-master-key';

        const context = await createStoreContext(root);
        const teamRoom = await createRoomRecord(context, 'Durable team room', 'team');
        const guestRoom = await createRoomRecord(context, 'Durable guest room', 'guest');

        for (const room of [teamRoom, guestRoom]) {
            const recordPath = path.join(context.meetingsDir, `${room.meetingId}.json`);
            const persisted = JSON.parse(await fs.readFile(recordPath, 'utf8'));
            assert.equal(Object.hasOwn(persisted, 'expiresAt'), false);
        }

        const legacyRecordPath = path.join(context.meetingsDir, `${teamRoom.meetingId}.json`);
        const legacyRecord = JSON.parse(await fs.readFile(legacyRecordPath, 'utf8'));
        legacyRecord.expiresAt = '2000-01-01T00:00:00.000Z';
        await fs.writeFile(legacyRecordPath, `${JSON.stringify(legacyRecord, null, 2)}\n`);

        const reopenedContext = await createStoreContext(root);
        const reopenedRecords = await listRoomRecords(reopenedContext);
        const reopenedTeamRoom = reopenedRecords.find((record) => record.meetingId === teamRoom.meetingId);

        assert.ok(reopenedTeamRoom, 'a legacy room with a past expiresAt must survive store initialization');
        assert.equal(reopenedTeamRoom.status, 'active');
        assert.equal(reopenedTeamRoom.expiresAt, legacyRecord.expiresAt);
    } finally {
        if (previous.dataDir === undefined) delete process.env.WEBMEET_DATA_DIR;
        else process.env.WEBMEET_DATA_DIR = previous.dataDir;
        if (previous.masterKey === undefined) delete process.env.PLOINKY_WEBMEET_MASTER_KEY;
        else process.env.PLOINKY_WEBMEET_MASTER_KEY = previous.masterKey;
        await fs.rm(root, { recursive: true, force: true });
    }
});
