const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const WORKSPACE_FILES_PREFIX = '/workspace-files';

function normalizePathSegments(value) {
    return String(value || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .replace(/\/+/g, '/')
        .split('/')
        .filter((segment) => segment && segment !== '..' && segment !== '.')
        .join('/');
}

function buildWorkspaceFilesUrl(relativePath) {
    const cleaned = normalizePathSegments(relativePath);
    return cleaned ? `${WORKSPACE_FILES_PREFIX}/${cleaned}` : WORKSPACE_FILES_PREFIX;
}

function joinUrlSegments(base, ...segments) {
    const normalizedBase = String(base || '').replace(/\/+$/, '');
    const normalizedSegments = segments
        .map((segment) => normalizePathSegments(segment))
        .filter(Boolean);
    if (!normalizedSegments.length) {
        return normalizedBase;
    }
    return `${normalizedBase}/${normalizedSegments.join('/')}`.replace(/\/+/g, '/');
}

function getParentPath(value) {
    const cleaned = normalizePathSegments(value);
    if (!cleaned) {
        return '';
    }
    const segments = cleaned.split('/');
    segments.pop();
    return segments.join('/');
}

export const DOCUMENT_PLUGIN_CATEGORY = 'document';
export const APPLICATION_PLUGIN_CATEGORY = 'application';
export const DEFAULT_DOCUMENT_PLUGIN_LOCATIONS = ['document', 'chapter', 'paragraph', 'infoText'];

export function getApplicationPluginPolicyKey(entry) {
    const pluginId = isNonEmptyString(entry?.id) ? entry.id.trim() : '';
    if (pluginId) {
        return pluginId;
    }
    const agent = isNonEmptyString(entry?.agent) ? entry.agent.trim() : '';
    const component = isNonEmptyString(entry?.component) ? entry.component.trim() : '';
    return agent && component ? `${agent}/${component}` : '';
}

function createEmptyRuntimePluginState() {
    return {
        [DOCUMENT_PLUGIN_CATEGORY]: Object.fromEntries(DEFAULT_DOCUMENT_PLUGIN_LOCATIONS.map((loc) => [loc, []])),
        [APPLICATION_PLUGIN_CATEGORY]: {}
    };
}

function ensureRuntimePluginBucket(buckets, category, location) {
    if (!buckets[category] || typeof buckets[category] !== 'object' || Array.isArray(buckets[category])) {
        buckets[category] = {};
    }
    if (!Array.isArray(buckets[category][location])) {
        buckets[category][location] = [];
    }
    return buckets[category][location];
}

export function forEachRuntimePluginEntry(runtimePlugins, visitor) {
    if (!runtimePlugins || typeof runtimePlugins !== 'object' || typeof visitor !== 'function') {
        return;
    }

    for (const category of [DOCUMENT_PLUGIN_CATEGORY, APPLICATION_PLUGIN_CATEGORY]) {
        const buckets = runtimePlugins[category];
        if (!buckets || typeof buckets !== 'object' || Array.isArray(buckets)) {
            continue;
        }
        for (const [location, entries] of Object.entries(buckets)) {
            if (!Array.isArray(entries)) {
                continue;
            }
            for (const entry of entries) {
                visitor(entry, {
                    category,
                    location
                });
            }
        }
    }
}

export function resolveRuntimeAssetUrl(agent, component, assetPath, fallback = '', {assetBaseUrl, pluginsBaseUrl} = {}) {
    if (!isNonEmptyString(agent) || !isNonEmptyString(component)) {
        return assetPath;
    }
    const effectiveAssetBaseUrl = isNonEmptyString(assetBaseUrl)
        ? assetBaseUrl.trim().replace(/\/+$/, '')
        : `/${agent}/IDE-plugins/${component}`;
    const effectivePluginsBaseUrl = isNonEmptyString(pluginsBaseUrl)
        ? pluginsBaseUrl.trim().replace(/\/+$/, '')
        : `/${agent}/IDE-plugins`;
    if (!isNonEmptyString(assetPath)) {
        return fallback ? joinUrlSegments(effectiveAssetBaseUrl, fallback) : effectiveAssetBaseUrl;
    }
    const trimmed = assetPath.trim();
    if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:')) {
        return trimmed;
    }
    if (trimmed.startsWith(`${WORKSPACE_FILES_PREFIX}/`)) {
        return trimmed;
    }
    const withoutLeadingSlash = trimmed.replace(/^\/+/, '');
    if (withoutLeadingSlash.startsWith(`${agent}/IDE-plugins/`)) {
        const relativeToPlugins = withoutLeadingSlash.slice(`${agent}/IDE-plugins/`.length);
        return joinUrlSegments(effectivePluginsBaseUrl, relativeToPlugins);
    }
    if (withoutLeadingSlash.startsWith('IDE-plugins/')) {
        const relativeToPlugins = withoutLeadingSlash.slice('IDE-plugins/'.length);
        return joinUrlSegments(effectivePluginsBaseUrl, relativeToPlugins);
    }
    const cleaned = normalizePathSegments(withoutLeadingSlash.replace(/^\.\/+/, ''));
    return joinUrlSegments(effectiveAssetBaseUrl, cleaned);
}

export function computeComponentBaseUrl(agent, component, {
    ownerComponent,
    isDependency,
    customPath,
    assetBaseUrl,
    pluginsBaseUrl,
    ownerAssetBaseUrl
} = {}) {
    if (!isNonEmptyString(agent) || !isNonEmptyString(component)) {
        return '';
    }
    const effectiveAssetBaseUrl = isNonEmptyString(assetBaseUrl)
        ? assetBaseUrl.trim().replace(/\/+$/, '')
        : `/${agent}/IDE-plugins/${component}`;
    const effectivePluginsBaseUrl = isNonEmptyString(pluginsBaseUrl)
        ? pluginsBaseUrl.trim().replace(/\/+$/, '')
        : `/${agent}/IDE-plugins`;
    if (isNonEmptyString(customPath)) {
        return joinUrlSegments(effectivePluginsBaseUrl, customPath);
    }
    if (isDependency && isNonEmptyString(ownerComponent) && ownerComponent.trim() !== component.trim()) {
        const child = component.trim();
        if (isNonEmptyString(ownerAssetBaseUrl)) {
            return joinUrlSegments(ownerAssetBaseUrl, 'components', child, child);
        }
        const owner = ownerComponent.trim();
        return `/${agent}/IDE-plugins/${owner}/components/${child}/${child}`;
    }
    return joinUrlSegments(effectiveAssetBaseUrl, component);
}

export function normalizeRuntimePlugins(runtimePlugins) {
    const normalized = createEmptyRuntimePluginState();
    if (!runtimePlugins || typeof runtimePlugins !== 'object') {
        return normalized;
    }

    forEachRuntimePluginEntry(runtimePlugins, (entry, { category, location }) => {
        const bucket = ensureRuntimePluginBucket(normalized, category, location);
        if (!entry || typeof entry !== 'object') {
            return;
        }

        const agent = isNonEmptyString(entry.agent) ? entry.agent.trim() : '';
        const component = isNonEmptyString(entry.component) ? entry.component.trim() : '';
        if (!component) {
            return;
        }

        const assetRootPath = isNonEmptyString(entry.assetRootPath) ? normalizePathSegments(entry.assetRootPath) : '';
        const assetBaseUrl = assetRootPath
            ? buildWorkspaceFilesUrl(assetRootPath)
            : `/${agent}/IDE-plugins/${component}`;
        const pluginsBaseUrl = assetRootPath
            ? buildWorkspaceFilesUrl(getParentPath(assetRootPath))
            : `/${agent}/IDE-plugins`;
        const baseUrl = computeComponentBaseUrl(agent, component, {
            assetBaseUrl,
            pluginsBaseUrl
        });
        const normalizedEntry = {
            ...entry,
            pluginCategory: category,
            location,
            id: isNonEmptyString(entry.id) ? entry.id.trim() : undefined,
            component,
            label: isNonEmptyString(entry.label)
                ? entry.label.trim()
                : isNonEmptyString(entry.tooltip)
                    ? entry.tooltip.trim()
                    : component,
            tooltip: isNonEmptyString(entry.tooltip) ? entry.tooltip : component,
            presenter: isNonEmptyString(entry.presenter) ? entry.presenter.trim() : undefined,
            type: isNonEmptyString(entry.type) ? entry.type : 'embedded',
            autoPin: Boolean(entry.autoPin),
            agent,
            icon: resolveRuntimeAssetUrl(agent, component, entry.icon, 'icon.svg', {
                assetBaseUrl,
                pluginsBaseUrl
            }),
            runtime: true,
            componentBaseUrl: baseUrl,
            assetBaseUrl
        };

        if (Array.isArray(entry.dependencies) && entry.dependencies.length > 0) {
            normalizedEntry.dependencies = entry.dependencies.map((dependency) => {
                if (!dependency || typeof dependency !== 'object') {
                    return dependency;
                }
                const dependencyAgent = isNonEmptyString(dependency.agent) ? dependency.agent : agent;
                const dependencyName = isNonEmptyString(dependency.component)
                    ? dependency.component
                    : isNonEmptyString(dependency.name)
                        ? dependency.name
                        : '';
                const dependencyPath = isNonEmptyString(dependency.path) ? dependency.path : dependency.directory;
                return {
                    ...dependency,
                    agent: dependencyAgent,
                    component: dependencyName,
                    baseUrl: computeComponentBaseUrl(dependencyAgent, dependencyName, {
                        ownerComponent: dependency.ownerComponent || component,
                        isDependency: true,
                        customPath: dependencyPath,
                        pluginsBaseUrl,
                        ownerAssetBaseUrl: assetBaseUrl
                    })
                };
            });
        }

        bucket.push(normalizedEntry);
    });

    return normalized;
}

export function mergeRuntimePluginsIntoAssistOS(assistOS, runtimePlugins) {
    if (!assistOS || !assistOS.workspace) {
        return;
    }

    const workspaceDocumentPlugins = assistOS.workspace.plugins || {};
    const workspaceApplicationPlugins = assistOS.workspace.appPlugins || {};
    assistOS.workspace.plugins = workspaceDocumentPlugins;
    assistOS.workspace.appPlugins = workspaceApplicationPlugins;

    forEachRuntimePluginEntry(runtimePlugins, (entry, { category, location }) => {
        if (!entry || typeof entry !== 'object' || !isNonEmptyString(entry.component)) {
            return;
        }

        const targetRegistry = category === APPLICATION_PLUGIN_CATEGORY
            ? workspaceApplicationPlugins
            : workspaceDocumentPlugins;

        if (!Array.isArray(targetRegistry[location])) {
            targetRegistry[location] = [];
        }

        const bucket = targetRegistry[location];
        const existingIndex = bucket.findIndex((plugin) => plugin && plugin.component === entry.component);
        if (existingIndex !== -1) {
            bucket.splice(existingIndex, 1);
        }

        bucket.push(entry);
    });
}

export function filterRuntimePluginsByApplicationPolicy(runtimePlugins, applicationPluginsPolicy) {
    const normalizedPolicy = applicationPluginsPolicy && typeof applicationPluginsPolicy === 'object' && !Array.isArray(applicationPluginsPolicy)
        ? applicationPluginsPolicy
        : null;

    if (!normalizedPolicy) {
        return runtimePlugins;
    }

    const filtered = createEmptyRuntimePluginState();

    forEachRuntimePluginEntry(runtimePlugins, (entry, { category, location }) => {
        if (!entry || typeof entry !== 'object') {
            return;
        }

        if (category === APPLICATION_PLUGIN_CATEGORY) {
            const key = getApplicationPluginPolicyKey(entry);
            if (key && normalizedPolicy[key] === false) {
                return;
            }
        }

        const bucket = ensureRuntimePluginBucket(filtered, category, location);
        bucket.push(entry);
    });

    return filtered;
}

export async function fetchTextOrThrow(url, description) {
    const response = await fetch(url, {cache: 'no-cache'});
    if (!response.ok) {
        throw new Error(`${description} (${response.status})`);
    }
    return response.text();
}

export async function fetchOptionalText(url) {
    const response = await fetch(url, {cache: 'no-cache'});
    if (!response.ok) {
        return '';
    }
    return response.text();
}

export function scopeCssToComponent(cssText, componentName) {
    if (!isNonEmptyString(cssText) || !isNonEmptyString(componentName)) {
        return cssText || '';
    }
    const tag = componentName.trim();

    const scopeSelector = (selector) => {
        if (!selector) return '';
        let scoped = selector.trim();
        if (!scoped) return '';
        scoped = scoped.replace(/:host\b/g, tag);
        if (scoped.startsWith(tag) || scoped.startsWith('@')) {
            return scoped;
        }
        return `${tag} ${scoped}`;
    };

    return cssText.replace(/(^|})\s*([^{}@][^{}]*)\{/g, (match, prefix, selectorGroup) => {
        const scopedSelectors = selectorGroup
            .split(',')
            .map(scopeSelector)
            .filter(Boolean)
            .join(', ');
        return `${prefix} ${scopedSelectors} {`;
    });
}
