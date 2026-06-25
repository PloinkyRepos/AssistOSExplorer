const SECRET_NAME_RE = /(PASSWORD|TOKEN|SECRET|KEY|JWT|COOKIE|PLOINKY_MASTER_KEY|PLOINKY_AGENT_API_KEY)/i;

export function collectSecrets(env = process.env) {
  const secrets = [];
  for (const [name, rawValue] of Object.entries(env)) {
    if (!SECRET_NAME_RE.test(name)) continue;
    const value = String(rawValue || '');
    if (value.length < 6) continue;
    secrets.push({ name, value });
  }
  return secrets;
}

export function createRedactor(secrets = collectSecrets()) {
  const replacements = secrets
    .filter((entry) => entry.value && entry.value.length >= 6)
    .sort((left, right) => right.value.length - left.value.length);

  return function redact(input) {
    let output = typeof input === 'string' ? input : JSON.stringify(input);
    for (const { name, value } of replacements) {
      output = output.split(value).join(`[REDACTED:${name}]`);
    }
    return output;
  };
}

export function findSecretLeaks(input, secrets = collectSecrets()) {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  return secrets
    .filter((entry) => entry.value.length >= 8 && text.includes(entry.value))
    .map((entry) => entry.name);
}
