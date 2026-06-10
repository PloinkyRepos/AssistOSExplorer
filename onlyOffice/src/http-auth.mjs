import { pathToFileURL } from 'node:url';

let invocationAuthPromise = null;

async function loadInvocationAuth(env = process.env) {
  const invocationAuthModule = String(env?.ONLYOFFICE_INVOCATION_AUTH_MODULE || '').trim();
  const candidates = invocationAuthModule
    ? [invocationAuthModule]
    : ['/Agent/lib/invocationAuth.mjs'];
  for (const candidate of candidates) {
    try {
      const specifier = candidate.startsWith('/') ? pathToFileURL(candidate).href : candidate;
      return await import(specifier);
    } catch (_) {}
  }
  throw new Error('Unable to load invocationAuth helper.');
}

function readRawRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function verifyControlRouteAuth(req, { env = process.env, parsedUrl } = {}) {
  invocationAuthPromise ||= loadInvocationAuth(env);
  const { verifyHttpServiceAuthInfoFromHeaders } = await invocationAuthPromise;
  const body = await readRawRequestBody(req);
  const result = verifyHttpServiceAuthInfoFromHeaders(req.headers || {}, {
    env,
    method: String(req.method || 'GET').toUpperCase(),
    path: parsedUrl?.pathname || '/',
    query: parsedUrl?.search || '',
    body,
  });
  return {
    ...result,
    body,
    authInfo: result.ok ? result.authInfo : null,
  };
}

export default {
  verifyControlRouteAuth,
};
