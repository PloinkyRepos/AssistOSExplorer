import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const explorerRoot = path.resolve(__dirname, '..', '..');

const VALID_SERVICE_ACCESS = new Set(['public', 'guest', 'authenticated']);
const REMOVED_SERVICE_FIELDS = ['auth', 'mode', 'forceGuest'];

function readManifest() {
    return JSON.parse(fs.readFileSync(path.join(explorerRoot, 'manifest.json'), 'utf8'));
}

function assertModernHttpService(service, label) {
    assert.ok(VALID_SERVICE_ACCESS.has(service.access), `${label} must declare access: public | guest | authenticated`);

    for (const field of REMOVED_SERVICE_FIELDS) {
        assert.equal(service[field], undefined, `${label} must not declare removed ${field} field`);
    }
}

test('explorer manifest http services use the Ploinky access schema', () => {
    const manifest = readManifest();
    const services = manifest.httpServices || [];
    assert.ok(services.length > 0, 'explorer manifest declares http services');

    for (const service of services) {
        assertModernHttpService(service, service.externalPrefix || service.slug || 'http service');
    }
});

test('explorer avatar and AxiFace services remain authenticated', () => {
    const manifest = readManifest();
    const services = new Map((manifest.httpServices || []).map((service) => [service.externalPrefix, service]));

    assert.equal(services.get('/services/explorer/avatar-settings/')?.access, 'authenticated');
    assert.equal(services.get('/services/explorer/axi-face/')?.access, 'authenticated');
});
