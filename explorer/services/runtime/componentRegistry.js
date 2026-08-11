import {
    computeComponentBaseUrl,
    fetchTextOrThrow,
    scopeCssToComponent
} from '../../utils/pluginUtils.core.js';
import { registerRuntimeComponent } from '../../utils/pluginUtils.ui.js';
import { withRetry } from '../utils/retry.js';
import { isTransientAssetLoadError } from './bootstrapRecovery.js';

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const runtimeImportCacheBust = Date.now().toString(36);
let runtimeImportSequence = 0;
const assetRetryOptions = Object.freeze({
    retries: 2,
    delayMs: 250,
    shouldRetry: isTransientAssetLoadError
});

export function createComponentRegistry(webSkel) {
    if (!webSkel) {
        throw new Error('[runtime] component registry requires a WebSkel instance.');
    }

    const componentCache = new Map();

    const getCacheKey = (meta) => {
        const agent = meta?.agent;
        const componentName = meta?.componentName;
        if (!isNonEmptyString(agent) || !isNonEmptyString(componentName)) {
            return null;
        }
        return `${agent.trim()}::${componentName.trim()}`;
    };

    const resolveBaseUrl = (meta) => {
        if (isNonEmptyString(meta?.baseUrl)) {
            return meta.baseUrl.trim();
        }
        return computeComponentBaseUrl(meta.agent, meta.componentName, {
            ownerComponent: meta.ownerComponent,
            isDependency: meta.isDependency,
            customPath: meta.customPath
        });
    };

    const getRegisteredHostComponent = (meta) => {
        const componentName = meta?.componentName;
        if (
            !isNonEmptyString(componentName)
            || typeof customElements === 'undefined'
            || !customElements.get(componentName)
        ) {
            return null;
        }
        const config = webSkel.configs?.components?.find((entry) => entry?.name === componentName);
        if (!config) {
            return null;
        }
        return {
            name: componentName,
            componentType: config.type === 'modals' ? 'modals' : 'components',
            presenterClassName: config.presenterClassName,
            agent: meta.agent,
            hostRegistered: true
        };
    };

    const fetchComponentAssets = async (meta) => {
        const componentBase = resolveBaseUrl(meta);
        const safeBase = componentBase.replace(/\/+/g, '/');
        const [template, css] = await Promise.all([
            withRetry(
                () => fetchTextOrThrow(`${safeBase}.html`, `[runtime-plugins] Failed to load template for ${meta.componentName}`),
                assetRetryOptions
            ),
            withRetry(
                () => fetchTextOrThrow(`${safeBase}.css`, `[runtime-plugins] Failed to load stylesheet for ${meta.componentName}`),
                assetRetryOptions
            )
        ]);

        return {
            template,
            css,
            safeBase
        };
    };

    const importPresenterModule = async (meta, safeBase) => {
        if (!isNonEmptyString(meta.presenterName)) {
            return null;
        }
        const importSequence = ++runtimeImportSequence;
        return withRetry(async (attempt) => {
            const importVersion = `${runtimeImportCacheBust}-${importSequence}-${attempt}`;
            const moduleUrl = `${safeBase}.js?runtimeImport=${encodeURIComponent(importVersion)}`;
            return import(/* webpackIgnore: true */ moduleUrl);
        }, assetRetryOptions);
    };

    const loadComponent = async (meta) => {
        const cacheKey = getCacheKey(meta);
        if (!cacheKey) {
            return null;
        }
        if (componentCache.has(cacheKey)) {
            return componentCache.get(cacheKey);
        }
        const registeredHostComponent = getRegisteredHostComponent(meta);
        if (registeredHostComponent) {
            componentCache.set(cacheKey, registeredHostComponent);
            return registeredHostComponent;
        }

        const componentType = meta?.componentType === 'modals' ? 'modals' : 'components';
        const assets = await fetchComponentAssets(meta);
        const scopedCss = componentType === 'modals'
            ? assets.css
            : scopeCssToComponent(assets.css, meta.componentName);
        const presenterModuleInstance = await importPresenterModule(meta, assets.safeBase);

        const component = {
            name: meta.componentName,
            componentType,
            loadedTemplate: assets.template,
            loadedCSS: scopedCss,
            presenterClassName: isNonEmptyString(meta.presenterName) ? meta.presenterName.trim() : undefined,
            presenterModule: presenterModuleInstance,
            agent: meta.agent
        };

        const registrationPayload = {
            ...component,
            loadedCSSs: [scopedCss],
            type: componentType
        };
        if (
            presenterModuleInstance &&
            component.presenterClassName &&
            presenterModuleInstance[component.presenterClassName]
        ) {
            registrationPayload.presenterModule = presenterModuleInstance;
        }

        await registerRuntimeComponent(webSkel, registrationPayload);

        componentCache.set(cacheKey, component);
        return component;
    };

    return {
        loadComponent,
        getCachedComponent(meta) {
            const cacheKey = getCacheKey(meta);
            return cacheKey ? componentCache.get(cacheKey) : undefined;
        }
    };
}
