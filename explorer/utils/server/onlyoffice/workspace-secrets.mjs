import { createDecipheriv } from 'node:crypto';
import path from 'node:path';

const ENCRYPTED_SECRETS_ALG = 'aes-256-gcm';

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

function decryptSecretsEnvelope(raw = '') {
  let envelope;
  try {
    envelope = JSON.parse(String(raw || ''));
  } catch {
    return null;
  }
  if (!envelope || envelope.alg !== ENCRYPTED_SECRETS_ALG || !envelope.iv || !envelope.tag || !envelope.ciphertext) {
    return null;
  }
  const keyHex = String(process.env.PLOINKY_MASTER_KEY || process.env.PLOINKY_WIRE_SECRET || '').trim();
  if (!/^[a-fA-F0-9]{64}$/.test(keyHex)) {
    return null;
  }
  try {
    const decipher = createDecipheriv(ENCRYPTED_SECRETS_ALG, Buffer.from(keyHex, 'hex'), Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final()
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
  const merged = {};
  try {
    const secretsPath = path.join(workspaceRoot, '.ploinky', '.secrets');
    const raw = await fs.readFile(secretsPath, 'utf8');
    Object.assign(merged, decryptSecretsEnvelope(raw) || parseSecretsText(raw));
  } catch {
    // ignore
  }
  return merged;
}

export { parseSecretsText };
