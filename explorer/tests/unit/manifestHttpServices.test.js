import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const explorerRoot = path.resolve(__dirname, '..', '..');

function readManifest() {
    return JSON.parse(fs.readFileSync(path.join(explorerRoot, 'manifest.json'), 'utf8'));
}

test('explorer has no legacy HTTP service registry', () => {
    const manifest = readManifest();
    assert.equal(Object.hasOwn(manifest, 'httpServices'), false);
});

test('explorer exposes shared assets through the whitelisted shared route', () => {
    const manifest = readManifest();
    const sharedRoute = manifest.routerAccess?.httpRoutes?.find((entry) => entry?.path === '/shared/*');

    assert.equal(sharedRoute?.access, 'public');
});
