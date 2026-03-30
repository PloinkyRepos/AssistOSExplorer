let nextEditorHostId = 0;

function ensureRuntimeState(host) {
    if (!host.__onlyOfficeRuntime) {
        host.__onlyOfficeRuntime = {
            editor: null,
            containerId: '',
            scriptUrl: '',
            configKey: ''
        };
    }
    return host.__onlyOfficeRuntime;
}

function getWindowObject() {
    if (typeof window === 'undefined') {
        throw new Error('OnlyOffice editor is not available outside the browser.');
    }
    return window;
}

async function loadScript(documentServerUrl) {
    const win = getWindowObject();
    const normalizedBase = String(documentServerUrl || '').replace(/\/+$/g, '');
    if (!normalizedBase) {
        throw new Error('OnlyOffice Document Server URL is not configured.');
    }
    const scriptUrl = `${normalizedBase}/web-apps/apps/api/documents/api.js`;

    if (win.DocsAPI?.DocEditor) {
        return { scriptUrl, DocsAPI: win.DocsAPI };
    }

    if (!win.__onlyOfficeScriptPromises) {
        win.__onlyOfficeScriptPromises = new Map();
    }
    if (!win.__onlyOfficeScriptPromises.has(scriptUrl)) {
        const scriptPromise = new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[data-onlyoffice-src="${scriptUrl}"]`);
            if (existing) {
                existing.addEventListener('load', () => resolve(win.DocsAPI), { once: true });
                existing.addEventListener('error', () => reject(new Error('Failed to load OnlyOffice API script.')), { once: true });
                return;
            }

            const script = document.createElement('script');
            script.src = scriptUrl;
            script.async = true;
            script.dataset.onlyofficeSrc = scriptUrl;
            script.addEventListener('load', () => resolve(win.DocsAPI), { once: true });
            script.addEventListener('error', () => reject(new Error('Failed to load OnlyOffice API script.')), { once: true });
            document.head.appendChild(script);
        }).then((docsApi) => {
            if (!docsApi?.DocEditor) {
                throw new Error('OnlyOffice API loaded without DocsAPI.DocEditor.');
            }
            return docsApi;
        });
        win.__onlyOfficeScriptPromises.set(scriptUrl, scriptPromise);
    }

    return {
        scriptUrl,
        DocsAPI: await win.__onlyOfficeScriptPromises.get(scriptUrl)
    };
}

function destroyEditor(host) {
    const runtime = ensureRuntimeState(host);
    if (runtime.editor && typeof runtime.editor.destroyEditor === 'function') {
        runtime.editor.destroyEditor();
    }
    runtime.editor = null;
}

function buildConfigKey(config) {
    if (!config || typeof config !== 'object') {
        return '';
    }
    return JSON.stringify({
        documentKey: config.document?.key || '',
        title: config.document?.title || '',
        token: config.token || '',
        callbackUrl: config.editorConfig?.callbackUrl || '',
        mode: config.editorConfig?.mode || '',
        documentUrl: config.document?.url || ''
    });
}

function ensureContainer(host, runtime) {
    if (!runtime.containerId) {
        runtime.containerId = `onlyoffice-editor-${++nextEditorHostId}`;
    }
    let container = host.querySelector('.onlyoffice-editor-frame');
    if (!container) {
        host.textContent = '';
        container = document.createElement('div');
        container.className = 'onlyoffice-editor-frame';
        host.appendChild(container);
    }
    container.id = runtime.containerId;
    return container;
}

export async function renderOnlyOfficeEditor(host, config) {
    if (!host) return;
    const runtime = ensureRuntimeState(host);
    const nextConfigKey = buildConfigKey(config);
    if (runtime.editor && runtime.configKey === nextConfigKey) {
        return;
    }

    destroyEditor(host);
    const { scriptUrl, DocsAPI } = await loadScript(config?.documentServerUrl || '');
    const container = ensureContainer(host, runtime);

    runtime.scriptUrl = scriptUrl;
    runtime.configKey = nextConfigKey;
    runtime.editor = new DocsAPI.DocEditor(container.id, config);
}

export function clearOnlyOfficeEditor(host) {
    if (!host) return;
    destroyEditor(host);
    host.textContent = '';
    if (host.__onlyOfficeRuntime) {
        host.__onlyOfficeRuntime.configKey = '';
    }
}
