export { registerRuntimeComponent } from '../shared/ui/runtime-component-registration.js';

function getPluginSettingsMap() {
    const settings = assistOS?.pluginSettings;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        return {};
    }
    return settings;
}

function getPluginKey(plugin) {
    return getRuntimePluginPolicyKey(plugin);
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
            attachPluginAction(iconContainer, plugin, type, plugin.autoPin);
            containerElement.appendChild(iconContainer);
        } else {
            const iconSrc = await getPluginIcon(plugin);
            const containerDiv = document.createElement("div");
            containerDiv.innerHTML = `<img class="pointer black-icon" loading="lazy" src="${iconSrc}" alt="icon">`;
            attachPluginAction(containerDiv, plugin, type, plugin.autoPin);
            containerElement.appendChild(containerDiv);
        }
    }
}

function attachPluginAction(containerElement, plugin, type, autoPin = false) {
    containerElement.classList.add("icon-container", "plugin-circle", plugin.component, "pointer");
    containerElement.setAttribute("data-local-action", `openPlugin ${type} ${plugin.component} ${autoPin}`);
    if (plugin.tooltip) {
        containerElement.setAttribute("title", plugin.tooltip);
        containerElement.setAttribute("aria-label", plugin.tooltip);
    }
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
import { getRuntimePluginPolicyKey } from './pluginUtils.core.js';
