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
  assert.match(script, /\.ploinky\/data\/onlyOffice/);
  assert.doesNotMatch(script, /ONLYOFFICE_(?:PUBLIC|INTERNAL)_URL/);
  assert.doesNotMatch(script, /podman|docker|rm -rf|legacy.*(?:inspect|delete|migrate)/i);
});

test('preinstall hook is valid bash syntax', () => {
  const scriptPath = path.join(agentRoot, 'scripts/hooks/preinstall.sh');
  const result = spawnSync('bash', ['-n', scriptPath], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('OnlyOffice guidance preserves the v5 hard cut and contains no shadow-checkout runbook', () => {
  const guide = fs.readFileSync(path.join(agentRoot, 'CLAUDE.md'), 'utf8');
  const handoff = fs.readFileSync(
    path.resolve(agentRoot, '../docs/onlyoffice-confidential-doc-debug-handoff.md'),
    'utf8',
  );
  const prompt = fs.readFileSync(
    path.resolve(agentRoot, '../docs/onlyoffice-confidential-doc-debug-prompt.md'),
    'utf8',
  );

  assert.match(guide, /preinstall hook only initializes new v5 data directories/i);
  assert.doesNotMatch(guide, /removed by this agent(?:'s)? own preinstall/i);
  assert.match(handoff, /Historical evidence only/);
  assert.match(handoff, /No inbound\s+forwarding value is preserved or trusted/);
  assert.match(prompt, /Historical evidence only/);
  assert.match(prompt, /prompt is retired/i);
  for (const historicalDoc of [handoff, prompt]) {
    assert.doesNotMatch(historicalDoc, /```(?:bash|sh)|\brsync\b|\brm\s+-rf\b|\.ploinky\/repos|ploinky\s+(?:destroy|start|restart)/i);
    assert.doesNotMatch(historicalDoc, /127\.0\.0\.1:9100|stable[^\n]*\b9100\b/i);
    assert.doesNotMatch(historicalDoc, /preserv(?:e|es|ing) (?:incoming|inbound|caller)[^\n]*x-forwarded/i);
  }
});
