const escapeHTML = (str) => str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

export function highlightCode(text, type = '') {
    if (!text) return '';
    const normalizedType = (type || '').toLowerCase();
    const escaped = escapeHTML(text);

    if (['js', 'mjs', 'json'].includes(normalizedType)) {
        return highlightJavaScript(escaped);
    }
    if (['html', 'htm'].includes(normalizedType)) {
        return highlightHTML(escaped);
    }
    if (normalizedType === 'css') {
        return highlightCSS(escaped);
    }

    return escaped;
}

export function highlightJavaScript(code) {
    const parts = [];
    let lastIndex = 0;
    const regex = /([`"'])(?:\\.|(?!\1).)*?\1|(\/\*[\s\S]*?\*\/|\/\/.*)/g;

    code.replace(regex, (match, stringDelimiter, comment, offset) => {
        if (offset > lastIndex) {
            parts.push({ type: 'code', value: code.substring(lastIndex, offset) });
        }
        if (stringDelimiter) {
            parts.push({ type: 'string', value: match });
        } else if (comment) {
            parts.push({ type: 'comment', value: comment });
        }
        lastIndex = offset + match.length;
        return match;
    });

    if (lastIndex < code.length) {
        parts.push({ type: 'code', value: code.substring(lastIndex) });
    }

    const highlightKeywordsAndNumbers = (segment) => {
        let highlighted = segment;
        highlighted = highlighted.replace(/\b(const|let|var|function|return|if|else|for|while|class|new|this|async|await|try|catch|finally|import|export|default)\b/g, '<span class="keyword">$1</span>');
        highlighted = highlighted.replace(/\b(true|false|null|undefined)\b/g, '<span class="number">$1</span>');
        highlighted = highlighted.replace(/\b\d+(\.\d+)?\b/g, '<span class="number">$&</span>');
        return highlighted;
    };

    return parts.map(part => {
        if (part.type === 'string') {
            return `<span class="string">${part.value}</span>`;
        }
        if (part.type === 'comment') {
            return `<span class="comment">${part.value}</span>`;
        }
        return highlightKeywordsAndNumbers(part.value);
    }).join('');
}

export function highlightHTML(code) {
    let result = code;
    result = result.replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="comment">$1</span>');
    result = result.replace(/(&lt;\/?[a-zA-Z0-9-]+)([^&]*?)(\/?&gt;)/g, (match, tagStart, attrs, tagEnd) => {
        const highlightedAttrs = attrs.replace(/([a-zA-Z-:]+)=(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;)/g, '<span class="attribute">$1</span>=<span class="attribute-value">$2</span>');
        return `<span class="tag">${tagStart}</span>${highlightedAttrs}<span class="tag">${tagEnd}</span>`;
    });
    return result;
}

export function highlightCSS(code) {
    let result = code;
    result = result.replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="comment">$1</span>');
    result = result.replace(/([.#]?[a-zA-Z0-9_-]+\s*\{)/g, '<span class="selector">$1</span>');
    result = result.replace(/([a-z-]+)(\s*:\s*)([^;]+)(;?)/g, (match, prop, sep, value, end) => {
        const coloredValue = value
            .replace(/#[0-9a-fA-F]{3,6}\b/g, '<span class="color">$&</span>')
            .replace(/\b\d+(\.\d+)?(px|em|rem|%)\b/g, '<span class="unit">$&</span>');
        return `<span class="property">${prop}</span>${sep}<span class="value">${coloredValue}</span>${end}`;
    });
    return result;
}
