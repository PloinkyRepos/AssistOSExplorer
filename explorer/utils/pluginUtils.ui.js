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
        if (!Array.isArray(configs)) {
            return;
        }
        const baseEntry = {
            name,
            type: normalizedType,
            presenterClassName,
            loadedTemplate,
            loadedCSSs: loadedCSSs || []
        };
        const existingIndex = configs.findIndex((c) => c && c.name === name);
        if (existingIndex === -1) {
            configs.push(baseEntry);
            return;
        }
        configs[existingIndex] = {
            ...configs[existingIndex],
            ...baseEntry
        };
    };

    const ensurePresenterRegistered = async () => {
        ensureResourceEntry();
        if (
            presenterClassName
            && presenterModule
            && typeof presenterModule === 'object'
            && presenterModule[presenterClassName]
        ) {
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
            } catch (_) { /* ignore */ }
            await resourceManager.loadStyleSheets(entry.css, name);
        }
        await ensurePresenterRegistered();
    };

    if (!customElements.get(name)) {
        await webSkel.defineComponent({
            ...componentDefinition,
            type: normalizedType
        });
        await ensurePresenterRegistered();
        await updateResourceEntry();
        upsertConfigEntry();
        return;
    }

    await updateResourceEntry();
    upsertConfigEntry();
}

function getPluginSettingsMap() {
    const settings = assistOS?.pluginSettings;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        return {};
    }
    return settings;
}

function getPluginKey(plugin) {
    const agent = typeof plugin?.agent === 'string' ? plugin.agent.trim() : '';
    const component = typeof plugin?.component === 'string' ? plugin.component.trim() : '';
    if (!agent || !component) {
        return '';
    }
    return `${agent}/${component}`;
}

function isPluginEnabled(plugin) {
    const key = getPluginKey(plugin);
    if (!key) {
        return true;
    }
    const entry = getPluginSettingsMap()[key];
    if (!entry || typeof entry !== 'object') {
        return true;
    }
    return entry.enabled !== false;
}

async function openPlugin(componentName, type, context, presenter, autoPin = false) {
    const registry = assistOS.workspace.plugins[type];
    if (!Array.isArray(registry)) {
        console.warn(`[runtime-plugins] Missing plugin registry for type "${type}".`);
        return;
    }
    const plugin = registry.find((p) => p && p.component === componentName);
    if (!plugin) {
        console.warn(`[runtime-plugins] Plugin "${componentName}" not found for type "${type}".`);
        return;
    }
    if (!isPluginEnabled(plugin)) {
        console.warn(`[runtime-plugins] Plugin "${componentName}" is disabled in workspace settings.`);
        return;
    }
    await initializePlugin(plugin);
    highlightPlugin(type, componentName, presenter);
    if (plugin.type === "embedded") {
        let pluginContainer = presenter.element.querySelector(`.${type}-plugin-container`);
        let contextString = encodeURIComponent(JSON.stringify(context));
        pluginContainer.classList.add("plugin-open");
        pluginContainer.innerHTML = `<${componentName} data-pin="${autoPin}" class="assistos-plugin" data-type="${type}" data-context="${contextString}" data-presenter="${componentName}"></${componentName}>`;
    } else {
        await assistOS.UI.showModal(componentName, {
            context: encodeURIComponent(JSON.stringify(context)),
        }, true);
        removeHighlightPlugin(type, presenter);
        if (presenter && presenter.currentPlugin === componentName) {
            delete presenter.currentPlugin;
        }
    }
    let pluginElement = presenter.element.querySelector(componentName);
    if (pluginElement) {
        let firstEditableItem = pluginElement.closest('[data-local-action^="editItem "]');
        if (firstEditableItem) {
            pluginElement.addEventListener("click", () => {
                firstEditableItem.click();
            });
        }
    }
}

function removeHighlightPlugin(type, presenter) {
    let highlightPluginClass = `${type}-highlight-plugin`;
    let pluginIcon = presenter.element.querySelector(`.icon-container.${highlightPluginClass}`);
    if (pluginIcon) {
        pluginIcon.classList.remove(highlightPluginClass);
    }

}

function highlightPlugin(type, componentName, presenter) {
    let highlightPluginClass = `${type}-highlight-plugin`;
    let highlightPlugin = presenter.element.querySelector(`.${highlightPluginClass}`);
    if (highlightPlugin) {
        highlightPlugin.classList.remove(highlightPluginClass);
    }
    let pluginIcon = presenter.element.querySelector(`.icon-container.${componentName}`);
    pluginIcon.classList.add(highlightPluginClass);
}

async function initializePlugin(plugin) {
    if (!plugin || plugin.initialized) {
        return;
    }
    plugin.initialized = true;
}

async function renderPluginIcons(containerElement, type) {
    const registry = assistOS.workspace.plugins[type];
    const plugins = Array.isArray(registry) ? registry.filter((plugin) => plugin && isPluginEnabled(plugin)) : [];
    for (const plugin of plugins) {
        if (!plugin) continue;
        if (plugin.iconPresenter && plugin.iconComponent) {
            const iconContainer = document.createElement("div");
            const iconContext = {icon: plugin.icon, plugin: plugin.component, type};
            const contextString = encodeURIComponent(JSON.stringify(iconContext));
            iconContainer.innerHTML = `<${plugin.iconComponent} data-context="${contextString}" data-presenter="${plugin.iconComponent}"></${plugin.iconComponent}>`;
            attachPluginTooltip(iconContainer, plugin, type, plugin.autoPin);
            containerElement.appendChild(iconContainer);
        } else {
            const iconSrc = await getPluginIcon(plugin);
            const containerDiv = document.createElement("div");
            containerDiv.innerHTML = `<img class="pointer black-icon" loading="lazy" src="${iconSrc}" alt="icon">`;
            attachPluginTooltip(containerDiv, plugin, type, plugin.autoPin);
            containerElement.appendChild(containerDiv);
        }
    }
}

function attachPluginTooltip(containerElement, plugin, type, autoPin = false) {
    containerElement.classList.add("icon-container", "plugin-circle", plugin.component, "pointer");
    containerElement.setAttribute("data-local-action", `openPlugin ${type} ${plugin.component} ${autoPin}`);
    let tooltip = containerElement.querySelector(".plugin-name");
    if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.classList.add("plugin-name");
        tooltip.innerHTML = plugin.tooltip;
        containerElement.appendChild(tooltip);
    }
    containerElement.addEventListener("mouseover", async () => {
        containerElement.querySelector(".plugin-name").style.display = "block";
    });
    containerElement.addEventListener("mouseout", async () => {
        containerElement.querySelector(".plugin-name").style.display = "none";
    });
    containerElement.addEventListener("plugin-modal-closed", () => {
        containerElement.classList.remove(`${type}-highlight-plugin`);
    });
}

async function getPluginIcon(plugin) {
    const icon = typeof plugin.icon === 'string' ? plugin.icon.trim() : '';
    if (!icon) {
        return '';
    }
    if (
        icon.startsWith('data:')
        || /^https?:\/\//i.test(icon)
        || icon.startsWith('/workspace-files/')
    ) {
        return icon;
    }
    const agent = plugin.agent || '';
    const normalized = icon.replace(/^\/+/, '');
    if (agent) {
        const alreadyAgentPath = normalized.startsWith(`${agent}/IDE-plugins/`) || normalized.startsWith(`IDE-plugins/`);
        if (alreadyAgentPath) {
            return icon.startsWith('/') ? icon : `/${normalized}`;
        }
        return `/${agent}/IDE-plugins/${plugin.component}/${normalized}`;
    }
    return icon.startsWith('/') ? icon : `/${normalized}`;
}

const pluginUtils = {
    openPlugin,
    renderPluginIcons,
    removeHighlightPlugin,
};

export default pluginUtils;
