import { fetchTextOrThrow } from '../../utils/pluginUtils.core.js';
import { withRetry } from '../utils/retry.js';
import { isTransientAssetLoadError } from './bootstrapRecovery.js';

const INSTALL_MARKER = Symbol('explorerResourceLoaderInstalled');
const DEFAULT_RETRY_OPTIONS = Object.freeze({
    retries: 2,
    delayMs: 250,
    shouldRetry: isTransientAssetLoadError
});

function resolveComponentAssetUrl(webSkel, component, extension) {
    const configs = webSkel?.configs || {};
    const root = configs.rootDir || configs.webComponentsRootDir || '';
    const directory = component?.directory ? `/${component.directory}` : '';
    const base = root
        ? `${root}${directory}`
        : `${directory || ''}`;
    return `${base}/${component.type}/${component.name}/${component.name}.${extension}`;
}

export function installExplorerResourceLoader(webSkel, options = {}) {
    const resourceManager = webSkel?.ResourceManager;
    if (!resourceManager || typeof resourceManager.loadComponent !== 'function') {
        throw new Error('Explorer resource loader requires a WebSkel ResourceManager.');
    }
    if (resourceManager[INSTALL_MARKER]) return;

    const retryOptions = {
        ...DEFAULT_RETRY_OPTIONS,
        ...(options.retryOptions || {})
    };
    const originalLoadComponent = resourceManager.loadComponent.bind(resourceManager);

    resourceManager.loadComponent = async (component) => {
        if (!component) {
            return originalLoadComponent(component);
        }

        const hasLoadedTemplate = typeof component.loadedTemplate === 'string';
        const hasLoadedStylesheets = Array.isArray(component.loadedCSSs);
        if (hasLoadedTemplate && hasLoadedStylesheets) {
            return originalLoadComponent(component);
        }

        const templateUrl = resolveComponentAssetUrl(webSkel, component, 'html');
        const stylesheetUrl = resolveComponentAssetUrl(webSkel, component, 'css');
        const [loadedTemplate, loadedCSSs] = await Promise.all([
            hasLoadedTemplate
                ? component.loadedTemplate
                : withRetry(
                    () => fetchTextOrThrow(
                        templateUrl,
                        `[explorer] Failed to load template for ${component.name}`
                    ),
                    retryOptions
                ),
            hasLoadedStylesheets
                ? component.loadedCSSs
                : withRetry(
                    () => fetchTextOrThrow(
                        stylesheetUrl,
                        `[explorer] Failed to load stylesheet for ${component.name}`
                    ).then(stylesheet => [stylesheet]),
                    retryOptions
                )
        ]);

        return originalLoadComponent({
            ...component,
            loadedTemplate,
            loadedCSSs
        });
    };
    resourceManager[INSTALL_MARKER] = true;
}
