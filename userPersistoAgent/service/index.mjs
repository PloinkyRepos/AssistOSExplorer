import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { loginWithPassword } from '../lib/auth/password.mjs';
import { startEmailCode, verifyEmailCode } from '../lib/auth/email-code.mjs';
import * as passkey from '../lib/auth/passkey.mjs';
import * as totp from '../lib/auth/totp.mjs';
import { getEnabledAuthMethods, getDefaultAuthMethod } from '../lib/auth/methods.mjs';
import { createLoginRequest, issueAuthCode, consumeAuthCode, getSsoUser } from '../lib/sso.mjs';
import { runTool } from '../tools/registry.mjs';

const PUBLIC_DIR = resolve(fileURLToPath(new URL('../public', import.meta.url)));
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml'
};

function assertRuntimeSecret(req) {
    const expected = String(process.env.USERPERSISTO_RUNTIME_SECRET || '');
    const got = String(req.headers['x-userpersisto-runtime-secret'] || '');
    if (!expected) {
        throw Object.assign(new Error('runtime secret is not configured'), { statusCode: 503 });
    }
    const expectedBytes = Buffer.from(expected);
    const gotBytes = Buffer.from(got);
    if (expectedBytes.length !== gotBytes.length || !timingSafeEqual(expectedBytes, gotBytes)) {
        throw Object.assign(new Error('runtime secret required'), { statusCode: 401 });
    }
}

async function readJson(req) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
        size += chunk.length;
        if (size > 64 * 1024) {
            throw Object.assign(new Error('payload too large'), { statusCode: 413 });
        }
        chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if (!text.trim()) {
        return {};
    }
    try {
        return JSON.parse(text);
    } catch {
        throw Object.assign(new Error('invalid JSON body'), { statusCode: 400 });
    }
}

function sendJson(res, status, body) {
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': payload.length,
        'Cache-Control': 'no-store'
    });
    res.end(payload);
}

function providerStateFrom(body) {
    return String(body.requestId || body.providerState || body.state || '').trim();
}

function callbackPayload(issued, state) {
    return {
        ok: true,
        code: issued.code,
        redirectUri: issued.redirectUri,
        state: String(state || '')
    };
}

async function issueCallbackForUser(body, userId) {
    const issued = await issueAuthCode({ providerState: providerStateFrom(body), userId });
    return callbackPayload(issued, body.state);
}

async function serveStatic(res, relPath) {
    const rel = normalize(String(relPath || 'auth/index.html')).replace(/^\/+/, '');
    const staticPath = rel === 'auth' || rel === 'auth/' ? 'auth/index.html' : rel;
    const file = resolve(PUBLIC_DIR, staticPath);
    const allowed = file === PUBLIC_DIR || file.startsWith(`${PUBLIC_DIR}${sep}`);
    if (!allowed) {
        return sendJson(res, 403, { ok: false, error: 'forbidden' });
    }
    try {
        const data = await readFile(file);
        res.writeHead(200, {
            'Content-Type': MIME[extname(file)] || 'application/octet-stream',
            'Content-Length': data.length,
            'Cache-Control': 'no-store'
        });
        res.end(data);
    } catch {
        sendJson(res, 404, { ok: false, error: 'not_found' });
    }
}

async function handleGet(req, res, path) {
    if (path === '/service/auth/methods') {
        return sendJson(res, 200, {
            ok: true,
            methods: getEnabledAuthMethods(),
            defaultMethod: getDefaultAuthMethod()
        });
    }
    if (path === '/service/auth' || path.startsWith('/service/auth/')) {
        return serveStatic(res, path.replace('/service/', ''));
    }
    return sendJson(res, 404, { ok: false, error: 'not_found' });
}

async function handlePost(req, res, path) {
    const body = await readJson(req);
    if (path === '/service/auth/password/login') {
        const result = await loginWithPassword(body.email, body.password);
        if (!result.ok) {
            return sendJson(res, 401, { ok: false, error: result.reason });
        }
        return sendJson(res, 200, await issueCallbackForUser(body, result.user.id));
    }
    if (path === '/service/auth/email-code/start') {
        const started = await startEmailCode({
            email: body.email,
            purpose: 'login',
            correlationId: providerStateFrom(body),
            createSelfRegistered: body.selfRegister === true
        });
        return sendJson(res, 200, { ok: true, challengeId: started.challengeId });
    }
    if (path === '/service/auth/email-code/verify') {
        const result = await verifyEmailCode({ challengeId: body.challengeId, code: body.code });
        if (!result.ok) {
            return sendJson(res, 401, { ok: false, error: result.reason });
        }
        return sendJson(res, 200, await issueCallbackForUser(body, result.user.id));
    }
    if (path === '/service/auth/passkey/options') {
        const result = await passkey.loginOptions({ email: body.email, origin: body.origin, rpId: body.rpId });
        if (!result.ok) {
            return sendJson(res, 401, { ok: false, error: result.reason });
        }
        return sendJson(res, 200, result);
    }
    if (path === '/service/auth/passkey/verify') {
        const result = await passkey.loginVerify({
            email: body.email,
            assertion: body.assertion,
            challengeKey: body.challengeKey,
            origin: body.origin
        });
        if (!result.ok) {
            return sendJson(res, 401, { ok: false, error: result.reason });
        }
        return sendJson(res, 200, await issueCallbackForUser(body, result.user.id));
    }
    if (path === '/service/auth/totp/setup' || path === '/service/auth/totp/verify') {
        const result = await totp.loginVerify({ email: body.email, token: body.token });
        if (!result.ok) {
            return sendJson(res, 401, { ok: false, error: result.reason });
        }
        return sendJson(res, 200, await issueCallbackForUser(body, result.user.id));
    }
    if (path === '/service/runtime/sso-login-request') {
        assertRuntimeSecret(req);
        const request = await createLoginRequest({ redirectUri: body.redirectUri, clientId: body.clientId });
        return sendJson(res, 200, { ok: true, request });
    }
    if (path === '/service/runtime/sso-consume-code') {
        assertRuntimeSecret(req);
        const consumed = await consumeAuthCode({ providerState: body.providerState, code: body.code });
        return sendJson(res, 200, { ok: true, ...consumed });
    }
    if (path === '/service/runtime/sso-user') {
        assertRuntimeSecret(req);
        const described = await getSsoUser(body.userId);
        return sendJson(res, 200, { ok: true, ...described });
    }
    if (path === '/internal/tool') {
        if (req.socket.remoteAddress !== '127.0.0.1' && req.socket.remoteAddress !== '::1' && req.socket.remoteAddress !== '::ffff:127.0.0.1') {
            return sendJson(res, 404, { ok: false, error: 'not_found' });
        }
        assertRuntimeSecret(req);
        const result = await runTool(body.name, body.arguments || {}, body.context || {});
        return sendJson(res, 200, { ok: true, result });
    }
    return sendJson(res, 404, { ok: false, error: 'not_found' });
}

async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://internal');
    try {
        if (req.method === 'GET' || req.method === 'HEAD') {
            if (req.method === 'HEAD') {
                res.writeHead(405, { 'Cache-Control': 'no-store' });
                return res.end();
            }
            return await handleGet(req, res, url.pathname);
        }
        if (req.method !== 'POST') {
            return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
        }
        return await handlePost(req, res, url.pathname);
    } catch (error) {
        sendJson(res, error.statusCode || 500, { ok: false, error: error.message || 'internal_error' });
    }
}

export function startService(port) {
    const server = http.createServer(handle);
    server.listen(port, () => {
        console.log(`[userPersisto] service listening on ${port}`);
    });
    return server;
}
