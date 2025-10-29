import WebSkel from './WebSkel/webskel.mjs';
import assistosSDK from './services/assistosSDK.js';
import initialiseAssistOS from './services/assistOSShim.js';

const EXPLORER_AGENT_ID = 'explorer';
const RUNTIME_PLUGIN_TOOL = 'collect_ide_plugins';

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

async function fetchRuntimePlugins() {
    try {
        const result = await assistosSDK.callTool(EXPLORER_AGENT_ID, RUNTIME_PLUGIN_TOOL);
        if (result?.json && typeof result.json === 'object') {
            return result.json;
        }
        if (typeof result?.text === 'string') {
            try {
                return JSON.parse(result.text);
            } catch (parseError) {
                console.error('[runtime-plugins] Failed to collect IDE plugins: invalid JSON');
            }
        }
    } catch (error) {
        console.error('[runtime-plugins] Failed to collect IDE plugins:', error);
    }
    return null;
}

async function fetchTextOrThrow(url, description) {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) {
        throw new Error(`${description} (${response.status})`);
    }
    return response.text();
}

async function fetchOptionalText(url) {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) {
        return '';
    }
    return response.text();
}

function buildBasePath(agent, componentName, ownerComponent, isDependency, customPath) {
    const normalizedAgent = agent.trim();
    if (isNonEmptyString(customPath)) {
        const cleaned = customPath.replace(/^\/+/, '');
        return `/${normalizedAgent}/IDE-plugins/${cleaned}`;
    }
    const normalizedComponent = componentName.trim();
    const normalizedOwner = isNonEmptyString(ownerComponent) ? ownerComponent.trim() : undefined;
    if (isDependency && normalizedOwner && normalizedOwner !== normalizedComponent) {
        return `/${normalizedAgent}/IDE-plugins/${normalizedOwner}/components/${normalizedComponent}/${normalizedComponent}`;
    }
    return `/${normalizedAgent}/IDE-plugins/${normalizedComponent}/${normalizedComponent}`;
}

async function loadComponentFromAgent(webSkel, meta) {
    const { componentName, presenterName, agent, ownerComponent, isDependency, customPath } = meta;
    if (!isNonEmptyString(componentName) || !isNonEmptyString(agent)) {
        return;
    }

    const normalizedComponent = componentName.trim();
    const normalizedAgent = agent.trim();
    const basePath = buildBasePath(normalizedAgent, normalizedComponent, ownerComponent, isDependency, customPath);

    const [loadedTemplate, loadedCSS, presenterSource] = await Promise.all([
        fetchTextOrThrow(`${basePath}.html`, `[runtime-plugins] Failed to load template for ${normalizedComponent}`),
        fetchTextOrThrow(`${basePath}.css`, `[runtime-plugins] Failed to load stylesheet for ${normalizedComponent}`),
        isNonEmptyString(presenterName) ? fetchOptionalText(`${basePath}.js`) : Promise.resolve('')
    ]);

    let presenterModuleInstance;
    if (isNonEmptyString(presenterName) && presenterSource.trim()) {
        try {
            presenterModuleInstance = await import(/* webpackIgnore: true */ `${basePath}.js?cacheBust=${Date.now()}`);
        } catch (error) {
            console.error(`[runtime-plugins] Failed to import presenter for ${normalizedComponent}:`, error);
        }
    }

    const fullComponent = {
        name: normalizedComponent,
        loadedTemplate,
        loadedCSS,
        presenterClassName: isNonEmptyString(presenterName) ? presenterName.trim() : undefined,
        presenterModule: presenterSource,
        agent: normalizedAgent
    };

    const componentForRegistration = {
        ...fullComponent,
        loadedCSSs: [loadedCSS]
    };
    delete componentForRegistration.presenterModule;

    if (presenterModuleInstance && fullComponent.presenterClassName) {
        componentForRegistration.presenterModule = presenterModuleInstance;
    }

    await webSkel.defineComponent(componentForRegistration);
    return fullComponent;
}

async function loadRuntimePluginComponents(webSkel, runtimePlugins) {
    if (!runtimePlugins || typeof runtimePlugins !== 'object') {
        return new Map();
    }

    const scheduledComponents = new Map();
    const scheduleComponent = (meta) => {
        const componentName = meta?.componentName;
        const agent = meta?.agent;
        if (!isNonEmptyString(componentName) || !isNonEmptyString(agent)) {
            return;
        }
        const key = `${agent.trim()}::${componentName.trim()}`;
        if (!scheduledComponents.has(key)) {
            scheduledComponents.set(key, {
                componentName: componentName.trim(),
                presenterName: isNonEmptyString(meta.presenterName) ? meta.presenterName.trim() : undefined,
                agent: agent.trim(),
                ownerComponent: isNonEmptyString(meta.ownerComponent) ? meta.ownerComponent.trim() : undefined,
                isDependency: Boolean(meta.isDependency),
                customPath: isNonEmptyString(meta.customPath) ? meta.customPath.trim() : undefined
            });
        }
    };

    for (const plugins of Object.values(runtimePlugins)) {
        if (!Array.isArray(plugins)) {
            continue;
        }
        for (const plugin of plugins) {
            if (!plugin || typeof plugin !== 'object') {
                continue;
            }
            scheduleComponent({
                componentName: plugin.component,
                presenterName: plugin.presenter,
                agent: plugin.agent,
                ownerComponent: plugin.component,
                isDependency: false
            });

            if (Array.isArray(plugin.dependencies)) {
                for (const dependency of plugin.dependencies) {
                    if (!dependency || typeof dependency !== 'object') {
                        continue;
                    }
                    const dependencyComponent = dependency.component || dependency.name;
                    const dependencyPresenter = dependency.presenter || dependency.presenterClassName;
                    const dependencyAgent = dependency.agent || plugin.agent;
                    const dependencyPath = dependency.path || dependency.directory;
                    scheduleComponent({
                        componentName: dependencyComponent,
                        presenterName: dependencyPresenter,
                        agent: dependencyAgent,
                        ownerComponent: dependency.ownerComponent || plugin.component,
                        isDependency: true,
                        customPath: dependencyPath
                    });
                }
            }
        }
    }

    const loaded = new Map();
    for (const componentMeta of scheduledComponents.values()) {
        try {
            const component = await loadComponentFromAgent(webSkel, componentMeta);
            if (component) {
                loaded.set(`${componentMeta.agent}::${componentMeta.componentName}`, component);
            }
        } catch (error) {
            console.error(`[runtime-plugins] Failed to load component ${componentMeta.componentName} from agent ${componentMeta.agent}:`, error);
        }
    }

    return loaded;
}

async function start() {
    const webSkel = await WebSkel.initialise('webskel.json');
    webSkel.appServices = assistosSDK;

    const runtimePlugins = await fetchRuntimePlugins();
    const loadedRuntimeComponents = await loadRuntimePluginComponents(webSkel, runtimePlugins);

    const assistOS = initialiseAssistOS({ ui: webSkel, runtimePlugins: runtimePlugins ?? undefined });
    assistOS.webSkel = webSkel;
    assistOS.appServices = assistosSDK;
    assistOS.runtimePlugins = runtimePlugins ?? {};
    assistOS.runtimePluginComponents = loadedRuntimeComponents;
    if (typeof window !== 'undefined') {
        window.UI = webSkel;
    }
    //TODO review this
    const originalShowModal = typeof webSkel.showModal === 'function' ? webSkel.showModal.bind(webSkel) : null;
    webSkel.showModal = async (name, payload = {}, expectResult = false) => {
        const component = webSkel.configs?.components?.find?.((item) => item.name === name);
        if (component && typeof originalShowModal === 'function') {
            return originalShowModal(name, payload, expectResult);
        }

        switch (name) {
            case 'confirm-action-modal': {
                const message = payload?.message ?? 'Are you sure?';
                const confirmed = typeof window !== 'undefined'
                    ? window.confirm(message)
                    : true;
                return expectResult ? confirmed : undefined;
            }
            case 'add-comment': {
                if (typeof window === 'undefined') {
                    return expectResult ? '' : undefined;
                }
                const result = window.prompt('Enter comment', '');
                return expectResult ? result : undefined;
            }
            default: {
                console.warn(`[assistOS] Modal "${name}" is not registered in the local configs.`);
                return expectResult ? null : undefined;
            }
        }
    };

    webSkel.setLoading(`<div class="spinner-container"><div class="spin"></div></div>`);
    webSkel.setDomElementForPages(document.querySelector("#page_content"));
    const loader = document.querySelector("#before_webskel_loader");
    loader.close(); // Close the loader
    loader.remove();

    const hash = window.location.hash;
    let pageName;
    let url;
    if(hash){
        url = hash.substring(1);
        pageName = url.split('/')[0].split('?')[0];
    } else {
        pageName = 'file-exp';
        url = 'file-exp';
    }

    await webSkel.changeToDynamicPage(pageName || 'file-exp', url || 'file-exp');
    window.webSkel = webSkel;
}

start();
