import { getUserPersistoStore } from '../storage/persisto-store.mjs';
import { getRawSetting } from '../settings.mjs';

async function getStripeSecretKey() {
  return await getRawSetting('STRIPE_SECRET_KEY') || process.env.STRIPE_SECRET_KEY || '';
}

export async function getSubscription(input = {}) {
  const userId = String(input.userId || '').trim();
  if (!userId) throw new Error('userId is required.');
  const subscription = await getUserPersistoStore().selectOne('subscription', { userId });
  return { userId, subscription: subscription || null };
}

export async function createStripeCheckout(input = {}) {
  const secretKey = await getStripeSecretKey();
  if (!secretKey) {
    throw new Error('Stripe secret key is not configured.');
  }
  const userId = String(input.userId || '').trim();
  if (!userId) throw new Error('userId is required.');
  const mode = input.mode === 'subscription' ? 'subscription' : 'payment';
  const priceKey = mode === 'subscription' ? 'STRIPE_PRICE_SUBSCRIPTION' : 'STRIPE_PRICE_CREDITS';
  const price = await getRawSetting(priceKey) || process.env[priceKey] || '';
  if (!price) throw new Error(`${priceKey} is not configured.`);

  const body = new URLSearchParams();
  body.set('mode', mode);
  body.set('success_url', String(input.successUrl || ''));
  body.set('cancel_url', String(input.cancelUrl || ''));
  body.set('line_items[0][price]', price);
  body.set('line_items[0][quantity]', '1');
  body.set('metadata[userId]', userId);

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Stripe checkout failed with ${response.status}.`);
  }
  await getUserPersistoStore().appendAudit('billing.stripe.checkout.create', {
    targetType: 'user',
    targetId: userId,
    metadata: { mode, sessionId: payload.id }
  });
  return { ok: true, checkout: payload };
}
