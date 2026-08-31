const DEFAULT_CONFIG = Object.freeze({
    agentId: 'profile:current-user',
    sourceMode: 'generated',
    generated: true,
    src: '',
    packSrc: '',
    assetMode: 'img',
    emotion: 'neutral',
    expressionMode: 'audio',
    size: '72',
    thought: '',
    thoughtMode: 'none',
    mode: 'static',
    shape: 'circle',
    theme: 'auto',
    animated: true,
    listen: false,
    seed: 'profile:current-user',
    style: 'robot-soft',
    palette: 'default',
    complexity: ''
});

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

export function normalizeAvatarConfig(config, fallbackId = 'profile:current-user') {
    const source = config && typeof config === 'object' ? config : {};
    const requestedSourceMode = ['generated', 'pack', 'svg'].includes(String(source.sourceMode || source['source-mode'] || '').trim())
        ? String(source.sourceMode || source['source-mode']).trim()
        : '';
    const normalized = {
        ...DEFAULT_CONFIG,
        ...source,
        agentId: String(source.agentId || fallbackId),
        seed: String(source.seed || source.agentId || fallbackId)
    };
    normalized.src = String(normalized.src || '').trim();
    normalized.packSrc = String(normalized.packSrc || '').trim();
    normalized.expressionMode = String(normalized.expressionMode || '').trim() === 'manual' ? 'manual' : 'audio';
    if (normalized.src) {
        normalized.sourceMode = 'svg';
        normalized.generated = false;
        normalized.packSrc = '';
    } else if (normalized.packSrc) {
        normalized.sourceMode = 'pack';
        normalized.generated = false;
        normalized.src = '';
    } else {
        normalized.sourceMode = requestedSourceMode || (normalized.generated === false ? 'pack' : 'generated');
        normalized.generated = normalized.generated !== false;
    }
    if (normalized.sourceMode === 'generated') {
        normalized.generated = true;
    }
    return normalized;
}

export function getFallbackLetter(value) {
    const text = String(value || '').trim();
    if (!text) return '?';
    return (text.match(/[a-zA-Z0-9]/)?.[0] || text[0] || '?').toUpperCase();
}

function toAxiFaceAttributes(config) {
    const normalized = normalizeAvatarConfig(config);
    const attrs = [];
    const add = (name, value) => {
        const raw = String(value ?? '').trim();
        if (raw) attrs.push(`${name}="${escapeHtml(raw)}"`);
    };
    add('agent-id', normalized.agentId);
    add('emotion', normalized.emotion);
    add('size', normalized.size);
    add('thought', normalized.thought);
    add('thought-mode', normalized.thoughtMode);
    add('mode', normalized.mode);
    add('shape', normalized.shape);
    add('theme', normalized.theme);
    add('asset-mode', normalized.assetMode);
    add('seed', normalized.seed);
    add('data-axi-style', normalized.style);
    add('palette', normalized.palette);
    add('complexity', normalized.complexity);
    add('src', normalized.src);
    add('pack-src', normalized.packSrc);
    if (normalized.generated) attrs.push('generated');
    if (normalized.animated) attrs.push('animated');
    if (normalized.listen) attrs.push('listen');
    return attrs.join(' ');
}

export function renderAxiFaceMarkup(config) {
    return `<axi-face ${toAxiFaceAttributes(config)}></axi-face>`;
}
