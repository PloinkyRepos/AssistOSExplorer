import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// shared/invocation-auth.mjs is a byte-for-byte mirror of the canonical Ploinky
// helper. Agent tool wrappers load `/Agent/lib/invocation-auth.mjs` (staged
// in-container) first and fall back to this shared copy for local/dev execution,
// so the two MUST stay identical. This guard fails fast on drift. When the
// sibling Ploinky checkout is absent (standalone clone / in-container), it skips.
const sharedCopy = fileURLToPath(new URL('../invocation-auth.mjs', import.meta.url));
const ploinkyCopy = fileURLToPath(new URL('../../../ploinky/Agent/lib/invocation-auth.mjs', import.meta.url));

test('shared/invocation-auth.mjs matches the canonical ploinky helper byte-for-byte', (t) => {
    if (!fs.existsSync(ploinkyCopy)) {
        t.skip('sibling ploinky/Agent/lib/invocation-auth.mjs not present');
        return;
    }
    const shared = fs.readFileSync(sharedCopy);
    const canonical = fs.readFileSync(ploinkyCopy);
    assert.ok(
        shared.equals(canonical),
        'shared/invocation-auth.mjs has drifted from ploinky/Agent/lib/invocation-auth.mjs; re-sync the mirror'
    );
});
