import documentModule from './document/localDocumentModule.js';
import defaultPlugins from '../core/plugins/defaultPlugins.js';

const DEFAULT_EMAIL = 'local@example.com';
const DEFAULT_IMAGE = './assets/images/default-personality.png';
const DEFAULT_COMMANDS = [
    'assign',
    'new',
    'macro',
    'jsdef',
    'append',
    'replace',
    'remove'
];
const DEFAULT_CUSTOM_TYPES = [
    'text',
    'number',
    'date',
    'list'
];

const createFontMap = () => ({
    tiny: '12px',
    small: '14px',
    medium: '16px',
    large: '20px',
    'x-large': '24px'
});

const createFontFamilyMap = () => ({
    arial: 'Arial, sans-serif',
    georgia: 'Georgia, serif',
    courier: '"Courier New", monospace',
    roboto: '"Roboto", sans-serif'
});

const createTextIndentMap = () => ({
    none: '0',
    small: '12px',
    medium: '24px',
    large: '36px'
});

const escapeHtml = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const unescapeHtml = (value = '') => {
    if (typeof window === 'undefined') {
        return value;
    }
    const div = document.createElement('textarea');
    div.innerHTML = value;
    return div.value;
};

const reverseQuerySelector = (element, selector, boundarySelector) => {
    let current = element;
    while (current) {
        if (current.matches && current.matches(selector)) {
            return current;
        }
        if (boundarySelector && current.matches && current.matches(boundarySelector)) {
            break;
        }
        current = current.parentElement;
    }
    return null;
};

const normalizeSpaces = (value) => {
    if (value === null || value === undefined) {
        return value;
    }
    if (typeof value !== 'string') {
        return value;
    }
    return value
        .replace(/\u00A0/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

const customTrim = (value) => {
    if (value === null || value === undefined) {
        return value;
    }
    if (typeof value !== 'string') {
        return value;
    }
    return value.replace(/^[\u00A0\s]+|[\u00A0\s]+$/g, '').trim();
};

const buildUIHelpers = () => {
    const configs = { components: [] };

    const normalizeParent = (parent) => {
        if (!parent) {
            return null;
        }
        if (typeof parent === 'string') {
            return document.querySelector(parent);
        }
        return parent;
    };

    return {
        configs,
        sanitize: escapeHtml,
        unsanitize: unescapeHtml,
        normalizeSpaces,
        customTrim,
        reverseQuerySelector,
        async showModal(name, payload = {}, expectResult = false) {
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
                default:
                    console.warn(`[assistOS] Modal "${name}" is not implemented in the local shim.`);
                    return expectResult ? null : undefined;
            }
        },
        closeModal() {
            // Intentionally left blank for local shim
        },
        async changeToDynamicPage(_pageName, url) {
            if (typeof url === 'string' && typeof window !== 'undefined') {
                window.location.hash = `#${url}`;
            }
        },
        createElement(tagName, parent = null, properties = {}, dataset = {}, _observe = false) {
            if (typeof document === 'undefined') {
                return null;
            }
            const element = document.createElement(tagName);
            Object.assign(element, properties);
            if (dataset && typeof dataset === 'object') {
                Object.entries(dataset).forEach(([key, value]) => {
                    element.setAttribute(key, value);
                });
            }
            const parentNode = normalizeParent(parent);
            if (parentNode) {
                parentNode.appendChild(element);
            }
            return element;
        },
        async showActionBox() {
            console.warn('[assistOS] showActionBox is not implemented in the local shim.');
            return null;
        },
        async showToast(message, type = 'info', timeout = 1500) {
            if (typeof document === 'undefined') {
                console.log(`[${type}] ${message}`);
                return;
            }
            const containerSelector = '.toast-container';
            let container = document.querySelector(containerSelector);
            if (!container) {
                container = document.createElement('div');
                container.classList.add('toast-container');
                document.body.appendChild(container);
            }

            const toast = document.createElement('div');
            toast.classList.add('timeout-toast', type);
            toast.innerHTML = `
                <div class="toast-left">
                    <span class="message-type">${type.charAt(0).toUpperCase() + type.slice(1)}:</span>
                    <span class="toast-message">${message}</span>
                </div>
                <button class="close" aria-label="Close">&times;</button>
            `;

            const removeToast = () => {
                toast.remove();
            };
            const closeButton = toast.querySelector('.close');
            closeButton.addEventListener('click', removeToast);
            container.appendChild(toast);
            setTimeout(removeToast, timeout);
        },
        extractFormInformation(target) {
            if (!target) {
                return {};
            }
            const form = target.tagName === 'FORM' ? target : target.closest('form');
            if (!form) {
                return {};
            }
            const data = new FormData(form);
            const result = {};
            for (const [key, value] of data.entries()) {
                result[key] = value;
            }
            return result;
        },
        async defineComponent(component) {
            configs.components.push(component);
        }
    };
};

const buildNotificationRouter = () => ({
    async subscribeToSpace(_spaceId, _resourceId, callback) {
        if (typeof callback === 'function') {
            callback();
        }
        return () => {};
    },
    async subscribeToDocument(_documentId, _resourceId, callback) {
        if (typeof callback === 'function') {
            callback();
        }
        return () => {};
    }
});

const buildAgentModule = () => ({
    async getAgents() {
        return [];
    }
});

const buildSpaceModule = (spaceState) => ({
    async getImageURL() {
        return DEFAULT_IMAGE;
    },
    async buildForDocument() {
        console.warn('[assistOS] buildForDocument is not supported in the local shim.');
        return null;
    },
    async runCode() {
        console.warn('[assistOS] runCode is not supported in the local shim.');
        return null;
    },
    async getCommands() {
        return [...DEFAULT_COMMANDS];
    },
    async getCustomTypes() {
        return [...DEFAULT_CUSTOM_TYPES];
    },
    async getAudioURL() {
        return '';
    },
    async getVideoURL() {
        return '';
    },
    async getMediaURL() {
        return '';
    },
    async insertTableRow(_spaceId, _docId, _varName, row) {
        return row;
    },
    async updateTableRow(_spaceId, _docId, _varName, row) {
        return row;
    },
    async deleteTableRow() {
        return true;
    },
    async putFile() {
        console.warn('[assistOS] putFile is not supported in the local shim.');
        return null;
    },
    async putImage() {
        console.warn('[assistOS] putImage is not supported in the local shim.');
        return null;
    },
    async putVideo() {
        console.warn('[assistOS] putVideo is not supported in the local shim.');
        return null;
    },
    async putAudio() {
        console.warn('[assistOS] putAudio is not supported in the local shim.');
        return null;
    },
    async getFileURL() {
        return '';
    }
});

const buildGalleryModule = () => ({
    async getGalleriesMetadata() {
        return [];
    },
    async getGallery(_spaceId, galleryId) {
        return { id: galleryId, name: 'Gallery', assets: [] };
    }
});

const buildUtilModule = () => ({
    async getTaskRelevantInfo() {
        return 'Task information unavailable.';
    },
    async removeTask() {
        return true;
    }
});

const buildApplicationModule = (ui) => {
    const componentsConfig = Array.isArray(ui?.configs?.components) ? ui.configs.components : [];
    const defaultEntryPoint = componentsConfig.find((component) => component.type === 'pages')?.name ?? 'file-exp';
    const componentsDirPath = './web-components/components';

    const manifestCache = new Map();
    const fileCache = new Map();

    const normalizePath = (path) => {
        if (!path) {
            return '';
        }
        if (/^https?:\/\//i.test(path)) {
            return path;
        }
        if (path.startsWith('./') || path.startsWith('../')) {
            return path;
        }
        if (path.startsWith('/')) {
            return `.${path}`;
        }
        return `./${path}`;
    };

    const fetchText = async (path) => {
        const normalized = normalizePath(path);
        if (fileCache.has(normalized)) {
            return fileCache.get(normalized);
        }
        const promise = fetch(normalized)
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`applicationModule: failed to load ${normalized} (${response.status})`);
                }
                return response.text();
            });
        fileCache.set(normalized, promise);
        return promise;
    };

    const buildResourcePath = (baseDir, fileName) => {
        if (!fileName) {
            return '';
        }
        if (/^https?:\/\//i.test(fileName)) {
            return fileName;
        }
        if (fileName.startsWith('./') || fileName.startsWith('../') || fileName.startsWith('/')) {
            return fileName;
        }
        const normalizedBase = (baseDir || componentsDirPath).replace(/\/+$/, '');
        return `${normalizedBase}/${fileName}`;
    };

    return {
        async getApplicationManifest(_spaceId, applicationId) {
            if (!manifestCache.has(applicationId)) {
                manifestCache.set(applicationId, {
                    id: applicationId,
                    applicationId,
                    entryPoint: defaultEntryPoint,
                    componentsDirPath,
                    components: componentsConfig,
                    systemApp: false
                });
            }
            return manifestCache.get(applicationId);
        },
        async getApplicationComponent(_spaceId, applicationId, appComponentsDirPath, component) {
            const baseDir = (appComponentsDirPath || componentsDirPath).replace(/\/+$/, '');
            const componentDir = `${component.name}/${component.name}`;

            const htmlPath = buildResourcePath(baseDir, `${componentDir}.html`);
            const cssPath = buildResourcePath(baseDir, `${componentDir}.css`);
            const presenterPath = component.presenterClassName ? buildResourcePath(baseDir, `${componentDir}.js`) : null;

            const [loadedTemplate, cssContent, presenterModule] = await Promise.all([
                fetchText(htmlPath),
                fetchText(cssPath),
                presenterPath ? fetchText(presenterPath) : Promise.resolve('')
            ]);

            return {
                loadedTemplate,
                loadedCSSs: [cssContent],
                presenterModule
            };
        },
        async getApplicationFile(_spaceId, _applicationId, filePath) {
            return fetchText(filePath);
        }
    };
};

const buildLlmModule = () => ({
    async lipsync() {
        console.warn('[assistOS] lipsync is not supported in the local shim.');
        return null;
    }
});

const createAssistOS = (options = {}) => {
    const { ui: providedUI, modules: moduleOverrides } = options;
    const ui = providedUI ?? buildUIHelpers();
    const spaceState = {
        id: 'local-space',
        plugins: JSON.parse(JSON.stringify(defaultPlugins)),
        currentChapterId: null,
        currentParagraphId: null,
        loadingDocuments: []
    };

    const modules = new Map([
        ['document', documentModule],
        ['agent', buildAgentModule()],
        ['space', buildSpaceModule(spaceState)],
        ['gallery', buildGalleryModule()],
        ['util', buildUtilModule()],
        ['application', buildApplicationModule(ui)],
        ['llm', buildLlmModule()]
    ]);

    if (moduleOverrides && typeof moduleOverrides === 'object') {
        for (const [name, module] of Object.entries(moduleOverrides)) {
            modules.set(name, module);
        }
    }

    const loadModule = (name) => {
        if (!modules.has(name)) {
            console.warn(`[assistOS] Module "${name}" is not implemented in the local shim.`);
            return {};
        }
        return modules.get(name);
    };

    return {
        loadModule,
        UI: ui,
        showToast: (...args) => {
            if (typeof ui.showToast === 'function') {
                return ui.showToast(...args);
            }
            const [message, type = 'info'] = args;
            console.log(`[${type}] ${message}`);
            return undefined;
        },
        space: spaceState,
        user: {
            email: DEFAULT_EMAIL
        },
        initialisedApplications: {},
        constants: {
            fontSizeMap: createFontMap(),
            fontFamilyMap: createFontFamilyMap(),
            textIndentMap: createTextIndentMap(),
            DOCUMENT_CATEGORIES: {
                GENERAL: 'general',
                BUSINESS: 'business',
                TECHNICAL: 'technical',
                OTHER: 'other'
            }
        },
        NotificationRouter: buildNotificationRouter(),
        loadifyComponent: async (_element, callback) => {
            if (typeof callback === 'function') {
                return callback();
            }
            return undefined;
        }
    };
};

export const initialiseAssistOS = (options = {}) => {
    const assistOS = createAssistOS(options);
    if (typeof window !== 'undefined') {
        window.assistOS = assistOS;
        window.AssistOS = assistOS;
    }
    return assistOS;
};

export default initialiseAssistOS;
