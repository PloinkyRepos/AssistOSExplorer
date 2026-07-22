import net from 'node:net';

function reservedIpv4(octets) {
  const [a, b, c] = octets;
  return a === 0
    || a === 10
    || (a === 100 && b >= 64 && b <= 127)
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 168)
    || (a === 198 && [18, 19].includes(b))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

export function requirePublicIpv4(value, name) {
  const text = String(value || '').trim();
  if (!net.isIPv4(text) || reservedIpv4(text.split('.').map(Number))) {
    throw new Error(`${name} must be a globally routable literal IPv4 address; got ${text || '<missing>'}.`);
  }
  return text;
}

export function requireCredentialFreeCdpUrl(value, name) {
  const text = String(value || '').trim();
  let parsed;
  try {
    parsed = new URL(text);
  } catch (_) {
    throw new Error(`${name} must be an exact credential-free HTTPS or WSS URL.`);
  }
  if (
    !['https:', 'wss:'].includes(parsed.protocol)
    || !parsed.hostname
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new Error(`${name} must be an exact credential-free, query-free HTTPS or WSS URL.`);
  }
  return parsed.href;
}

export function parseTurnEndpoint(value, {
  name,
  expectedScheme,
  expectedTransport,
}) {
  const text = String(value || '').trim();
  const match = text.match(/^(turns?):(.*)$/i);
  if (!match) {
    throw new Error(`${name} must be an explicit ${expectedScheme}: TURN URL.`);
  }
  const scheme = match[1].toLowerCase();
  let parsed;
  try {
    parsed = new URL(`${scheme}://${match[2].replace(/^\/\//, '')}`);
  } catch (_) {
    throw new Error(`${name} is not a valid TURN URL.`);
  }
  const transport = String(parsed.searchParams.get('transport') || '').toLowerCase();
  const queryKeys = Array.from(parsed.searchParams.keys());
  if (scheme !== expectedScheme || transport !== expectedTransport) {
    throw new Error(`${name} must use ${expectedScheme}: with transport=${expectedTransport}.`);
  }
  if (!parsed.hostname || !parsed.port || !['', '/'].includes(parsed.pathname) || parsed.hash || parsed.username || parsed.password) {
    throw new Error(`${name} must contain only a non-secret host, explicit port, and transport query.`);
  }
  if (queryKeys.length !== 1 || queryKeys[0] !== 'transport') {
    throw new Error(`${name} may contain only the transport query parameter.`);
  }
  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} has an invalid port.`);
  }
  const host = String(parsed.hostname).toLowerCase();
  if (['localhost', 'host.containers.internal'].includes(host) || host.endsWith('.localhost')) {
    throw new Error(`${name} must select an external TURN host.`);
  }
  if (net.isIPv4(host)) requirePublicIpv4(host, `${name} host`);
  return { scheme, host, port, transport };
}
