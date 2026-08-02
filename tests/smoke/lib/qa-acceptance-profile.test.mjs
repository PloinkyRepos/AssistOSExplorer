import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { validateQaAcceptanceProfile } from './qa-acceptance-profile.mjs';

test('QA acceptance is headless and pinned to the public Explorer QA origin', () => {
  assert.deepEqual(validateQaAcceptanceProfile({
    enabled: true,
    headed: false,
    baseURL: 'https://explorer-qa.axiologic.dev',
    edgeIP: '104.21.57.223',
  }), {
    enabled: true,
    headed: false,
    baseURL: 'https://explorer-qa.axiologic.dev',
    edgeIP: '104.21.57.223',
  });
  assert.throws(
    () => validateQaAcceptanceProfile({
      enabled: true,
      headed: true,
      baseURL: 'https://explorer-qa.axiologic.dev',
    }),
    /requires headless/,
  );
  assert.throws(
    () => validateQaAcceptanceProfile({
      enabled: true,
      headed: false,
      baseURL: 'https://skills.axiologic.dev',
    }),
    /exact https:\/\/explorer-qa\.axiologic\.dev origin/,
  );
  assert.throws(
    () => validateQaAcceptanceProfile({
      enabled: true,
      headed: false,
      baseURL: 'https://explorer-qa.axiologic.dev/unexpected',
    }),
    /exact https:\/\/explorer-qa\.axiologic\.dev origin/,
  );
  assert.throws(
    () => validateQaAcceptanceProfile({
      enabled: true,
      headed: false,
      baseURL: 'https://explorer-qa.axiologic.dev',
      edgeIP: '127.0.0.1',
    }),
    /public IPv4/,
  );
  assert.throws(
    () => validateQaAcceptanceProfile({
      enabled: false,
      headed: false,
      baseURL: '',
      edgeIP: '104.21.57.223',
    }),
    /only with SMOKE_QA_ACCEPTANCE/,
  );
});

test('npm QA acceptance profile selects exactly the two public QA browser tests', () => {
  const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const command = packageJson.scripts?.['test:qa'];
  assert.equal(typeof command, 'string');
  assert.match(command, /\bSMOKE_QA_ACCEPTANCE=1\b/);
  assert.match(command, /\bspecs\/80-explorer-qa-acceptance\.spec\.mjs\b/);
  assert.doesNotMatch(command, /--headed|specs\/(?:00|10|15|20|30|31|32|33|34|40|50|60|61|70)-/);
});

test('QA WebMeet evidence retains both canonical Explorer principals', () => {
  const acceptanceSpec = fs.readFileSync(
    new URL('../specs/80-explorer-qa-acceptance.spec.mjs', import.meta.url),
    'utf8',
  );
  assert.match(
    acceptanceSpec,
    /owner:\s*{\s*id:\s*ownerPrincipal\.canonicalId,\s*username:\s*ownerPrincipal\.canonicalUsername\s*}/,
  );
  assert.match(
    acceptanceSpec,
    /member:\s*{\s*id:\s*memberPrincipal\.canonicalId,\s*username:\s*memberPrincipal\.canonicalUsername\s*}/,
  );
  assert.doesNotMatch(acceptanceSpec, /(?:owner|member)Principal\.(?:id|username)\b/);
});

test('QA OnlyOffice acceptance unloads and proves durable DPU persistence before reopening', () => {
  const acceptanceSpec = fs.readFileSync(
    new URL('../specs/80-explorer-qa-acceptance.spec.mjs', import.meta.url),
    'utf8',
  );
  const start = acceptanceSpec.indexOf("test('legacy Confidential .doc edits in OnlyOffice");
  const end = acceptanceSpec.indexOf("test('two generated users join one WebMeet room", start);
  assert.ok(start >= 0 && end > start, 'OnlyOffice QA acceptance test body must be present.');
  const onlyOfficeTest = acceptanceSpec.slice(start, end);
  const reload = onlyOfficeTest.indexOf("await page.reload({ waitUntil: 'domcontentloaded' });");
  const durableGate = onlyOfficeTest.indexOf(
    'dpuSnapshotPersistenceAdvanced(initialSnapshot, callbackSnapshot)',
  );
  const identityGate = onlyOfficeTest.indexOf('callbackSnapshot?.id === initialSnapshot.id');
  const reopen = onlyOfficeTest.indexOf('reopened = await openConfidentialDoc(page, documentPath);');
  assert.ok(reload >= 0, 'OnlyOffice QA acceptance must perform a real document unload.');
  assert.ok(identityGate > reload, 'OnlyOffice QA acceptance must preserve the DPU object identity.');
  assert.ok(durableGate > reload, 'OnlyOffice QA acceptance must verify persistence after unloading.');
  assert.ok(reopen > durableGate, 'OnlyOffice QA acceptance must not reopen before persistence is durable.');
});
