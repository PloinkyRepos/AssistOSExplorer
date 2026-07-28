import { createRedactor } from './security.mjs';

function errorText(error) {
  if (error instanceof Error) return error.stack || error.message;
  return String(error);
}

export function createReleaseGateFailureCollector({ env = process.env } = {}) {
  const redact = createRedactor(Object.entries(env)
    .filter(([name, value]) => /(PASSWORD|TOKEN|SECRET|KEY|JWT|COOKIE)/i.test(name) && String(value || '').length >= 6)
    .map(([name, value]) => ({ name, value: String(value) })));
  const failures = [];

  function add(label, error) {
    const wrapped = new Error(`${label}: ${redact(errorText(error))}`);
    wrapped.name = 'ReleaseGateEvidenceError';
    failures.push(wrapped);
    return wrapped;
  }

  async function required(label, operation) {
    try {
      return await operation();
    } catch (error) {
      add(label, error);
      return undefined;
    }
  }

  function throwIfAny({ primaryError = null, label = 'release gate' } = {}) {
    if (!primaryError && failures.length === 0) return;
    const safePrimary = primaryError
      ? Object.assign(new Error(redact(errorText(primaryError))), { name: primaryError.name || 'Error' })
      : null;
    if (safePrimary && failures.length === 0) throw safePrimary;
    const errors = [...(safePrimary ? [safePrimary] : []), ...failures];
    const summary = errors
      .map((error, index) => {
        const kind = safePrimary && index === 0 ? 'primary failure' : `required evidence/cleanup failure ${safePrimary ? index : index + 1}`;
        return `${kind}: ${error.message}`;
      })
      .join('\n');
    throw new AggregateError(
      errors,
      `${label} failed with ${primaryError ? 'a primary test failure and ' : ''}${failures.length} required evidence/cleanup failure(s).\n${summary}`,
    );
  }

  return Object.freeze({ add, failures, required, throwIfAny });
}
