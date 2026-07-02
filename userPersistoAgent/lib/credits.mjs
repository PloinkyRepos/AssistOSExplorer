import { randomUUID } from 'node:crypto';
import { getStore, flush } from './store.mjs';
import { recordAudit } from './audit.mjs';

const CREDIT_TYPES = new Set(['grant', 'purchase', 'spend', 'reserve', 'release', 'refund', 'adminAdjustment']);

function assertAmount(amount) {
    if (!Number.isInteger(amount) || amount <= 0) {
        throw new Error(`Amount must be a positive integer, got ${amount}`);
    }
}

function normalizeWindow({ start = 0, pageSize = 100 } = {}) {
    const normalizedStart = Number.isInteger(start) && start >= 0 ? start : 0;
    const normalizedPageSize = Number.isInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, 500) : 100;
    return { start: normalizedStart, pageSize: normalizedPageSize };
}

async function getAccount(store, userId) {
    const existing = await store.getCreditAccountByUserId(userId);
    if (existing) {
        return existing;
    }
    return store.createCreditAccount({ userId, balance: 0, reservedBalance: 0 });
}

async function appendTx(store, { userId, type, amount, reason = '', referenceId = '' }) {
    if (!CREDIT_TYPES.has(type)) {
        throw new Error(`Unknown credit transaction type: ${type}`);
    }
    return store.createCreditTx({
        txId: randomUUID(),
        userId,
        type,
        amount,
        reason: String(reason || ''),
        referenceId: String(referenceId || ''),
        createdAt: new Date().toISOString()
    });
}

async function mutate({ userId, type, amount, reason, referenceId, actorId, apply }) {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) {
        throw new Error('userId is required.');
    }
    assertAmount(amount);
    const store = await getStore();
    const account = await getAccount(store, normalizedUserId);
    const current = {
        balance: account.balance || 0,
        reservedBalance: account.reservedBalance || 0,
    };
    const next = apply(current);
    if (next.balance < 0 || next.reservedBalance < 0) {
        throw new Error(`Insufficient credits for ${type} of ${amount} (user ${normalizedUserId})`);
    }
    await appendTx(store, { userId: normalizedUserId, type, amount, reason, referenceId });
    await store.updateCreditAccount(account.id, {
        balance: next.balance,
        reservedBalance: next.reservedBalance,
    });
    await recordAudit({
        actorId: actorId || normalizedUserId,
        action: `credits.${type}`,
        target: normalizedUserId,
        reason: referenceId || reason || '',
    });
    await flush();
    return next;
}

export async function getBalance(userId) {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) {
        throw new Error('userId is required.');
    }
    const store = await getStore();
    const account = await getAccount(store, normalizedUserId);
    return {
        balance: account.balance || 0,
        reservedBalance: account.reservedBalance || 0,
    };
}

export function grant({ userId, amount, reason = '', actorId = 'system' }) {
    return mutate({
        userId,
        type: 'grant',
        amount,
        reason,
        actorId,
        apply: (account) => ({ ...account, balance: account.balance + amount }),
    });
}

export function applyPurchase({ userId, amount, referenceId = '' }) {
    return mutate({
        userId,
        type: 'purchase',
        amount,
        referenceId,
        actorId: 'stripe',
        apply: (account) => ({ ...account, balance: account.balance + amount }),
    });
}

export function reserve({ userId, amount, reason = '', referenceId = '' }) {
    return mutate({
        userId,
        type: 'reserve',
        amount,
        reason,
        referenceId,
        apply: (account) => ({
            balance: account.balance - amount,
            reservedBalance: account.reservedBalance + amount,
        }),
    });
}

export function commit({ userId, amount, referenceId = '' }) {
    return mutate({
        userId,
        type: 'spend',
        amount,
        referenceId,
        apply: (account) => ({
            ...account,
            reservedBalance: account.reservedBalance - amount,
        }),
    });
}

export function release({ userId, amount, referenceId = '' }) {
    return mutate({
        userId,
        type: 'release',
        amount,
        referenceId,
        apply: (account) => ({
            balance: account.balance + amount,
            reservedBalance: account.reservedBalance - amount,
        }),
    });
}

export function refund({ userId, amount, reason = '', referenceId = '', actorId = 'system' }) {
    return mutate({
        userId,
        type: 'refund',
        amount,
        reason,
        referenceId,
        actorId,
        apply: (account) => ({ ...account, balance: account.balance + amount }),
    });
}

export function adminAdjust({ userId, amount, reason = '', actorId = 'system' }) {
    return mutate({
        userId,
        type: 'adminAdjustment',
        amount,
        reason,
        actorId,
        apply: (account) => ({ ...account, balance: account.balance + amount }),
    });
}

export async function ledger({ userId, start = 0, pageSize = 100 } = {}) {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) {
        throw new Error('userId is required.');
    }
    const store = await getStore();
    const window = normalizeWindow({ start, pageSize });
    const result = await store.select('creditTx', { userId: normalizedUserId }, {
        sortBy: 'createdAt',
        descending: true,
        ...window,
    });
    return {
        entries: result.objects,
        totalCount: result.filteredCount ?? result.totalCount ?? result.objects.length,
    };
}
