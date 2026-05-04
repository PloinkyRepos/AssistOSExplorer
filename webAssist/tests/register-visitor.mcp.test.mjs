import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { registerVisitor } from '../src/mcp/register-visitor.mjs';
import { createWebAssistSandbox } from './helpers.mjs';

test('register-visitor appends visitor events to visitors.log', async (t) => {
    const sandbox = await createWebAssistSandbox();
    t.after(async () => sandbox.cleanup());

    const first = await registerVisitor({
        visitorId: 'visitor-alpha',
        agentRoot: sandbox.agentRoot,
        dataDir: sandbox.dataDir,
    });

    assert.equal(first.ok, true);
    assert.equal(first.logFile, 'visitors.log');
    assert.equal(first.visitorId, 'visitor-alpha');

    const second = await registerVisitor({
        visitorId: 'visitor-alpha',
        agentRoot: sandbox.agentRoot,
        dataDir: sandbox.dataDir,
    });

    assert.equal(second.ok, true);
    assert.equal(second.visitorId, 'visitor-alpha');

    const logPath = path.join(sandbox.dataDir, 'visitors.log');
    const content = await fs.readFile(logPath, 'utf8');
    const lines = content.split(/\r?\n/).filter(Boolean);
    assert.equal(lines.length, 2);

    const firstEvent = JSON.parse(lines[0]);
    const secondEvent = JSON.parse(lines[1]);

    assert.equal(firstEvent.visitorId, 'visitor-alpha');
    assert.equal(firstEvent.source, 'web-assist-chat');
    assert.equal(firstEvent.version, 1);

    assert.equal(secondEvent.visitorId, 'visitor-alpha');
    assert.equal(secondEvent.source, 'web-assist-chat');
    assert.equal(secondEvent.version, 1);
});
