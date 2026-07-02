import { createHmac, timingSafeEqual } from 'node:crypto';
import { getStore, flush } from './store.mjs';
import { getSecret } from './settings.mjs';
import { applyPurchase } from './credits.mjs';
import { recordAudit } from './audit.mjs';

function parseStripeSignature(signatureHeader) {
    const parts = {};
    for (const part of String(signatureHeader || '').split(',')) {
        const separator = part.indexOf('=');
        if (separator < 0) continue;
        const key = part.slice(0, separator);
        const value = part.slice(separator + 1);
        if (!parts[key]) {
            parts[key] = [];
        }
        parts[key].push(value);
    }
    return parts;
}

function positiveInteger(value, fallback = 1) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
}

export function verifyStripeSignature(rawBody, signatureHeader, secret) {
    const parts = parseStripeSignature(signatureHeader);
    const timestamp = parts.t?.[0] || '';
    const signatures = parts.v1 || [];
    if (!timestamp || signatures.length === 0 || !secret) return false;
    const timestampSeconds = Number(timestamp);
    if (!Number.isFinite(timestampSeconds)) return false;
    if (Math.abs(Date.now() / 1000 - timestampSeconds) > 300) return false;
    const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    const expectedBytes = Buffer.from(expected);
    return signatures.some((signature) => {
        const actualBytes = Buffer.from(String(signature));
        return actualBytes.length === expectedBytes.length && timingSafeEqual(expectedBytes, actualBytes);
    });
}

async function stripeRequest(path, form) {
    const key = await getSecret('STRIPE_SECRET_KEY');
    if (!key) throw new Error('STRIPE_SECRET_KEY is not configured.');
    const response = await fetch(`https://api.stripe.com/v1/${path}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(form),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data?.error?.message || `Stripe ${path} failed (${response.status})`);
    }
    return data;
}

export async function createCheckout({ userId, kind, quantity = 1 }) {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) {
        throw new Error('userId is required.');
    }
    if (!['credits', 'subscription'].includes(kind)) {
        throw new Error(`Unknown checkout kind: ${kind}`);
    }
    const price = await getSecret(kind === 'credits' ? 'STRIPE_PRICE_CREDITS' : 'STRIPE_PRICE_SUBSCRIPTION');
    if (!price) throw new Error(`Stripe price for ${kind} is not configured.`);
    const units = positiveInteger(quantity);
    const form = {
        mode: kind === 'credits' ? 'payment' : 'subscription',
        client_reference_id: normalizedUserId,
        'line_items[0][price]': price,
        'line_items[0][quantity]': String(units),
        'metadata[kind]': kind,
        'metadata[units]': String(units),
        'metadata[userId]': normalizedUserId,
        success_url: 'https://localhost/billing/success',
        cancel_url: 'https://localhost/billing/cancel',
    };
    if (kind === 'subscription') {
        form['subscription_data[metadata][userId]'] = normalizedUserId;
    }
    const session = await stripeRequest('checkout/sessions', form);
    await recordAudit({ actorId: normalizedUserId, action: 'billing.checkout.create', target: session.id, reason: kind });
    return { url: session.url, sessionId: session.id };
}

async function upsertSubscription(store, object, eventType) {
    const userId = String(object.metadata?.userId || object.client_reference_id || '').trim();
    if (!userId || !object.id) {
        return;
    }
    const record = {
        providerRef: String(object.id),
        userId,
        provider: 'stripe',
        planId: object.items?.data?.[0]?.price?.id || '',
        status: eventType === 'customer.subscription.deleted' ? 'canceled' : (object.status || 'unknown'),
        currentPeriodEnd: object.current_period_end ? new Date(object.current_period_end * 1000).toISOString() : '',
    };
    const existing = await store.getSubscriptionByProviderRef(record.providerRef);
    if (existing) {
        await store.updateSubscription(existing.id, record);
    } else {
        await store.createSubscription(record);
    }
}

export async function processStripeWebhook({ rawBody, signatureHeader }) {
    const secret = await getSecret('STRIPE_WEBHOOK_SECRET');
    if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not configured.');
    if (!verifyStripeSignature(rawBody, signatureHeader, secret)) {
        throw new Error('Invalid Stripe signature');
    }

    const event = JSON.parse(rawBody);
    const eventId = String(event.id || '').trim();
    if (!eventId) {
        throw new Error('Stripe event id is required.');
    }
    const store = await getStore();
    if (await store.getBillingEventByStripeEventId(eventId)) {
        return { processed: false, duplicate: true, eventId };
    }

    const object = event.data?.object || {};
    if (event.type === 'checkout.session.completed' && object.metadata?.kind === 'credits') {
        const userId = object.client_reference_id;
        const units = positiveInteger(object.metadata?.units);
        const perUnit = positiveInteger(await getSecret('USERPERSISTO_CREDITS_PER_UNIT'), 1);
        await applyPurchase({ userId, amount: units * perUnit, referenceId: object.id });
    } else if (String(event.type || '').startsWith('customer.subscription.')) {
        await upsertSubscription(store, object, event.type);
    }

    await store.createBillingEvent({
        stripeEventId: eventId,
        type: String(event.type || ''),
        status: 'processed',
        payloadHash: createHmac('sha256', secret).update(rawBody).digest('base64url'),
        processedAt: new Date().toISOString()
    });
    await recordAudit({ actorId: 'stripe', action: 'billing.webhook.process', target: eventId, reason: event.type });
    await flush();
    return { processed: true, duplicate: false, eventId };
}

export async function getSubscription(userId) {
    const store = await getStore();
    const subs = await store.getSubscriptionsObjectsByUserId(userId) || [];
    return subs.find((subscription) => subscription.status === 'active') || subs[0] || null;
}

export async function listBillingEvents({ start = 0, pageSize = 100 } = {}) {
    const normalizedStart = Number.isInteger(start) && start >= 0 ? start : 0;
    const normalizedPageSize = Number.isInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, 500) : 100;
    const store = await getStore();
    return store.select('billingEvent', {}, {
        sortBy: 'processedAt',
        descending: true,
        start: normalizedStart,
        pageSize: normalizedPageSize,
    });
}
