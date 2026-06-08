import vm from 'node:vm';

function buildSandboxContext({ registerDocument, httpFetch }) {
    return {
        console: Object.freeze({
            log: () => {},
            error: () => {},
            warn: () => {},
            info: () => {},
        }),
        registerDocument: typeof registerDocument === 'function' ? registerDocument : () => {},
        httpFetch: typeof httpFetch === 'function' ? httpFetch : async () => ({ ok: false, status: 403, text: async () => '' }),
        exports: {},
        module: { exports: {} },
    };
}

function extractExports(sandbox) {
    const moduleExports = sandbox.module && sandbox.module.exports;
    if (moduleExports && typeof moduleExports === 'object' && Object.keys(moduleExports).length > 0) {
        return moduleExports;
    }
    return sandbox.exports || {};
}

export async function executeWacModule({ sourceCode, siteUrl, timeout = 5000 }) {
    if (!sourceCode || typeof sourceCode !== 'string') {
        throw new Error('executeWacModule requires sourceCode.');
    }
    if (!siteUrl || typeof siteUrl !== 'string') {
        throw new Error('executeWacModule requires siteUrl.');
    }

    const documents = [];

    function registerDocument(doc) {
        if (!doc || typeof doc !== 'object') {
            return;
        }
        const normalized = {
            type: String(doc.type || '').trim(),
            title: String(doc.title || '').trim(),
            content: String(doc.content || '').trim(),
            source: String(doc.source || siteUrl).trim(),
            updatedAt: String(doc.updatedAt || new Date().toISOString()).trim(),
            status: String(doc.status || '').trim(),
            validUntil: String(doc.validUntil || '').trim(),
        };
        if (!normalized.type || !normalized.content) {
            return;
        }
        documents.push(normalized);
    }

    async function httpFetch(resourcePath, options = {}) {
        const base = siteUrl.replace(/\/+$/, '');
        const path = String(resourcePath || '').replace(/^\/+/, '');
        const url = `${base}/${path}`;
        try {
            const response = await fetch(url, {
                method: String(options.method || 'GET').toUpperCase(),
                headers: options.headers || {},
                signal: AbortSignal.timeout(timeout),
            });
            return {
                ok: response.ok,
                status: response.status,
                text: async () => response.text(),
                json: async () => response.json(),
            };
        } catch {
            return { ok: false, status: 0, text: async () => '', json: async () => null };
        }
    }

    const sandbox = buildSandboxContext({ registerDocument, httpFetch });
    const context = vm.createContext(sandbox);

    const wrappedCode = `(async function() {
        ${sourceCode}
        return typeof module !== 'undefined' ? module.exports : (typeof exports !== 'undefined' ? exports : {});
    })()`;

    const script = new vm.Script(wrappedCode, {
        filename: 'agent-context.mjs',
        displayErrors: true,
    });

    const exports = await script.runInContext(context, { timeout });
    const moduleExports = extractExports(sandbox) || exports;

    if (typeof moduleExports.loadContext === 'function') {
        await moduleExports.loadContext({ registerDocument, httpFetch });
    }

    return {
        exports: moduleExports,
        documents,
    };
}
