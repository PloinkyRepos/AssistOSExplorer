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
    const runtime = host?.__onlyOfficeRuntime;
    if (!runtime) {
        return;
    }
    if (runtime.editor && typeof runtime.editor.destroyEditor === 'function') {
        try {
            runtime.editor.destroyEditor();
        } catch (error) {
            console.warn('OnlyOffice editor destroy failed', error);
        }
    }
    runtime.editor = null;
}

export function buildConfigKey(config) {
    if (!config || typeof config !== 'object') {
        return '';
    }
    // The server store mints document.key for one exact session. It is the
    // editor/remount identity; a fresh session intentionally gets a fresh key
    // even when it names the same file and version. Transport URLs remain out
    // of this comparison because they are not browser UI identity fields.
    return JSON.stringify({
        documentKey: config.document?.key || '',
        title: config.document?.title || '',
        fileType: config.document?.fileType || '',
        permissions: config.document?.permissions || null,
        mode: config.editorConfig?.mode || '',
        userId: config.editorConfig?.user?.id || '',
        documentServerUrl: config.documentServerUrl || ''
    });
}

function findEditorContainer(host) {
    if (typeof host?.querySelector !== 'function') {
        return null;
    }
    // Before instantiation the container is the .onlyoffice-editor-frame div;
    // DocsAPI.DocEditor then replaces that div with the editor iframe
    // (observed: <iframe name="frameEditor">), so accept either as proof the
    // editor DOM is still mounted in this host.
    return host.querySelector('.onlyoffice-editor-frame') || host.querySelector('iframe');
}

export function isOnlyOfficeEditorActive(host, config) {
    const runtime = host?.__onlyOfficeRuntime;
    if (!runtime?.editor) {
        return false;
    }
    if (host.isConnected === false) {
        // A full page re-render replaces the preview DOM; a detached host may
        // still hold a runtime but its editor is gone with the old subtree.
        return false;
    }
    const configKey = buildConfigKey(config);
    return Boolean(configKey) && runtime.configKey === configKey && Boolean(findEditorContainer(host));
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
    if (runtime.editor && runtime.configKey === nextConfigKey && findEditorContainer(host)) {
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
