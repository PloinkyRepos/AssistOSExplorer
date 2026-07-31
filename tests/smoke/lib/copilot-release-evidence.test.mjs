import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  collectCopilotReleaseEvidence,
  sameCopilotReleaseGeneration,
} from './copilot-release-evidence.mjs';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const PLOINKY_SOURCE = '/candidate/ploinky';

function liveBox(overrides = {}) {
  return {
    capturedAt: '2026-07-31T10:00:00.000Z',
    box: {
      containerName: 'ploinky-box-exact',
      containerId: 'b'.repeat(64),
      startedAt: '2026-07-31T09:59:00.000Z',
      imageId: DIGEST,
      imageRef: 'localhost/ploinky-box:test',
      baseURL: 'http://127.0.0.1:8080',
      normalizedPortBindings: {
        '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '8080' }],
        '7882/udp': [{ HostIp: '0.0.0.0', HostPort: '7882' }],
      },
      ...overrides,
    },
    ploinkySourceMount: {
      type: 'bind',
      source: PLOINKY_SOURCE,
      destination: '/opt/ploinky',
      readWrite: false,
    },
  };
}

test('ordinary Copilot release evidence binds the verified manifest digest to the live Box', async () => {
  const calls = [];
  const result = await collectCopilotReleaseEvidence({
    manifestPath: '/candidate/release.json',
    verifierPath: '/candidate/verifier.mjs',
    baseURL: 'http://127.0.0.1:8080',
    loadVerifier: async (filePath) => {
      calls.push(['load', filePath]);
      return {
        verifyManifestFile(manifestPath) {
          calls.push(['verify', manifestPath]);
          return {
            imageDigest: DIGEST,
            repositories: {
              explorer: { commit: '1'.repeat(40) },
              ploinky: { commit: '2'.repeat(40), repositoryPath: PLOINKY_SOURCE },
            },
          };
        },
      };
    },
    collectLiveBox(options) {
      calls.push(['box', options]);
      return liveBox();
    },
    realpathSync: (value) => value,
  });
  assert.equal(result.imageDigest, DIGEST);
  assert.equal(result.liveBox.box.imageId, DIGEST);
  assert.deepEqual(calls.slice(0, 2), [
    ['load', '/candidate/verifier.mjs'],
    ['verify', '/candidate/release.json'],
  ]);
  assert.equal(calls[2][1].expectedImageId, DIGEST);
  assert.equal(calls[2][1].expectedPloinkySource, PLOINKY_SOURCE);
  assert.equal(result.ploinkySource.path, PLOINKY_SOURCE);
});

test('ordinary Copilot release evidence rejects missing manifest binding and wrong live image', async () => {
  await assert.rejects(
    () => collectCopilotReleaseEvidence({
      manifestPath: 'relative.json',
      verifierPath: '/candidate/verifier.mjs',
    }),
    /SMOKE_RELEASE_MANIFEST must be an absolute path/,
  );
  await assert.rejects(
    () => collectCopilotReleaseEvidence({
      manifestPath: '/candidate/release.json',
      verifierPath: '/candidate/verifier.mjs',
      loadVerifier: async () => ({
        verifyManifestFile: () => ({
          imageDigest: DIGEST,
          repositories: {
            ploinky: { commit: '2'.repeat(40), repositoryPath: PLOINKY_SOURCE },
          },
        }),
      }),
      collectLiveBox: () => liveBox({ imageId: `sha256:${'c'.repeat(64)}` }),
      realpathSync: (value) => value,
    }),
    /running Box image does not match/,
  );
});

test('ordinary Copilot release evidence rejects a Box without the verified read-only source mount', async () => {
  await assert.rejects(
    () => collectCopilotReleaseEvidence({
      manifestPath: '/candidate/release.json',
      verifierPath: '/candidate/verifier.mjs',
      loadVerifier: async () => ({
        verifyManifestFile: () => ({
          imageDigest: DIGEST,
          repositories: {
            ploinky: { commit: '2'.repeat(40), repositoryPath: PLOINKY_SOURCE },
          },
        }),
      }),
      collectLiveBox: () => ({ ...liveBox(), ploinkySourceMount: undefined }),
      realpathSync: (value) => value,
    }),
    /not bound read-only/,
  );
});

test('ordinary Copilot evidence requires the same immutable Box generation after the gate', () => {
  const before = {
    imageDigest: DIGEST,
    ploinkySource: { path: PLOINKY_SOURCE, commit: '2'.repeat(40) },
    liveBox: liveBox(),
  };
  assert.equal(sameCopilotReleaseGeneration(before, structuredClone(before)), true);
  const replacement = structuredClone(before);
  replacement.liveBox.box.containerId = 'd'.repeat(64);
  assert.equal(sameCopilotReleaseGeneration(before, replacement), false);
});

test('canonical runner consumes SMOKE_RELEASE_MANIFEST and passes bound evidence to the spec', () => {
  const runner = fs.readFileSync(
    path.resolve(import.meta.dirname, '../scripts/run-playwright.mjs'),
    'utf8',
  );
  const spec = fs.readFileSync(
    path.resolve(import.meta.dirname, '../specs/05-copilot-folder-launch.spec.mjs'),
    'utf8',
  );
  assert.match(runner, /SMOKE_RELEASE_MANIFEST/);
  assert.match(runner, /collectCopilotReleaseEvidence/);
  assert.match(runner, /sameCopilotReleaseGeneration/);
  assert.match(spec, /SMOKE_COPILOT_RELEASE_EVIDENCE/);
  assert.match(spec, /routerResponses\.every\(\(entry\) => entry\.status >= 200 && entry\.status < 300\)/);
  assert.match(spec, /completionToken = `COPILOT_CHAT_OK_\$\{correlation\}`/);
  assert.match(spec, /completed\.at\(-1\)\.text\)\.toContain\(completionToken\)/);
  assert.match(spec, /response\.status\(\) === 204 \? '' : response\.text\(\)/);
});
