import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const agentRoot = path.resolve(__dirname, '..');

function readManifest() {
  return JSON.parse(fs.readFileSync(path.join(agentRoot, 'manifest.json'), 'utf8'));
}

function entriesByName(profileConfig) {
  return new Map((profileConfig.env || []).map((entry) => [entry.name, entry]));
}

function assertModernHttpService(service, label) {
  assert.equal(service?.access, 'authenticated', `${label} must declare authenticated access`);
  assert.equal(service?.auth, undefined, `${label} must not declare removed auth field`);
  assert.equal(service?.mode, undefined, `${label} must not declare removed mode field`);
  assert.equal(service?.forceGuest, undefined, `${label} must not declare removed forceGuest field`);
}

test('manifest injects the OnlyOffice JWT secret under decorator and Document Server names', () => {
  const manifest = readManifest();

  for (const profileName of ['default', 'dev', 'prod']) {
    const profile = manifest.profiles?.[profileName];
    assert.ok(profile, `profile ${profileName} exists`);

    const env = entriesByName(profile);
    const decoratorSecret = env.get('ONLYOFFICE_JWT_SECRET');
    const documentServerSecret = env.get('JWT_SECRET');

    assert.deepEqual(
      {
        varName: decoratorSecret?.varName,
        required: decoratorSecret?.required,
        sharedGeneratedSecret: decoratorSecret?.sharedGeneratedSecret,
      },
      {
        varName: 'ONLYOFFICE_JWT_SECRET',
        required: true,
        sharedGeneratedSecret: true,
      },
      `${profileName} exposes ONLYOFFICE_JWT_SECRET to the decorator runtime`
    );

    assert.deepEqual(
      {
        varName: documentServerSecret?.varName,
        required: documentServerSecret?.required,
        sharedGeneratedSecret: documentServerSecret?.sharedGeneratedSecret,
      },
      {
        varName: 'ONLYOFFICE_JWT_SECRET',
        required: true,
        sharedGeneratedSecret: true,
      },
      `${profileName} maps Document Server JWT_SECRET to the same generated secret`
    );
  }
});

test('manifest publishes router-facing control and browser-facing editor ports separately', () => {
  const manifest = readManifest();
  const expectedEditorPorts = new Map([
    ['default', '127.0.0.1:8082:8080'],
    ['dev', '127.0.0.1:18082:8080'],
    ['prod', '127.0.0.1:8082:8080'],
  ]);

  for (const [profileName, editorPort] of expectedEditorPorts) {
    const profile = manifest.profiles?.[profileName];
    assert.ok(profile, `profile ${profileName} exists`);

    const ports = profile.ports || [];
    assert.ok(
      ports.includes('127.0.0.1:0:7000'),
      `${profileName} publishes the protected control listener on an ephemeral localhost host port for Ploinky httpServices`
    );
    assert.ok(
      ports.includes(editorPort),
      `${profileName} keeps the browser-facing editor proxy on ${editorPort}`
    );
    assert.equal(
      ports.some((entry) => /:9100$/.test(String(entry))),
      false,
      `${profileName} does not publish the loopback storage listener`
    );
  }
});

test('manifest allows Document Server to fetch decorator loopback URLs without allowing metadata IPs', () => {
  const manifest = readManifest();

  for (const profileName of ['default', 'dev', 'prod']) {
    const profile = manifest.profiles?.[profileName];
    assert.ok(profile, `profile ${profileName} exists`);

    const env = entriesByName(profile);
    assert.deepEqual(
      {
        required: env.get('ALLOW_PRIVATE_IP_ADDRESS')?.required,
        default: env.get('ALLOW_PRIVATE_IP_ADDRESS')?.default,
      },
      {
        required: false,
        default: 'true',
      },
      `${profileName} lets Document Server fetch the decorator's 127.0.0.1 storage URL`
    );
    assert.equal(
      env.has('ALLOW_META_IP_ADDRESS'),
      false,
      `${profileName} must not enable metadata-address fetches`
    );
  }
});

test('manifest enables configurable Document Server auto assembly for open editors', () => {
  const manifest = readManifest();

  for (const profileName of ['default', 'dev', 'prod']) {
    const profile = manifest.profiles?.[profileName];
    assert.ok(profile, `profile ${profileName} exists`);

    const env = entriesByName(profile);
    assert.deepEqual(
      {
        enabled: env.get('ONLYOFFICE_AUTO_ASSEMBLY_ENABLED')?.default,
        interval: env.get('ONLYOFFICE_AUTO_ASSEMBLY_INTERVAL')?.default,
        step: env.get('ONLYOFFICE_AUTO_ASSEMBLY_STEP')?.default,
      },
      {
        enabled: 'true',
        interval: '1m',
        step: '1m',
      },
      `${profileName} exposes auto-assembly controls for callback-backed persistence`
    );
  }
});

test('manifest delegates Confidential storage to the deployed dpuAgent principal', () => {
  const manifest = readManifest();
  const service = manifest.httpServices?.find((entry) => entry?.slug === 'onlyoffice');
  assert.ok(service, 'onlyoffice http service exists');

  const targets = (service.delegations || []).map((entry) => entry?.targetAgentId);
  assert.deepEqual(
    targets,
    ['agent:./dpuAgent'],
    'delegation target must use same-repo "." so the manifest is portable across repo installs'
  );
});

test('onlyoffice control service uses authenticated Ploinky access schema', () => {
  const manifest = readManifest();
  const service = manifest.httpServices?.find((entry) => entry?.slug === 'onlyoffice');
  assert.ok(service, 'onlyoffice http service exists');

  assertModernHttpService(service, 'onlyoffice http service');
});

test('onlyoffice delegation targets dpuAgent in the same repo via "." with an explicit key', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url)));
  const delegation = manifest.httpServices[0].delegations[0];
  assert.equal(delegation.targetAgentId, 'agent:./dpuAgent');
  assert.equal(delegation.key, 'dpuConfidential');
});

test('onlyoffice DPU delegation is Confidential-path scoped and lasts for the workspace editing window', () => {
  const manifest = readManifest();
  const service = manifest.httpServices?.find((entry) => entry?.slug === 'onlyoffice');
  const delegation = service?.delegations?.[0];

  assert.deepEqual(delegation?.when, {
    queryParam: 'path',
    pathRoots: ['/Confidential'],
  });
  assert.equal(delegation?.ttlSeconds, 8 * 60 * 60);
});
