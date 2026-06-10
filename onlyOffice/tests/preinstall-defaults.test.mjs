import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const agentRoot = path.resolve(__dirname, '..');

test('preinstall defaults the decorator internal URL to the in-container Document Server', () => {
  const script = fs.readFileSync(path.join(agentRoot, 'scripts/hooks/preinstall.sh'), 'utf8');

  assert.match(
    script,
    /set_default_var ONLYOFFICE_INTERNAL_URL "http:\/\/127\.0\.0\.1:80" "http:\/\/host\.containers\.internal:\$\{host_port\}"/
  );
  assert.match(script, /legacy self-loop default/);
});

test('preinstall hook is valid bash syntax', () => {
  const scriptPath = path.join(agentRoot, 'scripts/hooks/preinstall.sh');
  const result = spawnSync('bash', ['-n', scriptPath], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});
