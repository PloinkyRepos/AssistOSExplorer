import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertDistinctAuthenticatedPrincipals,
  normalizePrincipalComponent,
  validateAuthenticatedPrincipal,
} from './auth.mjs';

test('authenticated principals are normalized and matched to the configured account', () => {
  const principal = validateAuthenticatedPrincipal({
    id: ' LOCAL:User-One ',
    username: 'UsEr-One',
    roles: ['USER'],
  }, { expectedUsername: ' user-one ' });
  assert.deepEqual(principal, {
    canonicalId: 'local:user-one',
    canonicalUsername: 'user-one',
    roles: ['user'],
  });
  assert.equal(normalizePrincipalComponent('\uff21dmin'), 'admin');
});

test('authenticated principal verification fails closed on missing, guest, or mismatched identity', () => {
  assert.throws(() => validateAuthenticatedPrincipal(null), /no user principal/);
  assert.throws(() => validateAuthenticatedPrincipal({ id: '', username: 'user', roles: ['user'] }), /principal id/);
  assert.throws(() => validateAuthenticatedPrincipal({ id: 'local:user', username: '', roles: ['user'] }), /principal username/);
  assert.throws(() => validateAuthenticatedPrincipal({ id: 'guest:one', username: 'guest', roles: ['guest'] }), /guest principal/);
  assert.throws(() => validateAuthenticatedPrincipal({ id: 'guest:one', username: 'visitor', roles: [] }), /guest principal/);
  assert.throws(() => validateAuthenticatedPrincipal({
    id: 'local:user', username: 'actual', roles: ['user'],
  }, { expectedUsername: 'configured' }), /does not match/);
});

test('distinct-account proof rejects case-folded aliases and the same immutable id', () => {
  const first = validateAuthenticatedPrincipal({ id: 'local:one', username: 'one', roles: ['user'] });
  const second = validateAuthenticatedPrincipal({ id: 'local:two', username: 'two', roles: ['user'] });
  assert.equal(assertDistinctAuthenticatedPrincipals(first, second).length, 2);

  assert.throws(() => assertDistinctAuthenticatedPrincipals(
    first,
    validateAuthenticatedPrincipal({ id: 'LOCAL:ONE', username: 'alias', roles: ['user'] }),
  ), /distinct authenticated principals/);
  assert.throws(() => assertDistinctAuthenticatedPrincipals(
    first,
    validateAuthenticatedPrincipal({ id: 'local:other', username: 'ONE', roles: ['user'] }),
  ), /distinct authenticated principals/);
});
