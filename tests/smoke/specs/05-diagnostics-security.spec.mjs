import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';

import { attachPageDiagnostics, expect, test } from '../lib/fixtures.mjs';
import {
  createRedactor,
  findDiagnosticLeaks,
  redactDiagnosticValue,
} from '../lib/security.mjs';
import { expectRelayIceSelected } from '../lib/webmeet.mjs';

const syntheticJwt = [
  'eyJhbGciOiJIUzI1NiJ9',
  'eyJzdWIiOiJzbW9rZS11c2VyIn0',
  'synthetic_signature_for_regression',
].join('.');
const syntheticJoinRequest = JSON.stringify({
  room: 'security-комната-🚀',
  participantToken: syntheticJwt,
  metadata: 'x'.repeat(4096),
});

function signalingUrl(overrides = '') {
  return `ws://127.0.0.1:8081/rtc/v1?auto_subscribe=1&${overrides}`;
}

test('redactor removes generated signaling credentials and preserves safe query values', () => {
  const redact = createRedactor([]);
  const encodedJoinRequest = encodeURIComponent(syntheticJoinRequest);
  const input = signalingUrl(`access_token=${syntheticJwt}&join_request=${encodedJoinRequest}&adaptive_stream=1`);
  const output = redact(input);

  expect(output).not.toContain(syntheticJwt);
  expect(output).not.toContain(encodedJoinRequest);
  expect(output).toContain('access_token=[REDACTED]');
  expect(output).toContain('join_request=[REDACTED]');
  expect(output).toContain('auto_subscribe=1');
  expect(output).toContain('adaptive_stream=1');
  expect(redact(output)).toBe(output);
  expect(findDiagnosticLeaks(output, [])).toEqual([]);
});

test('redactor handles encoded names, headers, nested fields, and standalone JWTs', () => {
  const redact = createRedactor([]);
  const encodedNameUrl = signalingUrl(`%61ccess%5Ftoken=${syntheticJwt}&tokenize=visible`);
  const nested = {
    location: { url: encodedNameUrl },
    join_request: {
      room: 'must-not-persist',
      participantToken: syntheticJwt,
    },
    headers: `Authorization: Bearer ${syntheticJwt}\nCookie: session=${syntheticJwt}`,
    freeText: `connection rejected for ${syntheticJwt}`,
    tokenize: 'visible',
  };
  const output = redactDiagnosticValue(nested, redact);
  const serialized = JSON.stringify(output);

  expect(serialized).not.toContain(syntheticJwt);
  expect(serialized).not.toContain('must-not-persist');
  expect(serialized).not.toContain('%61ccess%5Ftoken');
  expect(output.tokenize).toBe('visible');
  expect(output.location.url).toContain('tokenize=visible');
  expect(findDiagnosticLeaks(serialized, [])).toEqual([]);
});

test('redactor and independent detector cover RTC and serialized secret shapes', () => {
  const redact = createRedactor([]);
  const probes = [
    '{"password":"synthetic-password-value"}',
    'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\na=ice-pwd:synthetic-ice-password\r\n',
    'candidate:1 1 UDP 2122260223 192.0.2.10 50000 typ host',
    'turn:synthetic-user:synthetic-pass@turn.example.test:3478?transport=udp',
    '-----BEGIN PRIVATE KEY-----\nsynthetic-private-key\n-----END PRIVATE KEY-----',
    'token%253Dsynthetic-double-encoded-value',
  ];

  for (const probe of probes) {
    expect(findDiagnosticLeaks(probe, [])).not.toEqual([]);
    const output = redact(probe);
    expect(output).not.toBe(probe);
    expect(findDiagnosticLeaks(output, [])).toEqual([]);
    expect(redact(output)).toBe(output);
  }
});

test('redaction markers cannot hide suffixes and Unicode-escaped secret syntax', () => {
  const redact = createRedactor([]);
  const sentinel = 'SYNTHETIC_SENTINEL';
  const probes = [
    `password=[REDACTED]${sentinel}`,
    `password=[REDACTED:${sentinel}]`,
    `secret=<redacted-sensitive-string>${sentinel}`,
    `secret=<redacted-${sentinel}>`,
    String.raw`{"pass\u0077ord":"SYNTHETIC_SENTINEL"}`,
    String.raw`{"password"\u003a"SYNTHETIC_SENTINEL"}`,
    String.raw`{"pass\u{77}ord":"SYNTHETIC_SENTINEL"}`,
    'password%u003DSYNTHETIC_SENTINEL',
  ];

  for (const probe of probes) {
    expect(findDiagnosticLeaks(probe, [])).not.toEqual([]);
    const output = redact(probe);
    expect(output).not.toContain(sentinel);
    expect(findDiagnosticLeaks(output, [])).toEqual([]);
    expect(redact(output)).toBe(output);
  }
});

test('over-budget encoded diagnostic input fails closed', () => {
  const redact = createRedactor([]);
  const probe = `token%3D${'x'.repeat(70 * 1024)}`;
  const output = redact(probe);

  expect(output).toBe('<redacted-encoded-string>');
  expect(findDiagnosticLeaks(probe, [])).toContain('DYNAMIC_ENCODED_INPUT_OVER_BUDGET');
  expect(findDiagnosticLeaks(output, [])).toEqual([]);
});

test('relay-only smoke mode fails fast unless media checks are enabled', () => {
  const configUrl = new URL('../lib/config.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, [
    '--input-type=module',
    '--eval',
    `import(${JSON.stringify(configUrl)})`,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SMOKE_WEBMEET_MEDIA: '0',
      SMOKE_WEBMEET_REQUIRE_RELAY: '1',
    },
  });

  expect(child.status).not.toBe(0);
  expect(child.stderr).toContain('SMOKE_WEBMEET_REQUIRE_RELAY=1 requires SMOKE_WEBMEET_MEDIA=1');
});

test('relay assertion evaluates one nonempty selected-pair snapshot atomically', async () => {
  let reads = 0;
  const page = {
    async evaluate() {
      reads += 1;
      if (reads === 1) {
        return [{ state: 'succeeded', candidateType: 'relay', protocol: 'udp' }];
      }
      return [];
    },
  };

  await expectRelayIceSelected(page);
  expect(reads).toBe(1);
});

test('browser-event writer redacts every record before persistence', async ({}, testInfo) => {
  const page = new EventEmitter();
  const diagnostics = attachPageDiagnostics(page, testInfo, 'security-boundary');
  const encodedJoinRequest = encodeURIComponent(syntheticJoinRequest);
  const url = signalingUrl(`access_token=${syntheticJwt}&join_request=${encodedJoinRequest}`);

  page.emit('console', {
    type: () => 'error',
    text: () => `WebSocket failed for ${url}`,
    location: () => ({ url, lineNumber: 12, columnNumber: 4 }),
  });
  page.emit('requestfailed', {
    url: () => url,
    method: () => 'GET',
    failure: () => ({ errorText: `net::ERR_FAILED ${syntheticJwt}` }),
  });

  const events = await diagnostics.flush();
  const filePath = testInfo.outputPath('diagnostics', 'security-boundary.browser-events.json');
  const payload = fs.readFileSync(filePath, 'utf8');
  const mode = fs.statSync(filePath).mode & 0o777;

  expect(payload).not.toContain(syntheticJwt);
  expect(payload).not.toContain(encodedJoinRequest);
  expect(payload).not.toContain('security-комната-🚀');
  expect(payload).toContain('access_token=[REDACTED]');
  expect(payload).toContain('join_request=[REDACTED]');
  expect(findDiagnosticLeaks(payload, [])).toEqual([]);
  expect(JSON.stringify(events)).not.toContain(syntheticJwt);
  expect(mode).toBe(0o600);
});

test('Playwright trace capture stays disabled for credential-bearing browser flows', async ({}, testInfo) => {
  expect(testInfo.project.use.trace).toBe('off');
});
