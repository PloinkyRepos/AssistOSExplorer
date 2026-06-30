import { getRawSetting } from './settings.mjs';

function normalizeEmail(value, field = 'email') {
  const email = String(value || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error(`${field} must be a valid email address.`);
  }
  return email;
}

async function getConfig() {
  const apiKey = await getRawSetting('MAILJET_API_KEY');
  const apiSecret = await getRawSetting('MAILJET_API_SECRET');
  const fromEmail = await getRawSetting('MAILJET_FROM_EMAIL');
  const fromName = await getRawSetting('MAILJET_FROM_NAME') || 'Ploinky';
  return { apiKey, apiSecret, fromEmail, fromName };
}

export async function testConfiguration() {
  const config = await getConfig();
  const missing = Object.entries({
    MAILJET_API_KEY: config.apiKey,
    MAILJET_API_SECRET: config.apiSecret
  }).filter(([, value]) => !value).map(([key]) => key);
  return { ok: missing.length === 0, missing };
}

async function sendMailjetMessage(message) {
  const config = await getConfig();
  const test = await testConfiguration();
  if (!test.ok) {
    throw new Error(`Missing EmailAgent settings: ${test.missing.join(', ')}.`);
  }
  if (!message?.From?.Email) {
    throw new Error('Email sender address is not configured. Set Mailjet From Email in EmailAgent settings.');
  }
  const auth = Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64');
  const response = await fetch('https://api.mailjet.com/v3.1/send', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ Messages: [message] })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.ErrorMessage || payload?.Messages?.[0]?.Errors?.[0]?.ErrorMessage || `Mailjet failed with ${response.status}.`);
  }
  return { ok: true, provider: 'mailjet', response: payload };
}

export async function sendTextEmail(input = {}) {
  const config = await getConfig();
  const to = normalizeEmail(input.to, 'to');
  const fromEmail = input.fromEmail ? normalizeEmail(input.fromEmail, 'fromEmail') : config.fromEmail;
  const subject = String(input.subject || '').trim();
  const textBody = String(input.textBody || '');
  if (!subject) throw new Error('subject is required.');
  if (!textBody) throw new Error('textBody is required.');
  return sendMailjetMessage({
    From: { Email: fromEmail, Name: config.fromName },
    To: [{ Email: to }],
    Subject: subject,
    TextPart: textBody
  });
}

export async function sendTemplateEmail(input = {}) {
  const config = await getConfig();
  const to = normalizeEmail(input.to, 'to');
  const fromEmail = input.fromEmail ? normalizeEmail(input.fromEmail, 'fromEmail') : config.fromEmail;
  const templateId = Number(input.templateId || await getRawSetting('EMAIL_AUTH_CODE_TEMPLATE_ID'));
  if (!Number.isFinite(templateId) || templateId <= 0) {
    throw new Error('templateId is required.');
  }
  return sendMailjetMessage({
    From: { Email: fromEmail, Name: config.fromName },
    To: [{ Email: to }],
    Subject: String(input.subject || ''),
    TemplateID: templateId,
    TemplateLanguage: true,
    Variables: input.variables && typeof input.variables === 'object' ? input.variables : {}
  });
}

export async function sendAuthCodeEmail(input = {}) {
  const email = normalizeEmail(input.to || input.email, 'email');
  const code = String(input.code || '').trim();
  const expiresAt = String(input.expiresAt || '').trim();
  if (!code) throw new Error('code is required.');
  if (!expiresAt) throw new Error('expiresAt is required.');

  const templateId = await getRawSetting('EMAIL_AUTH_CODE_TEMPLATE_ID');
  if (templateId) {
    return sendTemplateEmail({
      to: email,
      templateId,
      variables: { code, expiresAt, email },
      subject: 'Your sign-in code'
    });
  }

  return sendTextEmail({
    to: email,
    subject: 'Your sign-in code',
    textBody: `Your sign-in code is ${code}. It expires at ${expiresAt}.`
  });
}
