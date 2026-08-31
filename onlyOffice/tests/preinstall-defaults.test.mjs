import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const agentRoot = path.resolve(__dirname, '..');

test('preinstall is a hard-cut data-directory initializer only', () => {
  const script = fs.readFileSync(path.join(agentRoot, 'scripts/hooks/preinstall.sh'), 'utf8');

  assert.match(script, /Runtime contract v5 is a hard cut/);
  assert.match(script, /\.data\/onlyOffice/);
  assert.doesNotMatch(script, /\.ploinky\/data\/onlyOffice/);
  assert.doesNotMatch(script, /ONLYOFFICE_(?:PUBLIC|INTERNAL)_URL/);
  assert.doesNotMatch(script, /podman|docker|rm -rf|legacy.*(?:inspect|delete|migrate)/i);
});

test('preinstall hook is valid bash syntax', () => {
  const scriptPath = path.join(agentRoot, 'scripts/hooks/preinstall.sh');
  const result = spawnSync('bash', ['-n', scriptPath], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});
