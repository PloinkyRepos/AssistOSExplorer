import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const CHAT_JS = path.resolve(TESTS_DIR, '..', 'IDE-plugins', 'web-assist-chat', 'web-assist-chat.js');

test('web-assist-chat does not prepare WAC context from iframe load', async () => {
    const source = await fs.readFile(CHAT_JS, 'utf8');

    assert.doesNotMatch(source, /prepare-wac/);
    assert.doesNotMatch(source, /prepareWAC/);
    assert.doesNotMatch(source, /Preparing context please wait/);
    assert.doesNotMatch(source, /isContextPreparing/);
    assert.match(source, /const disabled = isPending \|\| !siteId;/);
    assert.match(source, /if \(isPending \|\| !siteId\)/);
});
