import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePloinkyExecutable } from './ploinky-executable.mjs';

test('Box-mode targeted restarts require an absolute candidate Ploinky binary', () => {
  assert.throws(
    () => resolvePloinkyExecutable({ deploymentMode: 'box', configured: '' }),
    /require SMOKE_PLOINKY_BIN/,
  );
  assert.throws(
    () => resolvePloinkyExecutable({ deploymentMode: 'box', configured: 'ploinky' }),
    /must be an absolute path/,
  );
  assert.equal(
    resolvePloinkyExecutable({
      deploymentMode: 'box',
      configured: '/candidate/ploinky/bin/ploinky',
    }),
    '/candidate/ploinky/bin/ploinky',
  );
});

test('non-Box runs retain command lookup unless explicitly configured', () => {
  assert.equal(resolvePloinkyExecutable({ deploymentMode: '', configured: '' }), 'ploinky');
  assert.equal(
    resolvePloinkyExecutable({ deploymentMode: '', configured: 'candidate-ploinky' }),
    'candidate-ploinky',
  );
});
