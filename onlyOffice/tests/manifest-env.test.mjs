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

test('manifest launches mounted source and exposes a root-level readiness script', () => {
  const manifest = readManifest();

  assert.equal(manifest.start, '-lc "node /code/src/index.mjs"');
  assert.equal(manifest.health?.readiness?.script, 'healthcheck.sh');
  assert.equal(fs.existsSync(path.join(agentRoot, 'healthcheck.sh')), true);
  assert.notEqual(
    fs.statSync(path.join(agentRoot, 'healthcheck.sh')).mode & 0o111,
    0,
    'the directly executed readiness probe must be executable',
  );
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

test('manifest declares distinct Router targets without physical-host publications', () => {
  const manifest = readManifest();

  assert.deepEqual(manifest.routerAccess?.httpRoutes?.map(({ path: routePath, access }) => ({ path: routePath, access })), [
    {
      path: '/base-agent-additional-server/onlyOffice/7000/control/*',
      access: 'authenticated',
    },
    {
      path: '/base-agent-additional-server/onlyOffice/8080/*',
      access: 'public',
    },
  ]);
  assert.equal(Object.hasOwn(manifest, 'httpServices'), false);
  for (const profileName of ['default', 'dev', 'prod']) {
    const profile = manifest.profiles?.[profileName];
    assert.ok(profile, `profile ${profileName} exists`);
    assert.equal(Object.hasOwn(profile, 'openPorts'), false);
    assert.equal(Object.hasOwn(profile, ['additional', 'Server', 'Port'].join('')), false);
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
  const route = manifest.routerAccess?.httpRoutes?.find((entry) => (
    entry?.path === '/base-agent-additional-server/onlyOffice/7000/control/*'
  ));
  assert.ok(route, 'onlyoffice control route exists');

  const targets = (route.delegations || []).map((entry) => entry?.targetAgentId);
  assert.deepEqual(
    targets,
    ['agent:./dpuAgent'],
    'delegation target must use same-repo "." so the manifest is portable across repo installs'
  );
});

test('onlyoffice control route uses authenticated Ploinky access policy', () => {
  const manifest = readManifest();
  const route = manifest.routerAccess?.httpRoutes?.find((entry) => (
    entry?.path === '/base-agent-additional-server/onlyOffice/7000/control/*'
  ));
  assert.equal(route?.access, 'authenticated');
});

test('onlyoffice delegation targets dpuAgent in the same repo via "." with an explicit key', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url)));
  const delegation = manifest.routerAccess.httpRoutes[0].delegations[0];
  assert.equal(delegation.targetAgentId, 'agent:./dpuAgent');
  assert.equal(delegation.key, 'dpuConfidential');
});

test('onlyoffice DPU delegation is Confidential-path scoped and lasts for the workspace editing window', () => {
  const manifest = readManifest();
  const route = manifest.routerAccess?.httpRoutes?.find((entry) => (
    entry?.path === '/base-agent-additional-server/onlyOffice/7000/control/*'
  ));
  const delegation = route?.delegations?.[0];

  assert.deepEqual(delegation?.when, {
    queryParam: 'path',
    pathRoots: ['/Confidential'],
  });
  assert.equal(delegation?.ttlSeconds, 8 * 60 * 60);
});
