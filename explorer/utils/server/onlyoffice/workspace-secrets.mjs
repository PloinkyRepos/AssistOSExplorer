import path from 'node:path';

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

export async function readWorkspaceSecrets(fs, workspaceRoot) {
  if (!fs || !workspaceRoot) {
    return {};
  }
  const merged = {};
  try {
    const secretsPath = path.join(workspaceRoot, '.ploinky', '.secrets');
    const raw = await fs.readFile(secretsPath, 'utf8');
    Object.assign(merged, parseSecretsText(raw));
  } catch {
    // ignore
  }
  return merged;
}

export { parseSecretsText };
