import { highlightCode } from "../../../utils/highlight.js";
import { withGlobalLoader } from "../../../utils/globalLoader.js";

export class FileEditor {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.path = this.element.dataset.path;
        const extension = (this.path.split('.').pop() || '').toLowerCase();
        const root = document.documentElement;
        this.state = {
            editorContent: "Loading...",
            fileType: extension || "js",
            theme: root.classList.contains("theme-dark") ? "dark" : "light"
        };
        this.invalidate();
        this.boundAdjustForScrollbar = this.adjustForScrollbar.bind(this);
    }

    beforeUnload() {
        window.removeEventListener('resize', this.boundAdjustForScrollbar);
    }

    toggleTheme() {
        this.state.theme = this.state.theme === "dark" ? "light" : "dark";
        this.applyTheme();
    }

    applyTheme() {
        this.element.querySelector(".file-editor-container").setAttribute("data-theme", this.state.theme);
    }

    async beforeRender() {
        if (this.state.editorContent === "Loading...") {
            try {
                const contentResult = await withGlobalLoader(() => window.webSkel.appServices.callTool('explorer', 'read_text_file', {path: this.path}));
                if (contentResult.text.startsWith('Error:')) {
                    this.state.editorContent = `Error loading file: ${contentResult.text}`
                } else {
                    this.state.editorContent = contentResult.text;
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
    }

    handleKeyDown(e) {
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = this.textarea.selectionStart;
            const end = this.textarea.selectionEnd;
            this.textarea.value = this.textarea.value.substring(0, start) + '  ' + this.textarea.value.substring(end);
            this.textarea.selectionStart = this.textarea.selectionEnd = start + 2;
            this.syncHighlight();
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

}
