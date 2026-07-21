function requireNonEmptyEnv(env, name) {
  const value = String(env?.[name] || '').trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function parsePositiveInt(env, name, defaultValue) {
  const raw = String(env?.[name] || '').trim();
  if (!raw) {
    return defaultValue;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

export function loadConfig(env = process.env) {
  const onlyofficeJwtSecret = requireNonEmptyEnv(env, 'ONLYOFFICE_JWT_SECRET');
  const editorPort = parsePositiveInt(env, 'ONLYOFFICE_EDITOR_PORT', 8080);
  const controlPort = parsePositiveInt(env, 'ONLYOFFICE_CONTROL_PORT', 7000);
  const storagePort = parsePositiveInt(env, 'ONLYOFFICE_STORAGE_PORT', 9100);
  const sessionIdleTtlMs = parsePositiveInt(env, 'ONLYOFFICE_SESSION_IDLE_TTL_MS', 30 * 60 * 1000);
  const publicEditorBaseUrl = trimTrailingSlash(
    env?.ONLYOFFICE_PUBLIC_URL || `/base-agent-additional-server/onlyOffice/${editorPort}`
  );
  const internalDocumentServerBaseUrl = trimTrailingSlash(
    env?.ONLYOFFICE_INTERNAL_URL || 'http://127.0.0.1:80'
  );

  return {
    onlyofficeJwtSecret,
    editorPort,
    controlPort,
    storagePort,
    sessionIdleTtlMs,
    publicEditorBaseUrl,
    internalDocumentServerBaseUrl,
  };
}

export default { loadConfig };
