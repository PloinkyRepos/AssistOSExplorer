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

test('manifest blocks startup on the real editor API readiness path', () => {
  const manifest = readManifest();

  assert.equal(manifest.readiness, undefined);
  assert.deepEqual(manifest.health?.readiness, {
    script: 'readiness.sh',
    interval: 2,
    timeout: 5,
    failureThreshold: 90,
  });
});

test('manifest joins only the office publishing trust zone with a derived DNS name', () => {
  const manifest = readManifest();

  assert.deepEqual(manifest.network, {
    mode: 'bridge',
    attachments: [
      { name: 'office-publishing', primary: true },
    ],
  });
  assert.equal(JSON.stringify(manifest.network).includes('aliases'), false);
});

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

test('manifest leaves the provider-owned public URL without a dead static port fallback', () => {
  const manifest = readManifest();

  for (const profileName of ['default', 'dev', 'prod']) {
    const profile = manifest.profiles?.[profileName];
    const publicUrl = entriesByName(profile).get('ONLYOFFICE_PUBLIC_URL');

    // Ploinky rejects required non-secret profile entries without static
    // defaults. Runtime config still requires this value after the blocking
    // Web Publishing provider has resolved the active topology.
    assert.equal(publicUrl?.required, false, `${profileName} delegates the URL to the startup provider`);
    assert.equal(publicUrl?.default, undefined, `${profileName} does not retain a retired direct-port fallback`);
  }
});

test('manifest keeps control routing private and publishes no OnlyOffice box-boundary ports', () => {
  const manifest = readManifest();

  for (const profileName of ['default', 'dev', 'prod']) {
    const profile = manifest.profiles?.[profileName];
    assert.ok(profile, `profile ${profileName} exists`);

    assert.equal(
      profile.additionalServerPort,
      '7000',
      `${profileName} gives the router a private ephemeral route to the protected control listener`
    );
    assert.equal(profile.openPorts, undefined, `${profileName} publishes no OnlyOffice port across the box boundary`);
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
