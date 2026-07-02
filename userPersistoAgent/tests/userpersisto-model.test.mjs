import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'userpersisto-model-'));
const persistoDir = path.join(tmpDir, 'Persisto', 'src');
await fs.mkdir(persistoDir, { recursive: true });
await fs.writeFile(path.join(persistoDir, 'PersistoClient.cjs'), `
class PersistoClient {
  constructor() {
    globalThis.__userPersistoTestStore ||= {};
  }
  async addType(types) {
    for (const table of Object.keys(types || {})) {
      globalThis.__userPersistoTestStore[table] ||= [];
    }
    return true;
  }
  async execute(method, ...args) {
    const store = globalThis.__userPersistoTestStore;
    if (method === 'select') {
      const [table, filter = {}, options = {}] = args;
      const rows = [...(store[table] || [])].filter((record) => {
        return Object.entries(filter || {}).every(([key, value]) => {
          if (value === undefined || value === null || value === '') return true;
          return record?.[key] === value;
        });
      });
      if (options.sortBy) {
        rows.sort((left, right) => String(left?.[options.sortBy] || '').localeCompare(String(right?.[options.sortBy] || '')));
      }
      return Number.isFinite(options.limit) ? rows.slice(0, options.limit) : rows;
    }
    if (method === 'createIndex') {
      return true;
    }
    if (method.startsWith('create')) {
      const table = method.slice('create'.length).replace(/^./, (char) => char.toLowerCase());
      store[table] ||= [];
      const record = { ...args[0] };
      store[table].push(record);
      return record;
    }
    if (method.startsWith('update')) {
      const table = method.slice('update'.length).replace(/^./, (char) => char.toLowerCase());
      const [id, patch] = args;
      const rows = store[table] || [];
      const index = rows.findIndex((record) => record.id === id || record.userId === id || record.email === id);
      if (index < 0) throw new Error(table + ' record not found');
      rows[index] = { ...rows[index], ...patch };
      return rows[index];
    }
    if (method.startsWith('delete')) {
      const table = method.slice('delete'.length).replace(/^./, (char) => char.toLowerCase());
      const [id] = args;
      store[table] = (store[table] || []).filter((record) => record.id !== id);
      return { ok: true };
    }
    throw new Error('Unknown fake Persisto method: ' + method);
  }
}
module.exports = PersistoClient;
`, 'utf8');

process.env.USERPERSISTO_DATA_DIR = tmpDir;
process.env.PERSISTO_URL = 'http://persisto.test';
process.env.USERPERSISTO_SETTINGS_SECRET = 'test-secret';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const { ensureUserPersistoSchema, resetUserPersistoSchemaForTests } = await import('../lib/storage/ensure-schema.mjs');
const { getUserPersistoStore, resetUserPersistoStore } = await import('../lib/storage/persisto-store.mjs');
const { createUser } = await import('../lib/users.mjs');
const { authorizeCapability } = await import('../lib/authorization.mjs');
const { addCredits, getCreditBalance, reserveCredits, commitCredits, releaseCredits } = await import('../lib/credits/ledger.mjs');
const { verifyEmailCode } = await import('../lib/auth/email-code.mjs');
const { handleStripeWebhook } = await import('../lib/billing/stripe.mjs');

function resetStore() {
  globalThis.__userPersistoTestStore = {};
  resetUserPersistoSchemaForTests();
  resetUserPersistoStore();
}

function emailCodeHash(email, code) {
  return crypto.createHash('sha256').update(`${email}:${code}:${process.env.USERPERSISTO_SETTINGS_SECRET}`).digest('hex');
}

function stripeSignature(rawBody, secret = process.env.STRIPE_WEBHOOK_SECRET) {
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

test('seeds roles and authorizes named capabilities', async () => {
  resetStore();
  await ensureUserPersistoSchema();
  const user = await createUser({ email: 'user@example.com', role: 'user' });
  const allowed = await authorizeCapability({ userId: user.id, capability: 'explorer.access' });
  assert.equal(allowed.allowed, true);
  const denied = await authorizeCapability({ userId: user.id, capability: 'billing.admin' });
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'capability_denied');
  const admin = await createUser({ email: 'admin@example.com', role: 'admin' });
  const adminExplorer = await authorizeCapability({ userId: admin.id, capability: 'explorer.access' });
  assert.equal(adminExplorer.allowed, true);
  const adminBilling = await authorizeCapability({ userId: admin.id, capability: 'billing.admin' });
  assert.equal(adminBilling.allowed, false);
  assert.equal(adminBilling.reason, 'capability_denied');
});

test('email codes are consumed after first verification', async () => {
  resetStore();
  await ensureUserPersistoSchema();
  const user = await createUser({ email: 'code@example.com', role: 'user' });
  const store = getUserPersistoStore();
  await store.create('emailAuthCode', {
    email: user.email,
    codeHash: emailCodeHash(user.email, '123456'),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    consumedAt: '',
    attempts: 0,
    lastAttempt: '',
    verifiedAt: ''
  });
  const first = await verifyEmailCode({ email: user.email, code: '123456' });
  assert.equal(first.ok, true);
  await assert.rejects(() => verifyEmailCode({ email: user.email, code: '123456' }), /already used/i);
});

test('credit reservations affect available balance and can commit or release', async () => {
  resetStore();
  await ensureUserPersistoSchema();
  const user = await createUser({ email: 'credits@example.com', role: 'user' });
  await addCredits({ userId: user.id, amount: 10, reason: 'seed' });
  const reserved = await reserveCredits({ userId: user.id, amount: 4, reason: 'job' });
  assert.equal(reserved.available, 6);
  await releaseCredits({ reservationId: reserved.reservation.id });
  assert.equal((await getCreditBalance({ userId: user.id })).available, 10);
  const second = await reserveCredits({ userId: user.id, amount: 3, reason: 'job' });
  const committed = await commitCredits({ reservationId: second.reservation.id });
  assert.equal(committed.balance, 7);
  assert.equal(committed.available, 7);
});

test('Stripe webhook processing is idempotent and applies credit purchases', async () => {
  resetStore();
  await ensureUserPersistoSchema();
  const user = await createUser({ email: 'stripe@example.com', role: 'user' });
  const event = {
    id: 'evt_123',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_123',
        mode: 'payment',
        metadata: { userId: user.id, creditsAmount: '12' }
      }
    }
  };
  const rawBody = JSON.stringify(event);
  const signature = stripeSignature(rawBody);
  const first = await handleStripeWebhook({ rawBody, signature });
  assert.equal(first.ok, true);
  assert.equal(first.duplicate, false);
  assert.equal((await getCreditBalance({ userId: user.id })).balance, 12);
  const second = await handleStripeWebhook({ rawBody, signature });
  assert.equal(second.duplicate, true);
  assert.equal((await getCreditBalance({ userId: user.id })).balance, 12);
});
