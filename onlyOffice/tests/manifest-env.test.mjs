import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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

test('manifest launches mounted source and separates recurring liveness from startup attestation', () => {
  const manifest = readManifest();

  assert.equal(manifest.start, '-lc "node /code/src/index.mjs"');
  assert.deepEqual(manifest.health?.liveness, {
    script: 'liveness.sh',
    interval: 5,
    timeout: 8,
    failureThreshold: 3,
    successThreshold: 1,
  });
  assert.equal(manifest.health?.readiness?.script, 'healthcheck.sh');
  assert.equal(manifest.health?.readiness?.continuous, false);
  for (const scriptName of ['liveness.sh', 'healthcheck.sh']) {
    assert.equal(fs.existsSync(path.join(agentRoot, scriptName)), true);
    assert.notEqual(
      fs.statSync(path.join(agentRoot, scriptName)).mode & 0o111,
      0,
      `the directly executed ${scriptName} probe must be executable`,
    );
  }
});

test('recurring liveness is transport-only while readiness retains full startup attestation', () => {
  const liveness = fs.readFileSync(path.join(agentRoot, 'scripts', 'liveness.sh'), 'utf8');
  const readiness = fs.readFileSync(path.join(agentRoot, 'scripts', 'healthcheck.sh'), 'utf8');

  assert.match(liveness, /127\.0\.0\.1:80\/healthcheck/);
  assert.match(liveness, /127\.0\.0\.1:7000/);
  assert.match(liveness, /127\.0\.0\.1:8080/);
  assert.match(liveness, /127\.0\.0\.1:9100/);
  assert.doesNotMatch(liveness, /\/proc/);
  assert.doesNotMatch(liveness, /(?:^|[\s`$(])ss(?:\s|$)/m);
  assert.doesNotMatch(liveness, /verify-document-server-jwt-config/);
  assert.doesNotMatch(liveness, /configure-docservice-nginx-loopback/);
  assert.doesNotMatch(liveness, /\bnode\b/);
  assert.match(readiness, /\/proc/);
  assert.match(readiness, /verify-document-server-jwt-config/);
  assert.match(readiness, /configure-docservice-nginx-loopback/);
});

function createFakeCurl(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyoffice-liveness-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const executable = path.join(directory, 'curl');
  fs.writeFileSync(executable, [
    '#!/bin/sh',
    'url=""',
    'for argument do url="$argument"; done',
    'printf "%s\\n" "$url" >> "$PLOINKY_FAKE_CURL_LOG"',
    'if [ "${PLOINKY_FAKE_CURL_FAIL_URL:-}" = "$url" ]; then exit 28; fi',
    'case "$url" in',
    '  http://127.0.0.1:7000/*|http://127.0.0.1:8080/*|http://127.0.0.1:9100/*)',
    '    printf "%s" 404',
    '    ;;',
    'esac',
    '',
  ].join('\n'), { mode: 0o755 });
  return directory;
}

test('recurring liveness executes every required endpoint and fails on nonresponse', (t) => {
  const fakeBin = createFakeCurl(t);
  const livenessPath = path.join(agentRoot, 'scripts', 'liveness.sh');
  const requiredUrls = [
    'http://127.0.0.1:80/healthcheck',
    'http://127.0.0.1:7000/__ploinky_liveness',
    'http://127.0.0.1:8080/healthcheck',
    'http://127.0.0.1:9100/__ploinky_liveness',
  ];
  const logPath = path.join(fakeBin, 'curl.log');
  const baseEnv = {
    ...process.env,
    PATH: `${fakeBin}:${process.env.PATH}`,
    PLOINKY_FAKE_CURL_LOG: logPath,
  };

  const healthy = spawnSync('bash', [livenessPath], {
    encoding: 'utf8',
    env: baseEnv,
  });
  assert.equal(healthy.status, 0, healthy.stderr);
  assert.deepEqual(
    fs.readFileSync(logPath, 'utf8').trim().split('\n'),
    requiredUrls,
  );

  for (const failUrl of requiredUrls) {
    fs.writeFileSync(logPath, '');
    const unavailable = spawnSync('bash', [livenessPath], {
      encoding: 'utf8',
      env: {
        ...baseEnv,
        PLOINKY_FAKE_CURL_FAIL_URL: failUrl,
      },
    });
    assert.notEqual(
      unavailable.status,
      0,
      `liveness must fail closed when ${failUrl} is stopped or nonresponsive`,
    );
  }
});

test('heavy activation readiness fails closed when DocumentServer is unavailable', (t) => {
  const fakeBin = createFakeCurl(t);
  const logPath = path.join(fakeBin, 'readiness-curl.log');
  const readiness = spawnSync('bash', [path.join(agentRoot, 'scripts', 'healthcheck.sh')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      PLOINKY_FAKE_CURL_LOG: logPath,
      PLOINKY_FAKE_CURL_FAIL_URL:
        'http://127.0.0.1:80/web-apps/apps/api/documents/api.js',
    },
  });
  assert.notEqual(readiness.status, 0);
  assert.deepEqual(
    fs.readFileSync(logPath, 'utf8').trim().split('\n'),
    ['http://127.0.0.1:80/web-apps/apps/api/documents/api.js'],
    'readiness must stop before validators when its required DocumentServer endpoint is absent',
  );
});

test('root probe wrappers stay dash-safe because Ploinky executes them with sh', () => {
  for (const wrapperName of ['liveness.sh', 'healthcheck.sh']) {
    const wrapper = fs.readFileSync(path.join(agentRoot, wrapperName), 'utf8');
    assert.match(
      wrapper,
      /^#!\/bin\/sh\n/,
      `${wrapperName} must use the #!/bin/sh wrapper convention`,
    );
    assert.doesNotMatch(
      wrapper,
      /pipefail/,
      `${wrapperName} runs under sh (dash on the pinned image), which rejects "set -o pipefail"`,
    );
    assert.match(
      wrapper,
      new RegExp(`exec bash /code/scripts/${wrapperName.replace(/\./g, '\\.')}`),
      `${wrapperName} must delegate to its bash implementation in scripts/`,
    );
  }
});

test('probe scripts parse under their declared interpreters', () => {
  for (const relativePath of ['scripts/liveness.sh', 'scripts/healthcheck.sh']) {
    const check = spawnSync('bash', ['-n', path.join(agentRoot, relativePath)], { encoding: 'utf8' });
    assert.equal(check.status, 0, `${relativePath} must parse: ${check.stderr}`);
  }
  for (const wrapperName of ['liveness.sh', 'healthcheck.sh']) {
    const check = spawnSync('sh', ['-n', path.join(agentRoot, wrapperName)], { encoding: 'utf8' });
    assert.equal(check.status, 0, `${wrapperName} must parse under sh: ${check.stderr}`);
  }
});

test('manifest stores image-owned service data below the agent .data root', () => {
  const manifest = readManifest();

  assert.deepEqual(manifest.volumes, {
    '.data/onlyOffice/log': '/var/log/onlyoffice',
    '.data/onlyOffice/data': '/var/www/onlyoffice/Data',
    '.data/onlyOffice/lib': '/var/lib/onlyoffice',
  });
  assert.equal(Object.keys(manifest.volumes).some((hostPath) => hostPath.includes('.ploinky')), false);
  const preinstall = fs.readFileSync(
    path.join(agentRoot, 'scripts', 'hooks', 'preinstall.sh'),
    'utf8',
  );
  assert.equal(preinstall.includes('${data_root}/postgresql'), false);
  assert.equal(preinstall.includes('${data_root}/rabbitmq'), false);
  assert.equal(preinstall.includes('${data_root}/redis'), false);
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
