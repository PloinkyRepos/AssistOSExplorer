const DEFAULTS = Object.freeze({
    theme: 'light',
    headerText: 'WebAssist Assistant',
    subtitleText: 'Embedded preview',
    themes: Object.freeze({
        light: Object.freeze({
            chatBackground: '#f2f7ff',
            userBubble: '#1e293b',
            agentBubble: '#f8fbff',
            headerColor: '#0f172a'
        }),
        dark: Object.freeze({
            chatBackground: '#0f172a',
            userBubble: '#334155',
            agentBubble: '#1f2937',
            headerColor: '#111827'
        }),
        aqua: Object.freeze({
            chatBackground: '#e6f7fb',
            userBubble: '#0b4f6c',
            agentBubble: '#d3edf5',
            headerColor: '#0f3d53'
        }),
        forest: Object.freeze({
            chatBackground: '#0f1f17',
            userBubble: '#1f4d3a',
            agentBubble: '#1a2f24',
            headerColor: '#102419'
        }),
        amethyst: Object.freeze({
            chatBackground: '#f4eeff',
            userBubble: '#5b3f8c',
            agentBubble: '#ece2ff',
            headerColor: '#3e2a66'
        })
    })
});

function normalizeString(value, fallback = '') {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeHex(value, fallback) {
    const normalized = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toLowerCase() : fallback;
}

function buildThemeDefaults(theme) {
    const normalizedTheme = Object.prototype.hasOwnProperty.call(DEFAULTS.themes, theme) ? theme : DEFAULTS.theme;
    const palette = DEFAULTS.themes[normalizedTheme];
    return {
        chatBackground: palette.chatBackground,
        userBubble: palette.userBubble,
        agentBubble: palette.agentBubble,
        headerColor: palette.headerColor
    };
}

function normalizeTheme(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(DEFAULTS.themes, normalized) ? normalized : DEFAULTS.theme;
}

function toQuery(params) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null) {
            return;
        }
        const text = String(value);
        if (!text) {
            return;
        }
        query.set(key, text);
    });
    return query.toString();
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function buildIframeCode(src) {
    const safeSrc = escapeAttribute(src);
    return `<iframe src="${safeSrc}" title="WebAssist Chat" loading="lazy" style="width:100%;max-width:420px;height:640px;border:0;border-radius:16px;overflow:hidden" allow="clipboard-write"></iframe>`;
}

export class WebassistSettingsSettings {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.props = element?.props || element?._componentProxy?.props || {};
        this.state = {
            theme: DEFAULTS.theme,
            headerText: DEFAULTS.headerText,
            subtitleText: DEFAULTS.subtitleText,
            chatBackground: buildThemeDefaults(DEFAULTS.theme).chatBackground,
            userBubble: buildThemeDefaults(DEFAULTS.theme).userBubble,
            agentBubble: buildThemeDefaults(DEFAULTS.theme).agentBubble,
            headerColor: buildThemeDefaults(DEFAULTS.theme).headerColor,
            status: '',
            statusType: ''
        };
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.cacheElements();
        this.bindEvents();
        this.syncInputsFromState();
        this.renderDerived();
    }

    cacheElements() {
        this.themeInput = this.element.querySelector('#webassistTheme');
        this.headerTextInput = this.element.querySelector('#webassistHeaderText');
        this.subtitleTextInput = this.element.querySelector('#webassistSubtitleText');
        this.chatBackgroundInput = this.element.querySelector('#webassistChatBackground');
        this.userBubbleInput = this.element.querySelector('#webassistUserBubble');
        this.agentBubbleInput = this.element.querySelector('#webassistAgentBubble');
        this.headerColorInput = this.element.querySelector('#webassistHeaderColor');
        this.previewButton = this.element.querySelector('#webassistPreviewButton');
        this.copyButton = this.element.querySelector('#webassistCopyButton');
        this.snippetArea = this.element.querySelector('#webassistIframeSnippet');
        this.statusElement = this.element.querySelector('#webassistSettingsStatus');
    }

    bindEvents() {
        if (this.element.dataset.webassistSettingsBound === 'true') {
            return;
        }
        this.element.dataset.webassistSettingsBound = 'true';

        this.themeInput?.addEventListener('change', (event) => {
            const nextTheme = normalizeTheme(event.target?.value);
            this.state.theme = nextTheme;
            const themeDefaults = buildThemeDefaults(nextTheme);
            this.state.chatBackground = themeDefaults.chatBackground;
            this.state.userBubble = themeDefaults.userBubble;
            this.state.agentBubble = themeDefaults.agentBubble;
            this.state.headerColor = themeDefaults.headerColor;
            this.syncInputsFromState();
            this.clearStatus();
            this.renderDerived();
        });

        this.headerTextInput?.addEventListener('input', (event) => {
            this.state.headerText = String(event.target?.value || '');
            this.clearStatus();
            this.renderDerived();
        });

        this.subtitleTextInput?.addEventListener('input', (event) => {
            this.state.subtitleText = String(event.target?.value || '');
            this.clearStatus();
            this.renderDerived();
        });

        this.chatBackgroundInput?.addEventListener('input', (event) => {
            this.state.chatBackground = normalizeHex(event.target?.value, this.state.chatBackground);
            this.clearStatus();
            this.renderDerived();
        });

        this.userBubbleInput?.addEventListener('input', (event) => {
            this.state.userBubble = normalizeHex(event.target?.value, this.state.userBubble);
            this.clearStatus();
            this.renderDerived();
        });

        this.agentBubbleInput?.addEventListener('input', (event) => {
            this.state.agentBubble = normalizeHex(event.target?.value, this.state.agentBubble);
            this.clearStatus();
            this.renderDerived();
        });

        this.headerColorInput?.addEventListener('input', (event) => {
            this.state.headerColor = normalizeHex(event.target?.value, this.state.headerColor);
            this.clearStatus();
            this.renderDerived();
        });
    }

    syncInputsFromState() {
        if (this.themeInput) {
            this.themeInput.value = this.state.theme;
        }
        if (this.headerTextInput) {
            this.headerTextInput.value = this.state.headerText;
        }
        if (this.subtitleTextInput) {
            this.subtitleTextInput.value = this.state.subtitleText;
        }
        if (this.chatBackgroundInput) {
            this.chatBackgroundInput.value = this.state.chatBackground;
        }
        if (this.userBubbleInput) {
            this.userBubbleInput.value = this.state.userBubble;
        }
        if (this.agentBubbleInput) {
            this.agentBubbleInput.value = this.state.agentBubble;
        }
        if (this.headerColorInput) {
            this.headerColorInput.value = this.state.headerColor;
        }
    }

    getOrigin() {
        return typeof window !== 'undefined' ? window.location.origin : '';
    }

    buildEmbedUrl() {
        const baseUrl = this.getOrigin();
        if (!baseUrl) {
            return '';
        }

        const params = {
            theme: this.state.theme,
            headerText: normalizeString(this.state.headerText, DEFAULTS.headerText),
            subtitleText: normalizeString(this.state.subtitleText, DEFAULTS.subtitleText),
            chatBackground: normalizeHex(this.state.chatBackground, buildThemeDefaults(this.state.theme).chatBackground),
            userBubble: normalizeHex(this.state.userBubble, buildThemeDefaults(this.state.theme).userBubble),
            agentBubble: normalizeHex(this.state.agentBubble, buildThemeDefaults(this.state.theme).agentBubble),
            headerColor: normalizeHex(this.state.headerColor, buildThemeDefaults(this.state.theme).headerColor),
        };

        const query = toQuery(params);
        return `${baseUrl}/webAssist/IDE-plugins/web-assist-chat/web-assist-chat.html?${query}`;
    }

    renderDerived() {
        const validBaseUrl = Boolean(this.getOrigin());
        if (this.previewButton) {
            this.previewButton.disabled = !validBaseUrl;
        }
        if (this.copyButton) {
            this.copyButton.disabled = !validBaseUrl;
        }

        const embedUrl = this.buildEmbedUrl();
        if (this.snippetArea) {
            this.snippetArea.value = embedUrl ? buildIframeCode(embedUrl) : '';
        }

        this.renderStatus();
    }

    renderStatus() {
        if (!this.statusElement) {
            return;
        }
        this.statusElement.textContent = this.state.status || '';
        this.statusElement.classList.toggle('error', this.state.statusType === 'error');
    }

    clearStatus() {
        this.state.status = '';
        this.state.statusType = '';
    }

    openAdminWebchat() {
        const baseUrl = this.getOrigin();
        if (!baseUrl) {
            this.state.status = 'Unable to determine browser origin.';
            this.state.statusType = 'error';
            this.renderStatus();
            return;
        }
        window.open(`${baseUrl}/webchat?agent=webAdmin`, '_blank', 'noopener');
        this.state.status = 'Admin webchat opened in a new tab.';
        this.state.statusType = '';
        this.renderStatus();
    }

    async openPreviewChat() {
        try {
            const embedUrl = this.buildEmbedUrl();
            if (!embedUrl) {
                this.state.status = 'Unable to determine browser origin.';
                this.state.statusType = 'error';
                this.renderStatus();
                return;
            }
            window.open(embedUrl, '_blank', 'noopener');
            this.state.status = 'Preview opened in a new tab.';
            this.state.statusType = '';
            this.renderStatus();
        } catch (error) {
            this.state.status = error?.message || 'Failed to open preview.';
            this.state.statusType = 'error';
            this.renderStatus();
        }
    }

    async copyIframeCode() {
        try {
            const embedUrl = this.buildEmbedUrl();
            if (!embedUrl) {
                this.state.status = 'Unable to determine browser origin.';
                this.state.statusType = 'error';
                this.renderStatus();
                return;
            }
            const snippet = buildIframeCode(embedUrl);
            if (this.snippetArea) {
                this.snippetArea.value = snippet;
            }
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(snippet);
            } else {
                this.snippetArea?.focus();
                this.snippetArea?.select();
                document.execCommand('copy');
            }
            this.state.status = 'Iframe code copied to clipboard.';
            this.state.statusType = '';
            this.renderStatus();
        } catch {
            this.state.status = 'Failed to copy. Select snippet and copy manually.';
            this.state.statusType = 'error';
            this.renderStatus();
        }
    }

    closeModal() {
        assistOS.UI.closeModal(this.element, null);
    }
}

export class WebassistSettings {
    constructor(...args) {
        return new WebassistSettingsSettings(...args);
    }
}
