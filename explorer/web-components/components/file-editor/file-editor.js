import { highlightCode } from "../../../utils/highlight.js";
import { withGlobalLoader } from "../../../utils/globalLoader.js";
import { getKeymap, matchesShortcut } from "../../../utils/keymap.js";
import { requestLlmAutocomplete } from "../../../services/llmAutocompleteService.js";
import { callExplorerTool } from "../../../services/infrastructure/explorerApi.js";
import { EXPLORER_THEME_CHANGE_EVENT, getCurrentTheme } from "../../../utils/theme.js";
import { HTML_PREVIEW_LIVE_UPDATE_EVENT, normalizePreviewSourcePath } from "../../../utils/htmlPreviewLive.js";
import { isDpuVirtualPath } from "../../pages/file-exp/file-exp-dpu-provider.js";

export class FileEditor {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.path = this.element.dataset.path;
        const extension = (this.path.split('.').pop() || '').toLowerCase();
        this.state = {
            editorContent: "Loading...",
            fileType: extension || "js"
        };
        this.autocompleteInFlight = false;
        this.invalidate();
        this.boundAdjustForScrollbar = this.adjustForScrollbar.bind(this);
        this.boundThemeChange = this.handleThemeChange.bind(this);
    }

    getFileExpPresenter() {
        return this.element.closest('file-exp')?.webSkelPresenter || null;
    }

    beforeUnload() {
        window.removeEventListener('resize', this.boundAdjustForScrollbar);
        window.removeEventListener(EXPLORER_THEME_CHANGE_EVENT, this.boundThemeChange);
    }

    async beforeRender() {
        if (this.state.editorContent === "Loading...") {
            try {
                if (isDpuVirtualPath(this.path)) {
                    const fileExp = this.element.closest('file-exp')?.webSkelPresenter || null;
                    this.state.editorContent = String(fileExp?.state?.fileContent ?? '');
                } else {
                    const content = await callExplorerTool('read_text_file', { path: this.path });
                    this.state.editorContent = String(content ?? '');
                }
                this.invalidate();
            } catch (e) {
                console.error(e);
                this.state.editorContent = "Error loading file.";
                this.invalidate();
            }
        }
    }

    afterRender() {
        this.applyTheme();
        this.textarea = this.element.querySelector('.code-input');
        this.codeBlock = this.element.querySelector('.code-output code');
        this.lineNumbers = this.element.querySelector('.line-numbers');

        this.syncHighlight = this.syncHighlight.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);

        if (this.textarea) {
            this.textarea.value = this.state.editorContent;
            this.codeBlock.innerHTML = this.highlight(this.state.editorContent, this.state.fileType);
            this.codeBlock.className = `language-${this.state.fileType}`;
            this.updateLineNumbers();

            this.textarea.addEventListener('input', this.syncHighlight);
            this.textarea.addEventListener('scroll', () => this.syncScroll(this.textarea, this.codeBlock.parentElement, this.lineNumbers));
            this.textarea.addEventListener('keydown', this.handleKeyDown);
            window.addEventListener('resize', this.boundAdjustForScrollbar);

            this.syncScroll(this.textarea, this.codeBlock.parentElement, this.lineNumbers);
            this.adjustForScrollbar();
        }
        window.removeEventListener(EXPLORER_THEME_CHANGE_EVENT, this.boundThemeChange);
        window.addEventListener(EXPLORER_THEME_CHANGE_EVENT, this.boundThemeChange);
    }

    handleThemeChange() {
        this.applyTheme();
    }

    applyTheme() {
        const container = this.element.querySelector(".file-editor-container");
        if (!container) return;
        container.setAttribute("data-theme", getCurrentTheme());
    }

    handleKeyDown(e) {
        const keymap = getKeymap();
        if (keymap.llmAutocomplete && matchesShortcut(e, keymap.llmAutocomplete)) {
            e.preventDefault();
            this.requestAutocomplete();
            return;
        }
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = this.textarea.selectionStart;
            const end = this.textarea.selectionEnd;
            this.textarea.value = this.textarea.value.substring(0, start) + '  ' + this.textarea.value.substring(end);
            this.textarea.selectionStart = this.textarea.selectionEnd = start + 2;
            this.syncHighlight();
        }
    }

    async requestAutocomplete() {
        if (this.autocompleteInFlight || !this.textarea) return;
        const start = this.textarea.selectionStart ?? 0;
        const end = this.textarea.selectionEnd ?? start;
        const content = this.textarea.value ?? '';
        this.autocompleteInFlight = true;
        try {
            const completion = await withGlobalLoader(() => requestLlmAutocomplete({
                path: this.path,
                content,
                cursorOffset: start,
                language: this.state.fileType || ''
            }));
            const insert = String(completion || '');
            if (!insert.trim()) {
                throw new Error('Empty autocomplete response.');
            }
            this.textarea.value = content.slice(0, start) + insert + content.slice(end);
            const nextCursor = start + insert.length;
            this.textarea.selectionStart = nextCursor;
            this.textarea.selectionEnd = nextCursor;
            this.textarea.dispatchEvent(new Event('input', { bubbles: true }));
            this.syncHighlight();
        } catch (error) {
            console.error('Autocomplete failed', error);
            if (typeof assistOS?.showToast === 'function') {
                assistOS.showToast('Autocomplete failed. Please try again.', 'error', 3000);
            }
        } finally {
            this.autocompleteInFlight = false;
        }
    }

    syncHighlight() {
        if (!this.textarea || !this.codeBlock) return;
        const code = this.textarea.value;
        this.state.editorContent = code;
        this.codeBlock.innerHTML = this.highlight(code, this.state.fileType);
        this.updateLineNumbers();
        this.syncScroll(this.textarea, this.codeBlock.parentElement, this.lineNumbers);
        this.adjustForScrollbar();
        const fileExp = this.getFileExpPresenter();
        if (fileExp && typeof fileExp.setHasUnsavedChanges === 'function') {
            fileExp.setHasUnsavedChanges(code !== String(fileExp.state?.fileContent ?? ''));
            fileExp.handleEditorBufferChange?.();
        }
        this.emitHtmlPreviewLiveUpdate(code);
    }

    highlight(text, type) {
        return highlightCode(text, type);
    }

    updateLineNumbers() {
        if (!this.textarea || !this.lineNumbers) return;
        const lineCount = this.textarea.value.split('\n').length;
        this.lineNumbers.innerHTML = Array.from({length: lineCount}, (_, i) => `<span>${i + 1}</span>`).join('');
    }

    syncScroll(source, ...targets) {
        if (!source) return;
        for (const target of targets) {
            if (target) {
                target.scrollTop = source.scrollTop;
                target.scrollLeft = source.scrollLeft;
            }
        }
    }

    adjustForScrollbar() {
        if (!this.textarea || !this.lineNumbers) return;
        const scrollbarHeight = this.textarea.offsetHeight - this.textarea.clientHeight;
        const newPadding = 40 + scrollbarHeight;
        this.lineNumbers.style.paddingBottom = `${newPadding}px`;
        this.codeBlock.parentElement.style.paddingBottom = `${newPadding}px`;
    }

    getCode() {
        return this.state.editorContent;
    }

    emitHtmlPreviewLiveUpdate(content) {
        const fileType = String(this.state.fileType || '').toLowerCase();
        if (fileType !== 'html' && fileType !== 'htm') {
            return;
        }
        window.dispatchEvent(new CustomEvent(HTML_PREVIEW_LIVE_UPDATE_EVENT, {
            detail: {
                path: normalizePreviewSourcePath(this.path),
                content: String(content ?? '')
            }
        }));
    }

}
