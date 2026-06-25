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

test('explorer does not expose AxiFace through a custom HTTP service', () => {
    const manifest = readManifest();
    const services = manifest.httpServices || [];
    assert.equal(services.some((service) => String(service?.externalPrefix || '').includes('axi-face')), false);
});

test('explorer exposes shared assets through the whitelisted shared route', () => {
    const manifest = readManifest();
    const sharedRoute = manifest.routerAccess?.httpRoutes?.find((entry) => entry?.path === '/shared/*');

    assert.equal(sharedRoute?.access, 'public');
});
