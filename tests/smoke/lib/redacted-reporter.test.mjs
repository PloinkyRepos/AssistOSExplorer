import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import RedactedReporter, { redactReportBuffer } from './redacted-reporter.mjs';
import { redactTraceText } from './redacted-trace.mjs';

const smokeRoot = path.resolve(import.meta.dirname, '..');

test('API call-log redaction preserves the failure, URL and nonsensitive headers', () => {
  const message = 'apiRequestContext.get: socket hang up\nCall log:\n  - GET http://127.0.0.1:1234/failure\n'
    + '\x1b[2m    - Cookie: session=opaque-cookie; csrf=opaque-csrf\x1b[22m\n'
    + '\x1b[2m    - Authorization: Bearer opaque-bearer\x1b[22m\n'
    + '    - x-ploinky-csrf-token: opaque-header\n    - Accept: application/json';
  const safe = redactTraceText(message);
  for (const secret of ['opaque-cookie', 'opaque-csrf', 'opaque-bearer', 'opaque-header']) {
    assert.equal(safe.includes(secret), false);
  }
  assert.match(safe, /socket hang up/);
  assert.match(safe, /GET http:\/\/127\.0\.0\.1:1234\/failure/);
  assert.match(safe, /Accept: application\/json/);
  assert.match(safe, /Cookie: \[REDACTED:HEADER\]/);
  const binary = Buffer.from([0, 1, 2, 255]);
  assert.equal(redactReportBuffer(binary), binary);
});

test('unreadable attachments fail reporting instead of reaching later reporters', () => {
  const reporter = new RedactedReporter();
  reporter.onBegin({ projects: [{ outputDir: os.tmpdir() }] }, { allTests: () => [] });
  const result = { status: 'passed', errors: [], steps: [], stdout: [], stderr: [],
    attachments: [{ name: 'missing', path: path.join(os.tmpdir(), `absent-${process.pid}-${Date.now()}`), contentType: 'text/plain' }] };
  reporter.onTestEnd({}, result);
  assert.equal(result.status, 'failed');
  assert.match(result.error.message, /redaction failed/);
  assert.equal(result.attachments[0].path, undefined);
  assert.deepEqual(reporter.onEnd(), { status: 'failed' });
});

test('an absent project output directory cannot hide a later valid attachment root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explorer-report-roots-'));
  try {
    const attachmentPath = path.join(root, 'api-error.txt');
    fs.writeFileSync(attachmentPath, 'Cookie: session=opaque-cookie\nFailure: socket hang up');
    const reporter = new RedactedReporter();
    reporter.onBegin({ projects: [{ outputDir: path.join(root, 'missing') }, { outputDir: root }] }, { allTests: () => [] });
    const result = { status: 'passed', errors: [], steps: [], stdout: [], stderr: [],
      attachments: [{ name: 'api-error', path: attachmentPath, contentType: 'text/plain' }] };
    reporter.onTestEnd({}, result);
    assert.equal(result.status, 'passed');
    assert.equal(result.errors.length, 0);
    assert.equal(result.attachments[0].path, attachmentPath);
    assert.equal(fs.readFileSync(attachmentPath, 'utf8'), 'Cookie: [REDACTED:HEADER]\nFailure: socket hang up');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function filesUnder(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? filesUnder(target) : [target];
  });
}

test('a real failed API request stays failed and every built-in report omits dynamic authentication', { timeout: 30_000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explorer-report-redaction-'));
  try {
    const spec = path.join(root, 'api-error.spec.mjs');
    fs.writeFileSync(spec, `
import { test } from ${JSON.stringify(pathToFileURL(path.join(smokeRoot, 'node_modules/@playwright/test/index.mjs')).href)};
import http from 'node:http';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
test('API request failure remains visible', async ({ request }, testInfo) => {
  const cookie = randomUUID();
  const csrf = randomUUID();
  const bearer = randomUUID();
  fs.writeFileSync(process.env.REDACTION_SECRET_FILE, JSON.stringify([cookie, csrf, bearer]));
  const server = http.createServer((incoming) => incoming.socket.destroy());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let failure;
  try {
    await request.get('http://127.0.0.1:' + server.address().port + '/failure', {
      headers: { Cookie: 'session=' + cookie + '; csrf=' + csrf, Authorization: 'Bearer ' + bearer },
    });
  } catch (error) {
    failure = error;
    const context = testInfo.outputPath('error-context.md');
    fs.writeFileSync(context, '# API failure\\n' + error.stack);
    await testInfo.attach('error-context', { path: context, contentType: 'text/markdown' });
    await testInfo.attach('inline-api-error', { body: Buffer.from(error.stack), contentType: 'text/plain' });
    await testInfo.attach('binary-evidence', { body: Buffer.from([0, 1, 2, 255]), contentType: 'application/octet-stream' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  throw failure || new Error('request unexpectedly succeeded');
});
`);
    for (const sanitize of [false, true]) {
      const artifactRoot = path.join(root, sanitize ? 'safe' : 'baseline');
      const configPath = path.join(root, sanitize ? 'safe.config.mjs' : 'baseline.config.mjs');
      const secretsPath = path.join(root, sanitize ? 'safe-secrets.json' : 'baseline-secrets.json');
      fs.writeFileSync(configPath, `
import config from ${JSON.stringify(pathToFileURL(path.join(smokeRoot, 'playwright.config.mjs')).href)};
const reporter = config.reporter.filter(([name]) => ${sanitize} || name !== './lib/redacted-reporter.mjs')
  .map(([name, options]) => [name === './lib/redacted-reporter.mjs' ? ${JSON.stringify(path.join(smokeRoot, 'lib/redacted-reporter.mjs'))} : name, options]);
export default { ...config, testDir: ${JSON.stringify(root)}, testMatch: 'api-error.spec.mjs', reporter, retries: 0, workers: 1 };
`);
      const run = spawnSync(process.execPath, [path.join(smokeRoot, 'node_modules/playwright/cli.js'), 'test', '--config', configPath], {
        cwd: smokeRoot,
        env: { ...process.env, SMOKE_ARTIFACT_DIR: artifactRoot, REDACTION_SECRET_FILE: secretsPath,
          SMOKE_QA_ACCEPTANCE: '0', PLAYWRIGHT_HTML_OPEN: 'never', PW_TEST_REPORTER: '' },
        encoding: 'utf8', timeout: 15_000,
      });
      assert.equal(run.status, 1, 'the real request failure must remain a failed test');
      const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
      const results = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'test-results/results.json'), 'utf8'));
      assert.equal(results.stats.unexpected, 1);
      assert.equal(results.stats.expected, 0);
      assert.equal(results.stats.skipped, 0);
      assert.equal(results.stats.flaky, 0);
      assert.match(run.stdout, /socket hang up/);
      const artifactFiles = filesUnder(artifactRoot);
      const report = fs.readFileSync(path.join(artifactRoot, 'playwright-report/index.html'), 'utf8');
      const embedded = report.match(/<template id="playwrightReportBase64">data:application\/zip;base64,([^<]+)<\/template>/);
      assert.ok(embedded, 'HTML report must retain its embedded data');
      const zipPath = path.join(root, sanitize ? 'safe-report.zip' : 'baseline-report.zip');
      fs.writeFileSync(zipPath, Buffer.from(embedded[1], 'base64'));
      const zip = spawnSync('/usr/bin/unzip', ['-p', zipPath], { encoding: 'utf8' });
      assert.equal(zip.status, 0);
      const outputs = [run.stdout, run.stderr, zip.stdout,
        ...artifactFiles.map((file) => fs.readFileSync(file).toString('utf8'))];
      if (!sanitize) {
        assert.ok(secrets.every((secret) => run.stdout.includes(secret)), 'baseline must reproduce the actual call-log leak');
        assert.ok(secrets.every((secret) => zip.stdout.includes(secret)), 'baseline must reproduce the embedded HTML leak');
      } else {
        for (const secret of secrets) {
          const index = outputs.findIndex((output) => output.includes(secret));
          assert.equal(index, -1, `credential reached ${['stdout', 'stderr', 'HTML data', ...artifactFiles.map((file) => path.relative(artifactRoot, file))][index]}`);
        }
        assert.match(JSON.stringify(results), /socket hang up/);
        assert.match(zip.stdout, /socket hang up/);
        assert.ok(artifactFiles.some((file) => file.endsWith('error-context.md')));
        assert.ok(artifactFiles.some((file) => fs.readFileSync(file).equals(Buffer.from([0, 1, 2, 255]))));
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
