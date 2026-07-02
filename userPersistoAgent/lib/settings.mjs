import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { getUserPersistoStore } from './storage/persisto-store.mjs';

const AGENT_NAME = 'userPersistoAgent';
const SETTINGS_FILE_NAME = 'agent-settings.json';
const SETTING_KEYS = [
  'USERPERSISTO_AUTH_METHODS',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_CREDITS',
  'STRIPE_PRICE_SUBSCRIPTION'
];
const PUBLIC_SETTING_KEYS = new Set(['USERPERSISTO_AUTH_METHODS']);
const AUTH_METHODS = new Set(['password', 'emailCode', 'passkey', 'totp']);
const PRIMARY_AUTH_METHODS = new Set(['password', 'emailCode']);

function resolveDataDir() {
  if (process.env.USERPERSISTO_DATA_DIR) return process.env.USERPERSISTO_DATA_DIR;
  if (fsSync.existsSync('/userpersisto-data')) return '/userpersisto-data';
  const workspaceRoot = String(process.env.PLOINKY_WORKSPACE_ROOT || process.env.WORKSPACE_PATH || '').trim();
  if (workspaceRoot) return path.join(workspaceRoot, '.ploinky', 'agents', 'userPersistoAgent');
  return '/userpersisto-data';
}

function settingsFilePath() {
  return process.env.USERPERSISTO_SETTINGS_FILE || path.join(resolveDataDir(), SETTINGS_FILE_NAME);
}

function requiredSettingsSecret() {
  const secret = String(process.env.USERPERSISTO_SETTINGS_SECRET || '').trim();
  if (!secret) {
    throw new Error('USERPERSISTO_SETTINGS_SECRET is required to store UserPersisto settings.');
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
  const [, ivRaw, tagRaw, encryptedRaw] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBytes(), Buffer.from(ivRaw, 'base64'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

async function readSettingsRecords() {
  try {
    const raw = await fs.readFile(settingsFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return {};
  }
}

async function writeSettingsRecords(records) {
  const filePath = settingsFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  await fs.rename(tmpPath, filePath);
}

export function maskSecret(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 8) return `${text.slice(0, 1)}${'*'.repeat(Math.max(0, text.length - 2))}${text.slice(-1)}`;
  return `${text.slice(0, 4)}${'*'.repeat(Math.max(4, text.length - 8))}${text.slice(-4)}`;
}

export async function getRawSetting(key) {
  const records = await readSettingsRecords();
  const record = records[key];
  if (record?.encryptedValue) return decrypt(record.encryptedValue);
  return '';
}

export async function getAllowedAuthMethods() {
  const raw = await getRawSetting('USERPERSISTO_AUTH_METHODS');
  const methods = String(raw || 'password')
    .split(',')
    .map((method) => method.trim())
    .filter((method) => AUTH_METHODS.has(method));
  return methods.length ? methods : ['password'];
}

export async function getAgentSettings() {
  const values = {};
  for (const key of SETTING_KEYS) {
    const value = key === 'USERPERSISTO_AUTH_METHODS'
      ? (await getAllowedAuthMethods()).join(',')
      : await getRawSetting(key);
    values[key] = {
      key,
      configured: Boolean(value),
      maskedValue: PUBLIC_SETTING_KEYS.has(key) ? value : maskSecret(value),
      value: PUBLIC_SETTING_KEYS.has(key) ? value : ''
    };
  }
  return { agentName: AGENT_NAME, settings: values };
}

export async function saveAgentSettings(input = {}) {
  const settings = input.settings && typeof input.settings === 'object' ? input.settings : {};
  const records = await readSettingsRecords();
  const saved = [];
  for (const key of SETTING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(settings, key)) continue;
    let value = String(settings[key] || '');
    if (key === 'USERPERSISTO_AUTH_METHODS') {
      const methods = value.split(',')
        .map((method) => method.trim())
        .filter((method) => AUTH_METHODS.has(method));
      if (!methods.some((method) => PRIMARY_AUTH_METHODS.has(method))) {
        throw new Error('Enable Username and password or Email authentication code before saving authentication methods.');
      }
      value = methods.join(',');
    }
    if (!value) continue;
    records[key] = {
      agentName: AGENT_NAME,
      key,
      encryptedValue: encrypt(value),
      updatedAt: new Date().toISOString()
    };
    saved.push(key);
  }
  if (!saved.length) {
    throw new Error('No recognized UserPersisto settings were provided.');
  }
  await writeSettingsRecords(records);
  await getUserPersistoStore()
    .appendAudit('settings.save', { targetType: 'agentSetting', targetId: AGENT_NAME, metadata: { keys: saved } })
    .catch(() => null);
  return { ok: true, saved, ...(await getAgentSettings()) };
}
