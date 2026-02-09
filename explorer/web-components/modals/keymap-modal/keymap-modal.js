import {
    getKeymap,
    setKeymap,
    getDefaultKeymap,
    getKeymapActions,
    eventToShortcut,
    formatShortcutForDisplay,
    normalizeShortcutString
} from "../../../utils/keymap.js";

export class KeymapModal {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.props = element?.props || element?._componentProxy?.props || {};
        this.state = {
            keymap: { ...(this.props.keymap || getKeymap()) },
            hasConflicts: false
        };
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.cacheElements();
        this.renderRows();
        this.bindEvents();
    }

    cacheElements() {
        this.listEl = this.element.querySelector('#keymapList');
        this.warningEl = this.element.querySelector('#keymapWarning');
        this.saveButton = this.element.querySelector('[data-local-action="saveKeymap"]');
    }

    renderRows() {
        if (!this.listEl) return;
        const actions = getKeymapActions();
        this.listEl.innerHTML = actions.map((action) => {
            const shortcut = this.state.keymap[action.id] || '';
            const displayValue = formatShortcutForDisplay(shortcut) || '';
            return `
                <div class="keymap-row">
                    <div class="keymap-info">
                        <div class="keymap-label">${action.label}</div>
                        <div class="keymap-meta">${action.description}</div>
                    </div>
                    <div class="keymap-input-group">
                        <input type="text" class="form-input keymap-input" data-action-id="${action.id}" value="${displayValue}" readonly>
                        <button type="button" class="gray-button keymap-clear" data-action-id="${action.id}">Clear</button>
                    </div>
                </div>
            `;
        }).join('');
        this.bindRowEvents();
        this.updateConflicts();
    }

    bindEvents() {
        if (!this.element.dataset.boundKeymapModal) {
            this.element.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    this.closeModal();
                }
            });
            this.element.dataset.boundKeymapModal = 'true';
        }
    }

    bindRowEvents() {
        const inputs = this.element.querySelectorAll('.keymap-input');
        inputs.forEach((input) => {
            if (input.dataset.bound) return;
            input.addEventListener('keydown', (event) => {
                const actionId = event.currentTarget?.dataset?.actionId;
                if (!actionId) return;
                if (event.key === 'Tab') return;
                event.preventDefault();
                event.stopPropagation();
                if (event.key === 'Escape') {
                    event.currentTarget.blur();
                    return;
                }
                if (event.key === 'Backspace' || event.key === 'Delete') {
                    this.setShortcut(actionId, '');
                    return;
                }
                const shortcut = eventToShortcut(event);
                if (!shortcut) return;
                this.setShortcut(actionId, shortcut);
            });
            input.dataset.bound = 'true';
        });

        const clearButtons = this.element.querySelectorAll('.keymap-clear');
        clearButtons.forEach((button) => {
            if (button.dataset.bound) return;
            button.addEventListener('click', (event) => {
                const actionId = event.currentTarget?.dataset?.actionId;
                if (!actionId) return;
                this.setShortcut(actionId, '');
            });
            button.dataset.bound = 'true';
        });
    }

    setShortcut(actionId, shortcut) {
        const normalized = shortcut ? normalizeShortcutString(shortcut) : '';
        this.state.keymap[actionId] = normalized;
        this.updateRowDisplay(actionId);
        this.updateConflicts();
    }

    updateRowDisplay(actionId) {
        const input = this.element.querySelector(`.keymap-input[data-action-id="${actionId}"]`);
        if (!input) return;
        const raw = this.state.keymap[actionId] || '';
        input.value = formatShortcutForDisplay(raw) || '';
    }

    updateConflicts() {
        const actions = getKeymapActions();
        const buckets = new Map();
        actions.forEach((action) => {
            const raw = this.state.keymap[action.id];
            const normalized = normalizeShortcutString(raw);
            if (!normalized) return;
            if (!buckets.has(normalized)) {
                buckets.set(normalized, []);
            }
            buckets.get(normalized).push(action.label);
        });

        const conflicts = [];
        for (const [shortcut, labels] of buckets.entries()) {
            if (labels.length > 1) {
                conflicts.push(`${formatShortcutForDisplay(shortcut)}: ${labels.join(', ')}`);
            }
        }

        this.state.hasConflicts = conflicts.length > 0;
        if (this.warningEl) {
            this.warningEl.textContent = conflicts.length
                ? `Shortcut conflicts: ${conflicts.join(' | ')}`
                : '';
        }
        if (this.saveButton) {
            this.saveButton.disabled = this.state.hasConflicts;
        }
    }

    resetDefaults() {
        this.state.keymap = { ...getDefaultKeymap() };
        this.renderRows();
    }

    saveKeymap() {
        if (this.state.hasConflicts) return;
        setKeymap(this.state.keymap);
        this.closeModal({ keymap: this.state.keymap });
    }

    closeModal(payload) {
        assistOS.UI.closeModal(this.element, payload);
    }
}
