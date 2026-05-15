import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

function readBool(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function readInt(name, fallback) {
  const value = Number.parseInt(String(process.env[name] || ''), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '') || 'http://127.0.0.1:8080';
}

function defaultRunId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `${stamp}-${process.pid}`;
}

const runId = String(process.env.SMOKE_RUN_ID || defaultRunId()).replace(/[^A-Za-z0-9_-]/g, '-');
const artifactRoot = path.resolve(
  process.env.SMOKE_ARTIFACT_DIR || path.join(repoRoot, '.ploinky', 'test-artifacts', 'headless-smoke', runId)
);
fs.mkdirSync(artifactRoot, { recursive: true });

export const smokeConfig = Object.freeze({
  repoRoot,
  runId,
  artifactRoot,
  baseURL: stripTrailingSlash(process.env.SMOKE_BASE_URL || process.env.PLAYWRIGHT_BASE_URL),
  primaryUser: {
    username: process.env.SMOKE_USERNAME || 'admin',
    password: process.env.SMOKE_PASSWORD || 'admin',
  },
  secondaryUser: {
    username: process.env.SMOKE_SECONDARY_USERNAME || 'user',
    password: process.env.SMOKE_SECONDARY_PASSWORD || 'user',
  },
  webchatAgent: process.env.SMOKE_WEBCHAT_AGENT || 'achilles-cli',
  flags: {
    failOnBrowserErrors: !readBool('SMOKE_ALLOW_BROWSER_ERRORS', false),
    github: readBool('SMOKE_GITHUB', false),
    onlyoffice: readBool('SMOKE_ONLYOFFICE', false),
    openInterpreter: readBool('SMOKE_OPEN_INTERPRETER', false),
    webmeetMedia: readBool('SMOKE_WEBMEET_MEDIA', false),
    webmeetScreen: readBool('SMOKE_WEBMEET_SCREEN', false),
  },
  timeouts: {
    action: readInt('SMOKE_ACTION_TIMEOUT_MS', 20_000),
    expect: readInt('SMOKE_EXPECT_TIMEOUT_MS', 12_000),
    navigation: readInt('SMOKE_NAVIGATION_TIMEOUT_MS', 45_000),
    test: readInt('SMOKE_TEST_TIMEOUT_MS', 120_000),
    relay: readInt('SMOKE_RELAY_TIMEOUT_MS', 420_000),
    media: readInt('SMOKE_MEDIA_TIMEOUT_MS', 60_000),
  },
});

export function smokeArtifactPath(...segments) {
  const target = path.join(smokeConfig.artifactRoot, ...segments);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  return target;
}
