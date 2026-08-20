export const SOURCE_CAPABILITIES = Object.freeze([
  'search',
  'metadata',
  'download',
  'access-request',
  'remote-processing',
  'secure-processing',
  'federation',
  'provenance',
  'citation'
]);

export function normalizeCapabilities(values = []) {
  const allowed = new Set(SOURCE_CAPABILITIES);
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => allowed.has(value)))];
}

export function assertSourceAdapter(adapter, type = '') {
  const required = ['getCapabilities', 'testConnection', 'discover', 'describe', 'resolveAccess', 'acquire', 'getCitation'];
  for (const method of required) {
    if (typeof adapter?.[method] !== 'function') {
      throw new Error(`Source adapter ${type || '<unknown>'} does not implement ${method}.`);
    }
  }
  return adapter;
}

export function createSourceAdapterRegistry(adapters = {}) {
  const registry = new Map();
  for (const [type, adapter] of Object.entries(adapters)) {
    registry.set(String(type).trim().toLowerCase(), assertSourceAdapter(adapter, type));
  }
  return {
    get(type) {
      const normalized = String(type || '').trim().toLowerCase();
      const adapter = registry.get(normalized);
      if (!adapter) throw new Error(`Unsupported DPU source type: ${normalized || '<missing>'}.`);
      return adapter;
    },
    has(type) {
      return registry.has(String(type || '').trim().toLowerCase());
    },
    types() {
      return [...registry.keys()].sort();
    }
  };
}

export function sanitizeProviderFacts(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map((entry) => sanitizeProviderFacts(entry));
  if (typeof value !== 'object') return value;
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/(token|secret|password|authorization|credential|cookie)/i.test(key)) continue;
    output[key] = sanitizeProviderFacts(entry);
  }
  return output;
}
