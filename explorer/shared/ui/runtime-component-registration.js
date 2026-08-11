export async function registerRuntimeComponent(webSkel, componentDefinition) {
    const {name, loadedTemplate, loadedCSSs, presenterClassName, presenterModule} = componentDefinition;
    const componentType = componentDefinition.componentType || componentDefinition.type;
    const normalizedType = componentType === 'modals' ? 'modals' : 'components';
    const resourceManager = webSkel.ResourceManager;

    const ensureResourceEntry = () => {
        const entry = resourceManager.components[name];
        if (!entry || typeof entry !== 'object') {
            resourceManager.components[name] = {
                html: '',
                css: [],
                presenter: null,
                loadingPromise: null,
                isPromiseFulfilled: false
            };
        }
        return resourceManager.components[name];
    };

    const upsertConfigEntry = () => {
        const configs = webSkel.configs?.components;
        if (!Array.isArray(configs)) return;
        const baseEntry = {
            name,
            type: normalizedType,
            presenterClassName,
            loadedTemplate,
            loadedCSSs: loadedCSSs || []
        };
        const existingIndex = configs.findIndex((entry) => entry?.name === name);
        if (existingIndex === -1) {
            configs.push(baseEntry);
            return;
        }
        configs[existingIndex] = { ...configs[existingIndex], ...baseEntry };
    };

    const ensurePresenterRegistered = () => {
        ensureResourceEntry();
        if (presenterClassName && presenterModule?.[presenterClassName]) {
            resourceManager.registerPresenter(name, presenterModule[presenterClassName]);
        }
    };

    const updateResourceEntry = async () => {
        const entry = ensureResourceEntry();
        entry.html = loadedTemplate;
        entry.css = Array.isArray(loadedCSSs) ? loadedCSSs : [];
        entry.isPromiseFulfilled = true;
        entry.loadingPromise = Promise.resolve({html: entry.html, css: entry.css});
        resourceManager.components[name] = entry;
        if (entry.css.length > 0) {
            try {
                await resourceManager.unloadStyleSheets(name);
            } catch (_) {
                // The component may not have loaded a stylesheet yet.
            }
            await resourceManager.loadStyleSheets(entry.css, name);
        }
        ensurePresenterRegistered();
    };

    if (!customElements.get(name)) {
        await webSkel.defineComponent({ ...componentDefinition, type: normalizedType });
        ensurePresenterRegistered();
        await updateResourceEntry();
        upsertConfigEntry();
        return;
    }

    await updateResourceEntry();
    upsertConfigEntry();
}
