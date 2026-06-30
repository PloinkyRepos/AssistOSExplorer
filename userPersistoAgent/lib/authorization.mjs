import { findUserByEmail, findUserById } from './users.mjs';
import { getCreditBalance } from './credits/ledger.mjs';
import { userCanAccessClient } from './auth-clients.mjs';

export async function checkAccess(input = {}) {
  const user = input.userId
    ? await findUserById(input.userId)
    : input.email
      ? await findUserByEmail(input.email)
      : null;
  if (!user) {
    return { allowed: false, reason: 'user_not_found', user: null };
  }
  if (user.status && user.status !== 'active') {
    return { allowed: false, reason: 'user_inactive', user };
  }
  const clientId = String(input.clientId || '').trim();
  if (!clientId) {
    return { allowed: false, reason: 'client_required', user };
  }
  if (!userCanAccessClient(user, clientId)) {
    return { allowed: false, reason: 'role_denied', user };
  }
  const creditCost = Number(input.creditCost || 0);
  if (creditCost > 0) {
    const balance = await getCreditBalance({ userId: user.id });
    if (balance.balance < creditCost) {
      return { allowed: false, reason: 'insufficient_credits', user, balance: balance.balance };
    }
  }
  return { allowed: true, reason: 'allowed', user };
}
