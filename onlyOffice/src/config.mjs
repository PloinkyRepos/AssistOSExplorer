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
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function parseBoundedPositiveInt(env, name, defaultValue, maximum) {
  const value = parsePositiveInt(env, name, defaultValue);
  if (value > maximum) {
    throw new Error(`${name} must be at most ${maximum}.`);
  }
  return value;
}

export function loadConfig(env = process.env) {
  const onlyofficeJwtSecret = requireNonEmptyEnv(env, 'ONLYOFFICE_JWT_SECRET');
  const editorPort = parsePositiveInt(env, 'ONLYOFFICE_EDITOR_PORT', 8080);
  const controlPort = parsePositiveInt(env, 'ONLYOFFICE_CONTROL_PORT', 7000);
  const storagePort = parsePositiveInt(env, 'ONLYOFFICE_STORAGE_PORT', 9100);
  const sessionIdleTtlMs = parsePositiveInt(env, 'ONLYOFFICE_SESSION_IDLE_TTL_MS', 30 * 60 * 1000);
  // Document config, callback, and outbox JWTs are all short-lived. Keep the
  // one configurable lifetime within the pinned five-minute envelope.
  const configJwtTtlSeconds = parseBoundedPositiveInt(
    env,
    'ONLYOFFICE_CONFIG_JWT_TTL_SECONDS',
    300,
    300,
  );
  const callbackMaxBytes = parsePositiveInt(env, 'ONLYOFFICE_CALLBACK_MAX_BYTES', 256 * 1024);
  const downloadMaxBytes = parsePositiveInt(env, 'ONLYOFFICE_DOWNLOAD_MAX_BYTES', 64 * 1024 * 1024);
  const ioTimeoutMs = parsePositiveInt(env, 'ONLYOFFICE_IO_TIMEOUT_MS', 15_000);
  // Ploinky's generic targeted-recreate contract grants a fixed 35-second
  // clean-exit window. Keep the application deadline strictly within it so a
  // configured value can never turn a coordinated drain into a forced stop.
  const drainTimeoutMs = parseBoundedPositiveInt(
    env,
    'ONLYOFFICE_DRAIN_TIMEOUT_MS',
    30_000,
    30_000,
  );

  return {
    onlyofficeJwtSecret,
    editorPort,
    controlPort,
    storagePort,
    sessionIdleTtlMs,
    configJwtTtlSeconds,
    callbackMaxBytes,
    downloadMaxBytes,
    ioTimeoutMs,
    drainTimeoutMs,
    // Ploinky persists the isolated agent workdir at /root across a targeted
    // recreate. Runtime contract v5 has one state location and no legacy
    // environment override or fallback reader.
    sessionStateFile: '/root/.ploinky/state/onlyoffice-sessions-v5.json',
    internalDocumentServerBaseUrl: 'http://127.0.0.1:80',
  };
}

export default { loadConfig };
