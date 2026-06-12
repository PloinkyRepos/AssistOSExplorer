import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const CHAT_JS = path.resolve(TESTS_DIR, '..', 'IDE-plugins', 'web-assist-chat', 'web-assist-chat.js');

test('web-assist-chat prepares WAC context asynchronously before enabling send', async () => {
    const source = await fs.readFile(CHAT_JS, 'utf8');

    assert.match(source, /Preparing context please wait/);
    assert.match(source, /let isContextPreparing = false;/);
    assert.match(source, /const disabled = isPending \|\| isContextPreparing \|\| !siteId;/);
    assert.match(source, /if \(isPending \|\| isContextPreparing \|\| !siteId\)/);

    const branchMatch = source.match(/if \(!siteId && parentSiteUrl\) \{([\s\S]*?)\} else \{/);
    assert.ok(branchMatch, 'missing no-siteId parentSiteUrl initialization branch');

    const branch = branchMatch[1];
    assert.ok(
        branch.indexOf('activateChat();') < branch.indexOf('void prepareSiteContext(parentSiteUrl);'),
        'chat UI must activate before async context preparation starts'
    );
    assert.match(branch, /setContextPreparing\(true\);/);
});
