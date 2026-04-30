import { createDecipheriv, createHash, hkdfSync } from 'node:crypto';
import path from 'node:path';

const ENCRYPTED_SECRETS_ALG = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const STORAGE_SUBKEY_PURPOSE = 'storage/secrets';

function parseSecretsText(raw = '') {
  const result = {};
  const lines = String(raw || '').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1);
    if (key) {
      result[key] = value;
    }
  }
  return result;
}

function resolveMasterKey() {
  const raw = String(process.env.PLOINKY_MASTER_KEY || process.env.PLOINKY_WIRE_SECRET || '').trim();
  if (!raw) {
    return null;
  }
  return createHash('sha256').update(raw, 'utf8').digest();
}

function deriveStorageKey() {
  const ikm = resolveMasterKey();
  if (!ikm) return null;
  return Buffer.from(hkdfSync(
    'sha256',
    ikm,
    Buffer.alloc(0),
    Buffer.from(`ploinky/${STORAGE_SUBKEY_PURPOSE}/v1`, 'utf8'),
    32,
  ));
}

function decryptSecretsEnvelope(raw = '') {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  const buf = Buffer.from(trimmed, 'base64');
  if (buf.length < IV_BYTES + TAG_BYTES + 1) return null;
  const key = deriveStorageKey();
  if (!key) return null;
  try {
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv(ENCRYPTED_SECRETS_ALG, key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
    const payload = JSON.parse(plaintext);
    return payload?.secrets && typeof payload.secrets === 'object' ? payload.secrets : {};
  } catch {
    return null;
  }
}

export async function readWorkspaceSecrets(fs, workspaceRoot) {
  if (!fs || !workspaceRoot) {
    return {};
  }
  try {
    const secretsPath = path.join(workspaceRoot, '.ploinky', '.secrets');
    const raw = await fs.readFile(secretsPath, 'utf8');
    return decryptSecretsEnvelope(raw) || {};
  } catch {
    return {};
  }
}

export { parseSecretsText };
