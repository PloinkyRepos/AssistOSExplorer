import {
  findSensitiveDiagnosticKinds,
  isSensitiveDiagnosticName,
  normalizeDiagnosticName,
  redactSensitiveString,
} from '../../../webmeetAgent/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard/services/diagnostic-redaction.mjs';

const SECRET_NAME_RE = /(PASSWORD|TOKEN|SECRET|KEY|JWT|COOKIE|PLOINKY_MASTER_KEY|PLOINKY_AGENT_API_KEY)/i;
const URL_RE = /\b(?:https?|wss?):\/\/[^\s<>"'`]+/gi;
const ASSIGNMENT_RE = /([A-Za-z0-9_.%~-]{2,80})(?:\\?["'])?(\s*)([=:])(\s*)/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
const REDACTION_MARKER = '[REDACTED]';

function stringify(input) {
  if (typeof input === 'string') return input;
  if (input === undefined) return 'undefined';
  if (input === null) return 'null';
  try {
    return JSON.stringify(input);
  } catch (_) {
    return String(input);
  }
}

function structuredValueEnd(text, start) {
  const opening = text[start];
  const closing = opening === '{' ? '}' : ']';
  let depth = 0;
  let quote = '';
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = '';
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === opening) {
      depth += 1;
    } else if (character === closing) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return text.length;
}

function quotedValueEnd(text, start) {
  const quote = text[start];
  let escaped = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) {
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === quote) {
      return index + 1;
    }
  }
  return text.length;
}

function bareValueEnd(text, start, separator, name) {
  const redactToLineEnd = name === 'authorization'
    || name === 'cookie'
    || name === 'proxyauthorization'
    || name === 'setcookie';
  const terminator = separator === '=' && !redactToLineEnd
    ? /[&#\s,;"'<>]/
    : /[\r\n]/;
  let index = start;
  while (index < text.length && !terminator.test(text[index])) index += 1;
  return index;
}

function sensitiveValueEnd(text, start, separator, name) {
  if (text[start] === '"' || text[start] === "'") return quotedValueEnd(text, start);
  if (text[start] === '{' || text[start] === '[') return structuredValueEnd(text, start);
  return bareValueEnd(text, start, separator, name);
}

function redactNamedAssignments(input) {
  let output = '';
  let cursor = 0;
  ASSIGNMENT_RE.lastIndex = 0;

  for (let match = ASSIGNMENT_RE.exec(input); match; match = ASSIGNMENT_RE.exec(input)) {
    if (!isSensitiveDiagnosticName(match[1])) continue;
    const valueStart = ASSIGNMENT_RE.lastIndex;
    const name = normalizeDiagnosticName(match[1]);
    const valueEnd = sensitiveValueEnd(input, valueStart, match[3], name);
    output += input.slice(cursor, valueStart);
    output += REDACTION_MARKER;
    cursor = valueEnd;
    ASSIGNMENT_RE.lastIndex = valueEnd;
  }

  return cursor === 0 ? input : output + input.slice(cursor);
}

function redactSensitiveUrls(input) {
  return input.replace(URL_RE, (rawUrl) => {
    try {
      const url = new URL(rawUrl);
      let changed = false;
      for (const name of [...url.searchParams.keys()]) {
        if (!isSensitiveDiagnosticName(name)) continue;
        url.searchParams.set(name, REDACTION_MARKER);
        changed = true;
      }
      return changed ? url.toString() : rawUrl;
    } catch (_) {
      return rawUrl;
    }
  });
}

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
    let output = stringify(input);
    for (const { value } of replacements) {
      output = output.split(value).join(REDACTION_MARKER);
    }
    output = redactNamedAssignments(output);
    output = redactSensitiveUrls(output);
    output = redactNamedAssignments(output);
    output = output.replace(JWT_RE, REDACTION_MARKER);
    return redactSensitiveString(output);
  };
}

export function redactDiagnosticValue(input, redact = createRedactor(), seen = new WeakSet()) {
  if (typeof input === 'string') return redact(input);
  if (input === null || input === undefined || typeof input !== 'object') return input;
  if (input instanceof URL) return redact(input.toString());
  if (input instanceof Error) return redact(input.stack || input.message || String(input));
  if (seen.has(input)) return REDACTION_MARKER;
  seen.add(input);

  if (Array.isArray(input)) {
    return input.map((value) => redactDiagnosticValue(value, redact, seen));
  }

  return Object.fromEntries(Object.entries(input).map(([name, value]) => [
    name,
    isSensitiveDiagnosticName(name) ? REDACTION_MARKER : redactDiagnosticValue(value, redact, seen),
  ]));
}

export function findSecretLeaks(input, secrets = collectSecrets()) {
  const text = stringify(input);
  return secrets
    .filter((entry) => entry.value.length >= 8 && text.includes(entry.value))
    .map((entry) => entry.name);
}

export function findDiagnosticLeaks(input, secrets = collectSecrets()) {
  const text = stringify(input);
  const leaks = findSecretLeaks(text, secrets);
  for (const kind of findSensitiveDiagnosticKinds(text)) {
    leaks.push(`DYNAMIC_${kind}`);
  }
  return [...new Set(leaks)];
}
