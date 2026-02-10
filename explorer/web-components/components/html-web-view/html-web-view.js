import { HTML_PREVIEW_LIVE_UPDATE_EVENT, normalizePreviewSourcePath } from "../../../utils/htmlPreviewLive.js";

export class HtmlWebView {
    constructor(element, invalidate, props = {}) {
        this.element = element;
        this.invalidate = invalidate;
        this.props = props || {};
        this.url = this.resolveUrl();
        this.reloadToken = this.resolveReloadToken();
        this.liveSourceSelector = this.resolveLiveSourceSelector();
        this.sourcePath = this.resolveSourcePath();
        this.liveUpdateTimer = null;
        this.pendingLiveContent = '';
        this.boundLivePreviewUpdate = this.handleLivePreviewUpdate.bind(this);
        this.invalidate();
    }

    beforeRender() {
        this.url = this.resolveUrl();
        this.reloadToken = this.resolveReloadToken();
        this.liveSourceSelector = this.resolveLiveSourceSelector();
        this.sourcePath = this.resolveSourcePath();
    }

    afterRender() {
        this.frame = this.element.querySelector('#htmlWebViewFrame');
        this.errorEl = this.element.querySelector('#htmlWebViewError');
        this.applyFrameSecurityPolicy();
        window.removeEventListener(HTML_PREVIEW_LIVE_UPDATE_EVENT, this.boundLivePreviewUpdate);
        window.addEventListener(HTML_PREVIEW_LIVE_UPDATE_EVENT, this.boundLivePreviewUpdate);
        this.loadFrame();
    }

    beforeUnload() {
        window.removeEventListener(HTML_PREVIEW_LIVE_UPDATE_EVENT, this.boundLivePreviewUpdate);
        if (this.liveUpdateTimer) {
            window.clearTimeout(this.liveUpdateTimer);
            this.liveUpdateTimer = null;
        }
    }

    applyFrameSecurityPolicy() {
        if (!this.frame) return;
        // Keep workspace HTML isolated from the app context.
        this.frame.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms allow-modals allow-popups allow-downloads');
        this.frame.setAttribute('referrerpolicy', 'no-referrer');
    }

    resolveUrl() {
        const fromProps = this.props?.url;
        const fromDataset = this.element?.dataset?.url;
        return String(fromProps || fromDataset || '').trim();
    }

    resolveReloadToken() {
        const fromProps = this.props?.reloadToken;
        const fromDataset = this.element?.dataset?.reloadToken;
        const parsed = Number.parseInt(fromProps ?? fromDataset ?? '0', 10);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    resolveLiveSourceSelector() {
        const fromProps = this.props?.liveSourceSelector;
        const fromDataset = this.element?.dataset?.liveSourceSelector;
        return String(fromProps || fromDataset || '').trim();
    }

    resolveSourcePath() {
        const fromProps = this.props?.sourcePath;
        const fromDataset = this.element?.dataset?.sourcePath;
        return normalizePreviewSourcePath(fromProps || fromDataset || '');
    }

    matchesSourcePath(candidatePath) {
        const normalizedCandidate = normalizePreviewSourcePath(candidatePath);
        return Boolean(this.sourcePath && normalizedCandidate && this.sourcePath === normalizedCandidate);
    }

    handleLivePreviewUpdate(event) {
        const detail = event?.detail || {};
        if (!this.matchesSourcePath(detail.path)) {
            return;
        }
        this.pendingLiveContent = String(detail.content ?? '');
        if (this.liveUpdateTimer) {
            window.clearTimeout(this.liveUpdateTimer);
        }
        this.liveUpdateTimer = window.setTimeout(() => {
            this.liveUpdateTimer = null;
            this.loadFrame({ preferLiveSource: true, liveContent: this.pendingLiveContent });
        }, 120);
    }

    getLiveSourceContent() {
        if (!this.liveSourceSelector) return '';
        const scope = this.element?.closest('.preview-content') || document;
        const source = scope.querySelector(this.liveSourceSelector);
        if (!source || typeof source.value !== 'string') {
            return '';
        }
        return source.value;
    }

    resolveBaseHref() {
        try {
            const target = new URL(this.url, window.location.origin);
            target.hash = '';
            target.search = '';
            const cleanPath = target.pathname || '/';
            target.pathname = cleanPath.endsWith('/') ? cleanPath : cleanPath.replace(/[^/]*$/, '');
            return target.toString();
        } catch (_) {
            return window.location.origin + '/';
        }
    }

    buildInlineDocument(content) {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(String(content || ''), 'text/html');
            const baseHref = this.resolveBaseHref();
            let baseEl = doc.querySelector('base');
            if (!baseEl) {
                baseEl = doc.createElement('base');
                doc.head.prepend(baseEl);
            }
            baseEl.setAttribute('href', baseHref);
            return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
        } catch (_) {
            return String(content || '');
        }
    }

    buildUrlWithToken() {
        if (!this.url) return '';
        try {
            const target = new URL(this.url, window.location.origin);
            target.searchParams.set('__previewReload', String(this.reloadToken));
            return target.toString();
        } catch (_) {
            return this.url;
        }
    }

    loadFrame(options = {}) {
        const { preferLiveSource = false, liveContent } = options;
        if (!this.frame) return;
        if (!this.url) {
            this.showError();
            return;
        }

        this.hideError();
        if (preferLiveSource) {
            const hasProvidedLiveContent = typeof liveContent === 'string';
            const inlineContent = hasProvidedLiveContent ? liveContent : this.getLiveSourceContent();
            if (hasProvidedLiveContent || inlineContent) {
                const inlineDoc = this.buildInlineDocument(inlineContent);
                let loadedInline = false;
                this.frame.onload = () => {
                    loadedInline = true;
                    this.hideError();
                };
                this.frame.removeAttribute('src');
                this.frame.srcdoc = inlineDoc;
                window.setTimeout(() => {
                    if (!loadedInline) {
                        this.showError();
                    }
                }, 3000);
                return;
            }
        }

        const frameUrl = this.buildUrlWithToken();
        const expected = frameUrl;
        let loaded = false;

        this.frame.onload = () => {
            loaded = true;
            this.hideError();
        };

        this.frame.removeAttribute('srcdoc');
        this.frame.src = frameUrl;

        window.setTimeout(() => {
            if (!loaded && this.frame?.src === expected) {
                this.showError();
            }
        }, 3000);
    }

    refreshIframe() {
        this.reloadToken += 1;
        this.loadFrame({ preferLiveSource: true });
    }

    openInNewTab() {
        if (!this.url) return;
        window.open(this.url, '_blank', 'noopener,noreferrer');
    }

    showError() {
        if (this.errorEl) {
            this.errorEl.classList.remove('hidden');
        }
    }

    hideError() {
        if (this.errorEl) {
            this.errorEl.classList.add('hidden');
        }
    }
}
