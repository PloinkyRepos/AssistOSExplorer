export class FileEditor {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.title = this.element.dataset.title;
        this.content = this.element.dataset.content;

        const extension = this.title.split('.').pop();
        this.state = {
            editorContent: this.content || "",
            fileType: extension || "js"
        };
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.textarea = this.element.querySelector('.code-input');
        this.codeBlock = this.element.querySelector('.code-output code');

        this.syncHighlight = this.syncHighlight.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);

        if (this.textarea) {
            this.textarea.value = this.state.editorContent;
            this.codeBlock.innerHTML = this.highlight(this.state.editorContent, this.state.fileType);
            this.codeBlock.className = `language-${this.state.fileType}`;

            this.textarea.addEventListener('input', this.syncHighlight);
            this.textarea.addEventListener('scroll', () => this.syncScroll(this.textarea, this.codeBlock.parentElement));
            this.textarea.addEventListener('keydown', this.handleKeyDown);

            this.syncScroll(this.textarea, this.codeBlock.parentElement);
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
        this.syncScroll(this.textarea, this.codeBlock.parentElement);
    }

    highlight(text, type) {
        if (!text) return '';

        const escapeHTML = str => str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        let result = escapeHTML(text);

        if (['js', 'mjs', 'json'].includes(type)) {
            result = this.highlightJavaScript(result);
        } else if (['html', 'htm'].includes(type)) {
            result = this.highlightHTML(result);
        } else if (type === 'css') {
            result = this.highlightCSS(result);
        }

        return result;
    }

    highlightJavaScript(code) {
        const parts = [];
        let lastIndex = 0;
        const regex = /([`"'])(?:\\.|(?!\1).)*?\1|(\/\*[\s\S]*?\*\/|\/\/.*)/g;

        code.replace(regex, (match, stringDelimiter, comment, offset) => {
            if (offset > lastIndex) {
                parts.push(code.substring(lastIndex, offset));
            }
            if (stringDelimiter) {
                parts.push(`<span class="string">${match}</span>`);
            } else {
                parts.push(`<span class="comment">${match}</span>`);
            }
            lastIndex = offset + match.length;
        });

        if (lastIndex < code.length) {
            parts.push(code.substring(lastIndex));
        }

        const keywords = [
            'const', 'let', 'var', 'function', 'export', 'class', 'constructor',
            'async', 'await', 'try', 'catch', 'if', 'else', 'return', 'new', 'this',
            'import', 'from', 'of', 'for', 'while', 'do', 'switch', 'case', 'break',
            'continue', 'delete', 'in', 'instanceof', 'typeof', 'void', 'with',
            'true', 'false', 'null', 'undefined', 'document', 'window', 'console', 'log'
        ];
        const keywordRegex = new RegExp(`\\b(${keywords.join('|')})\\b`, 'g');
        const numberRegex = /\b(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g;

        const finalParts = parts.map(part => {
            if (part.startsWith('<span')) {
                return part;
            }
            return part
                .replace(keywordRegex, '<span class="keyword">$1</span>')
                .replace(numberRegex, '<span class="number">$1</span>');
        });

        return finalParts.join('');
    }

    highlightHTML(code) {
        let result = code.replace(/&lt;!--[\s\S]*?--&gt;/g, match => `<span class="comment">${match}</span>`);
        result = result.replace(/&lt;!DOCTYPE[^>]+&gt;/g, match => `<span class="doctype">${match}</span>`);
        result = result.replace(/&lt;\/([a-zA-Z][a-zA-Z0-9-]*?)&gt;/g, `&lt;/<span class="tag">$1</span>&gt;`);
        result = result.replace(/&lt;([a-zA-Z][a-zA-Z0-9-]*)(.*?)&gt;/g, (match, tagName, attrs) => {
            let highlighted = `&lt;<span class="tag">${tagName}</span>`;
            if (attrs) {
                highlighted += attrs.replace(/(\s+)([a-zA-Z0-9-]+)(=)(&quot;)(.*?)(&quot;)/g, (attrMatch, space, attrName, equals, quoteStart, value, quoteEnd) =>
                    `${space}<span class="attribute">${attrName}</span>${equals}${quoteStart}<span class="attribute-value">${value}</span>${quoteEnd}`
                );
            }
            return highlighted + '&gt;';
        });
        return result;
    }

    highlightCSS(code) {
        let result = code.replace(/([\w-]+)(?=\s*\{)/g, match => `<span class="selector">${match}</span>`);
        result = result.replace(/([\w-]+)(?=\s*:)/g, match => `<span class="property">${match}</span>`);
        result = result.replace(/:\s*([^;\{\}!]+)(?=;|\s*\{|!important)/g, (match, value) => `: <span class="value">${value.trim()}</span>`);
        result = result.replace(/!important/g, match => `<span class="keyword">${match}</span>`);
        result = result.replace(/\/\*[\s\S]*?\*\//g, match => `<span class="comment">${match}</span>`);
        result = result.replace(/(\d+)(px|em|rem|%|s|ms|vh|vw|vmin|vmax|cm|mm|in|pt|pc|ex|ch|fr|deg|rad|grad|turn)/g, (match, num, unit) => `<span class="number">${num}</span><span class="unit">${unit}</span>`);
        result = result.replace(/(#([0-9a-fA-F]{3,6})|(rgb|hsl)a?\([^)]*\))/g, match => `<span class="string">${match}</span>`);
        return result;
    }

    syncScroll(source, target) {
        if(source && target){
            target.scrollTop = source.scrollTop;
            target.scrollLeft = source.scrollLeft;
        }
    }

    getCode() {
        return this.state.editorContent;
    }

}
