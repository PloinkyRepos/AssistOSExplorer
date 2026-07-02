import { getUserPersistoStore } from '../storage/persisto-store.mjs';

const ACTIVE_RESERVATION_STATUSES = new Set(['pending']);

function normalizeAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('amount must be a positive number.');
  }
  return amount;
}

async function ensureCreditAccount(userId) {
  const store = getUserPersistoStore();
  const existing = await store.selectOne('creditAccount', { userId }).catch(() => null);
  if (existing) return existing;
  return store.create('creditAccount', {
    userId,
    currency: 'credit',
    status: 'active'
  });
}

async function writeEntry(userId, amount, reason = '', reference = '') {
  const store = getUserPersistoStore();
  await ensureCreditAccount(userId);
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
  await ensureCreditAccount(userId);
  const entries = await getUserPersistoStore().select('creditLedgerEntry', { userId }, { limit: 10000 });
  const reservations = await getUserPersistoStore().select('creditReservation', { userId }, { limit: 10000 });
  const balance = entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const reserved = reservations
    .filter((reservation) => ACTIVE_RESERVATION_STATUSES.has(String(reservation.status || '').trim()))
    .reduce((sum, reservation) => sum + Number(reservation.amount || 0), 0);
  return { userId, balance, reserved, available: balance - reserved, entries, reservations };
}

export async function addCredits(input = {}) {
  const userId = String(input.userId || '').trim();
  if (!userId) throw new Error('userId is required.');
  const amount = normalizeAmount(input.amount);
  const entry = await writeEntry(userId, amount, input.reason || 'manual_adjustment', input.reference || '');
  const balance = await getCreditBalance({ userId });
  return { ok: true, entry, balance: balance.balance };
}

export async function purchaseCredits(input = {}) {
  const userId = String(input.userId || '').trim();
  if (!userId) throw new Error('userId is required.');
  const amount = normalizeAmount(input.amount);
  const entry = await writeEntry(userId, amount, input.reason || 'purchase', input.reference || '');
  const balance = await getCreditBalance({ userId });
  return { ok: true, entry, balance: balance.balance, available: balance.available };
}

export async function consumeCredits(input = {}) {
  const userId = String(input.userId || '').trim();
  if (!userId) throw new Error('userId is required.');
  const amount = normalizeAmount(input.amount);
  const balance = await getCreditBalance({ userId });
  if (balance.available < amount) {
    throw new Error('Insufficient credits.');
  }
  const entry = await writeEntry(userId, -amount, input.reason || 'usage', input.reference || '');
  const nextBalance = await getCreditBalance({ userId });
  return { ok: true, entry, balance: nextBalance.balance, available: nextBalance.available };
}

export async function reserveCredits(input = {}) {
  const userId = String(input.userId || '').trim();
  if (!userId) throw new Error('userId is required.');
  const amount = normalizeAmount(input.amount);
  const balance = await getCreditBalance({ userId });
  if (balance.available < amount) {
    throw new Error('Insufficient credits.');
  }
  const reservation = await getUserPersistoStore().create('creditReservation', {
    userId,
    amount,
    reason: String(input.reason || 'usage_reservation'),
    reference: String(input.reference || ''),
    status: 'pending',
    committedAt: '',
    releasedAt: ''
  });
  await getUserPersistoStore().appendAudit('credits.reserve', {
    targetType: 'user',
    targetId: userId,
    metadata: { amount, reservationId: reservation.id, reason: reservation.reason, reference: reservation.reference }
  });
  const nextBalance = await getCreditBalance({ userId });
  return { ok: true, reservation, balance: nextBalance.balance, reserved: nextBalance.reserved, available: nextBalance.available };
}

export async function commitCredits(input = {}) {
  const reservationId = String(input.reservationId || '').trim();
  if (!reservationId) throw new Error('reservationId is required.');
  const reservation = await getUserPersistoStore().selectOne('creditReservation', { id: reservationId });
  if (!reservation) throw new Error('Credit reservation not found.');
  if (reservation.status !== 'pending') throw new Error(`Credit reservation is ${reservation.status}.`);
  const entry = await writeEntry(
    reservation.userId,
    -Number(reservation.amount || 0),
    input.reason || reservation.reason || 'usage_commit',
    input.reference || reservation.reference || reservation.id
  );
  const updated = await getUserPersistoStore().update('creditReservation', reservation.id, {
    status: 'committed',
    committedAt: new Date().toISOString()
  });
  await getUserPersistoStore().appendAudit('credits.commit', {
    targetType: 'user',
    targetId: reservation.userId,
    metadata: { reservationId: reservation.id, entryId: entry.id, amount: reservation.amount }
  });
  const balance = await getCreditBalance({ userId: reservation.userId });
  return { ok: true, reservation: updated, entry, balance: balance.balance, reserved: balance.reserved, available: balance.available };
}

export async function releaseCredits(input = {}) {
  const reservationId = String(input.reservationId || '').trim();
  if (!reservationId) throw new Error('reservationId is required.');
  const reservation = await getUserPersistoStore().selectOne('creditReservation', { id: reservationId });
  if (!reservation) throw new Error('Credit reservation not found.');
  if (reservation.status !== 'pending') throw new Error(`Credit reservation is ${reservation.status}.`);
  const updated = await getUserPersistoStore().update('creditReservation', reservation.id, {
    status: 'released',
    releasedAt: new Date().toISOString()
  });
  await getUserPersistoStore().appendAudit('credits.release', {
    targetType: 'user',
    targetId: reservation.userId,
    metadata: { reservationId: reservation.id, amount: reservation.amount }
  });
  const balance = await getCreditBalance({ userId: reservation.userId });
  return { ok: true, reservation: updated, balance: balance.balance, reserved: balance.reserved, available: balance.available };
}

export async function refundCredits(input = {}) {
  const userId = String(input.userId || '').trim();
  if (!userId) throw new Error('userId is required.');
  const amount = normalizeAmount(input.amount);
  const entry = await writeEntry(userId, amount, input.reason || 'refund', input.reference || '');
  const balance = await getCreditBalance({ userId });
  return { ok: true, entry, balance: balance.balance, available: balance.available };
}
