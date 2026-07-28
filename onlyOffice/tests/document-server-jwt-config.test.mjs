import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { verifyDocumentServerJwtConfig } from '../scripts/verify-document-server-jwt-config.mjs';

const SHARED_SECRET = 'shared-onlyoffice-test-secret';
const TEST_ENV = Object.freeze({
  ONLYOFFICE_JWT_SECRET: SHARED_SECRET,
  JWT_SECRET: SHARED_SECRET,
});

function validConfig() {
  return {
    services: {
      CoAuthoring: {
        secret: Object.fromEntries(
          ['browser', 'inbox', 'outbox', 'session']
            .map((name) => [name, { string: SHARED_SECRET }]),
        ),
        token: {
          enable: {
            browser: true,
            request: {
              inbox: true,
              outbox: true,
            },
          },
          inbox: {
            inBody: true,
          },
          outbox: {
            algorithm: 'HS256',
            inBody: true,
          },
        },
      },
    },
  };
}

async function writeConfig(config) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'onlyoffice-jwt-config-'));
  const configFile = path.join(tempDir, 'local.json');
  await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`);
  return configFile;
}

test('readiness accepts the exact in-body JWT and shared-secret contract without mutation', async () => {
  const configFile = await writeConfig(validConfig());
  const before = await readFile(configFile);

  assert.equal(verifyDocumentServerJwtConfig({ configFile, env: TEST_ENV }), true);
  assert.deepEqual(await readFile(configFile), before);
});

test('readiness rejects missing, wrong, and non-boolean inbox in-body values without mutation', async () => {
  const cases = [
    ['missing', undefined],
    ['false', false],
    ['string', 'true'],
    ['number', 1],
  ];

  for (const [label, value] of cases) {
    const config = validConfig();
    if (value === undefined) {
      delete config.services.CoAuthoring.token.inbox.inBody;
    } else {
      config.services.CoAuthoring.token.inbox.inBody = value;
    }
    const configFile = await writeConfig(config);
    const before = await readFile(configFile);

    assert.throws(
      () => verifyDocumentServerJwtConfig({ configFile, env: TEST_ENV }),
      (error) => {
        assert.match(String(error?.message || ''), /inbox in-body JWT mode must be boolean true/);
        assert.equal(String(error?.message || '').includes(SHARED_SECRET), false);
        return true;
      },
      label,
    );
    assert.deepEqual(await readFile(configFile), before, label);
  }
});

test('readiness retains exact JWT enablement, algorithm, and secret agreement checks', async () => {
  const cases = [
    ['browser enablement', (config) => { config.services.CoAuthoring.token.enable.browser = false; }, /browser JWT validation/],
    ['inbox enablement', (config) => { config.services.CoAuthoring.token.enable.request.inbox = 'true'; }, /inbox JWT validation/],
    ['outbox enablement', (config) => { delete config.services.CoAuthoring.token.enable.request.outbox; }, /outbox JWT signing/],
    ['outbox in-body', (config) => { config.services.CoAuthoring.token.outbox.inBody = false; }, /outbox in-body JWT mode/],
    ['algorithm', (config) => { config.services.CoAuthoring.token.outbox.algorithm = 'HS384'; }, /algorithm must be HS256/],
    ['browser secret', (config) => { config.services.CoAuthoring.secret.browser.string = 'different'; }, /browser JWT secret/],
    ['missing session secret', (config) => { delete config.services.CoAuthoring.secret.session; }, /session JWT secret/],
  ];

  for (const [label, mutate, pattern] of cases) {
    const config = validConfig();
    mutate(config);
    const configFile = await writeConfig(config);
    const before = await readFile(configFile);

    assert.throws(
      () => verifyDocumentServerJwtConfig({ configFile, env: TEST_ENV }),
      (error) => {
        assert.match(String(error?.message || ''), pattern);
        assert.equal(String(error?.message || '').includes(SHARED_SECRET), false);
        return true;
      },
      label,
    );
    assert.deepEqual(await readFile(configFile), before, label);
  }

  const configFile = await writeConfig(validConfig());
  assert.throws(
    () => verifyDocumentServerJwtConfig({
      configFile,
      env: {
        ONLYOFFICE_JWT_SECRET: SHARED_SECRET,
        JWT_SECRET: 'different',
      },
    }),
    /must be present and identical/,
  );
});
