import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const agentRoot = path.resolve(__dirname, '..');

test('preinstall defaults only the decorator internal URL to the in-container Document Server', () => {
  const script = fs.readFileSync(path.join(agentRoot, 'scripts/hooks/preinstall.sh'), 'utf8');

  assert.match(
    script,
    /set_default_var ONLYOFFICE_INTERNAL_URL "http:\/\/127\.0\.0\.1:80" "http:\/\/host\.containers\.internal:\$\{legacy_host_port\}"/
  );
  assert.match(script, /ONLYOFFICE_PUBLIC_URL is owned by the blocking Web Publishing config provider/);
  assert.doesNotMatch(script, /set_default_var ONLYOFFICE_PUBLIC_URL/);
  assert.doesNotMatch(script, /set_default_var ONLYOFFICE_CALLBACK_BASE_URL/);
  assert.doesNotMatch(script, /"http:\/\/host\.containers\.internal:8080"/);
});

test('preinstall hook is valid bash syntax', () => {
  const scriptPath = path.join(agentRoot, 'scripts/hooks/preinstall.sh');
  const result = spawnSync('bash', ['-n', scriptPath], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});
