import { isIP } from 'node:net';

const QA_ORIGIN = 'https://explorer-qa.axiologic.dev';

function isPublicIpv4(value) {
  if (isIP(value) !== 4) return false;
  const [first, second] = value.split('.').map(Number);
  return !(
    first === 0
    || first === 10
    || first === 127
    || first >= 224
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
  );
}

export function validateQaAcceptanceProfile({
  enabled,
  headed,
  baseURL,
  edgeIP,
} = {}) {
  const profile = {
    enabled: Boolean(enabled),
    headed: Boolean(headed),
    baseURL: String(baseURL || ''),
    edgeIP: String(edgeIP || '').trim(),
  };
  if (!profile.enabled) {
    if (profile.edgeIP) {
      throw new Error('SMOKE_QA_EDGE_IP is available only with SMOKE_QA_ACCEPTANCE.');
    }
    return profile;
  }
  if (profile.headed) {
    throw new Error('SMOKE_QA_ACCEPTANCE requires headless Playwright execution.');
  }

  let origin = '';
  try {
    const url = new URL(profile.baseURL);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('unsafe URL shape');
    }
    origin = url.origin;
  } catch {
    throw new Error(`SMOKE_QA_ACCEPTANCE requires the exact ${QA_ORIGIN} origin.`);
  }
  if (origin !== QA_ORIGIN) {
    throw new Error(`SMOKE_QA_ACCEPTANCE requires the exact ${QA_ORIGIN} origin.`);
  }
  if (profile.edgeIP && !isPublicIpv4(profile.edgeIP)) {
    throw new Error('SMOKE_QA_EDGE_IP must be a public IPv4 address.');
  }
  return profile;
}

export default {
  validateQaAcceptanceProfile,
};
