import { getUserPersistoStore } from '../storage/persisto-store.mjs';

function normalizeAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('amount must be a positive number.');
  }
  return amount;
}

async function writeEntry(userId, amount, reason = '', reference = '') {
  const store = getUserPersistoStore();
  const entry = await store.create('creditLedgerEntry', {
    userId,
    amount,
    reason: String(reason || ''),
    reference: String(reference || '')
  });
  await store.appendAudit('credits.ledger.entry', {
    targetType: 'user',
    targetId: userId,
    metadata: { amount, reason, reference }
  });
  return entry;
}

export async function getCreditBalance(input = {}) {
  const userId = String(input.userId || '').trim();
  if (!userId) throw new Error('userId is required.');
  const entries = await getUserPersistoStore().select('creditLedgerEntry', { userId }, { limit: 10000 });
  const balance = entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  return { userId, balance, entries };
}

export async function addCredits(input = {}) {
  const userId = String(input.userId || '').trim();
  if (!userId) throw new Error('userId is required.');
  const amount = normalizeAmount(input.amount);
  const entry = await writeEntry(userId, amount, input.reason || 'manual_adjustment', input.reference || '');
  const balance = await getCreditBalance({ userId });
  return { ok: true, entry, balance: balance.balance };
}

export async function consumeCredits(input = {}) {
  const userId = String(input.userId || '').trim();
  if (!userId) throw new Error('userId is required.');
  const amount = normalizeAmount(input.amount);
  const balance = await getCreditBalance({ userId });
  if (balance.balance < amount) {
    throw new Error('Insufficient credits.');
  }
  const entry = await writeEntry(userId, -amount, input.reason || 'usage', input.reference || '');
  const nextBalance = await getCreditBalance({ userId });
  return { ok: true, entry, balance: nextBalance.balance };
}
