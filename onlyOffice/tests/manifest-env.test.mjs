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

test('manifest delegates Confidential storage to the deployed dpuAgent principal', () => {
  const manifest = readManifest();
  const service = manifest.httpServices?.find((entry) => entry?.slug === 'onlyoffice');
  assert.ok(service, 'onlyoffice http service exists');

  const targets = (service.delegations || []).map((entry) => entry?.targetAgentId);
  assert.deepEqual(
    targets,
    ['agent:AchillesIDE/dpuAgent'],
    'delegation target must match the principal Ploinky injects into the deployed dpuAgent runtime'
  );
});
