import assert from 'node:assert/strict';
import test from 'node:test';

import { explorerUrl, navigateToExplorer } from './explorer.mjs';

test('Explorer URL construction preserves the final encoded hash in one target', () => {
  assert.equal(explorerUrl(), '/explorer/index.html');
  assert.equal(
    explorerUrl('file-exp/Confidential/My%20Space'),
    '/explorer/index.html#file-exp/Confidential/My%20Space',
  );
  assert.equal(
    explorerUrl('#file-exp/Confidential/Secrets/'),
    '/explorer/index.html#file-exp/Confidential/Secrets/',
  );
});

test('Explorer navigation signs in once to the final target without a direct page navigation', async () => {
  const page = {
    goto() {
      throw new Error('navigateToExplorer must not perform a second direct page navigation');
    },
  };
  const account = Object.freeze({ username: 'user', password: 'password' });
  const calls = [];

  await navigateToExplorer(
    page,
    { account, hash: 'file-exp/Confidential/Secrets/' },
    async (...args) => {
      calls.push(args);
    },
  );

  assert.deepEqual(calls, [[
    page,
    account,
    '/explorer/index.html#file-exp/Confidential/Secrets/',
  ]]);
});
