import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = process.env.EMAIL_AGENT_DATA_DIR || '/emailagent-data';
const SETTINGS_FILE = path.join(DATA_DIR, 'email-agent-settings.json');
const SETTING_KEYS = [
  'MAILJET_API_KEY',
  'MAILJET_API_SECRET',
  'MAILJET_FROM_EMAIL',
  'MAILJET_FROM_NAME',
  'EMAIL_AUTH_CODE_TEMPLATE_ID'
];
const SETTING_ALIASES = {
  MAILJET_API_SECRET: ['MAILJET_SECRET_KEY']
};
const PUBLIC_SETTING_KEYS = new Set([
  'MAILJET_FROM_EMAIL',
  'MAILJET_FROM_NAME',
  'EMAIL_AUTH_CODE_TEMPLATE_ID'
]);
function settingNames(key) {
  return [key, ...(SETTING_ALIASES[key] || [])];
}

function requiredSettingsSecret() {
  const secret = String(process.env.EMAIL_AGENT_SETTINGS_SECRET || '').trim();
  if (!secret) {
    throw new Error('EMAIL_AGENT_SETTINGS_SECRET is required to store EmailAgent settings.');
  }
  return secret;
}

function keyBytes() {
  return crypto.createHash('sha256')
    .update(requiredSettingsSecret())
    .digest();
}

function encrypt(value) {
  const text = String(value || '');
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decrypt(value) {
  const text = String(value || '');
  if (!text) return '';
  const parts = text.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return '';
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBytes(), Buffer.from(parts[1], 'base64'));
  decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(parts[3], 'base64')),
    decipher.final()
  ]).toString('utf8');
}

export function maskSecret(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 8) return `${text.slice(0, 1)}${'*'.repeat(Math.max(0, text.length - 2))}${text.slice(-1)}`;
  return `${text.slice(0, 4)}${'*'.repeat(Math.max(4, text.length - 8))}${text.slice(-4)}`;
}

async function readStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    return JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return {};
  }
}

async function writeStore(store) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${SETTINGS_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, SETTINGS_FILE);
}

export async function getRawSetting(key) {
  for (const name of settingNames(key)) {
    const envValue = process.env[name];
    if (envValue) return envValue;
  }
  const store = await readStore();
  for (const name of settingNames(key)) {
    const storedValue = decrypt(store[name] || '');
    if (storedValue) return storedValue;
  }
  return '';
}

export async function getEmailSettings() {
  const settings = {};
  for (const key of SETTING_KEYS) {
    const value = await getRawSetting(key);
    settings[key] = {
      key,
      configured: Boolean(value),
      maskedValue: maskSecret(value),
      value: PUBLIC_SETTING_KEYS.has(key) ? value : ''
    };
  }
  return { agentName: 'emailAgent', settings };
}

export async function saveEmailSettings(input = {}) {
  const values = input.settings && typeof input.settings === 'object' ? input.settings : {};
  const store = await readStore();
  const saved = [];
  for (const key of SETTING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
    const value = String(values[key] || '');
    if (!value) continue;
    store[key] = encrypt(value);
    saved.push(key);
  }
  await writeStore(store);
  return { ok: true, saved, ...(await getEmailSettings()) };
}
