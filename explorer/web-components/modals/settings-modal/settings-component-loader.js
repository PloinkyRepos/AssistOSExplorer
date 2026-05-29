import { registerRuntimeComponent } from "../../../utils/pluginUtils.ui.js";

const settingsComponentPromises = new Map();

function normalizePathSegment(value) {
    return String(value || "")
        .replace(/\\/g, "/")
        .replace(/^\/+/, "")
        .replace(/\/+$/g, "")
        .replace(/\/+/g, "/");
}

function toPascalCase(value) {
    return String(value || "")
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join("");
}

async function fetchText(url, description) {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) {
        throw new Error(`${description} (${response.status})`);
    }
    return response.text();
}

export function resolveSettingsComponentBase(item) {
    const settingsComponent = typeof item?.settingsComponent === "string" ? item.settingsComponent.trim() : "";
    if (!settingsComponent) {
        return "";
    }

    const component = typeof item?.component === "string" ? item.component.trim() : "";
    const componentBaseUrl = typeof item?.componentBaseUrl === "string" ? item.componentBaseUrl.trim() : "";
    if (component && settingsComponent === component && componentBaseUrl) {
        return componentBaseUrl.replace(/\/+$/g, "");
    }

    const normalizedSettings = normalizePathSegment(settingsComponent);
    const assetRootPath = normalizePathSegment(item?.assetRootPath);
    if (assetRootPath) {
        return `/workspace-files/${assetRootPath}/${normalizedSettings}/${normalizedSettings}`;
    }

    const agent = typeof item?.agent === "string" ? item.agent.trim() : "";
    if (!agent || !component) {
        return "";
    }

    return `/${agent}/IDE-plugins/${component}/${normalizedSettings}/${normalizedSettings}`;
}

export function resolvePluginSettingsUrl(item) {
    const settingsUrl = typeof item?.settingsUrl === "string" ? item.settingsUrl.trim() : "";
    if (!settingsUrl || !settingsUrl.startsWith("/") || settingsUrl.startsWith("//")) {
        return "";
    }
    return settingsUrl;
}

export function openPluginSettingsUrl(item, win = globalThis.window) {
    const settingsUrl = resolvePluginSettingsUrl(item);
    if (!settingsUrl || !win || typeof win.open !== "function") {
        return false;
    }
    const opened = win.open(settingsUrl, "_blank", "noopener,noreferrer");
    if (opened) {
        opened.opener = null;
    }
    return true;
}

export async function ensureSettingsComponentRegistered(item) {
    const componentName = typeof item?.settingsComponent === "string" ? item.settingsComponent.trim() : "";
    if (!componentName) {
        throw new Error("Plugin does not define a settings component.");
    }

    if (customElements.get(componentName)) {
        return componentName;
    }

    if (settingsComponentPromises.has(componentName)) {
        return settingsComponentPromises.get(componentName);
    }

    const promise = (async () => {
        const baseUrl = resolveSettingsComponentBase(item);
        if (!baseUrl) {
            throw new Error(`Unable to resolve settings component path for ${componentName}.`);
        }

        const [template, css] = await Promise.all([
            fetchText(`${baseUrl}.html`, `Failed to load settings template for ${componentName}`),
            fetchText(`${baseUrl}.css`, `Failed to load settings stylesheet for ${componentName}`)
        ]);

        const module = await import(`${baseUrl}.js?cacheBust=${Date.now()}`);
        const presenterClassName = Object.keys(module || {}).find((key) => typeof module[key] === "function")
            || `${toPascalCase(componentName)}Settings`;

        await registerRuntimeComponent(assistOS.webSkel, {
            name: componentName,
            componentType: "modals",
            loadedTemplate: template,
            loadedCSSs: [css],
            presenterClassName,
            presenterModule: module,
            type: "modals"
        });

        return componentName;
    })().finally(() => {
        settingsComponentPromises.delete(componentName);
    });

    settingsComponentPromises.set(componentName, promise);
    return promise;
}

