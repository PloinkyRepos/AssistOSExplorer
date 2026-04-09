import {
    getKeymap,
    setKeymap,
    getDefaultKeymap,
    getKeymapActions,
    eventToShortcut,
    formatShortcutForDisplay,
    normalizeShortcutString
} from "../../../utils/keymap.js";
import { getCurrentTheme, setTheme } from "../../../utils/theme.js";

export class SettingsModal {
    constructor(element, invalidate, props = {}) {
        this.element = element;
        this.invalidate = invalidate;
        this.props = props || {};
        const initialTab = ['keymap', 'editor', 'theme'].includes(this.props.tab) ? this.props.tab : 'keymap';
        this.state = {
            activeTab: initialTab,
            selectedTheme: this.props.theme === "dark" ? "dark" : getCurrentTheme(),
            keymap: { ...(this.props.keymap || getKeymap()) },
            editorAutoSaveEnabled: Boolean(this.props.editorAutoSaveEnabled),
            editorAutoSaveIntervalSeconds: Number.isFinite(this.props.editorAutoSaveIntervalSeconds)
                ? Math.max(1, Math.round(this.props.editorAutoSaveIntervalSeconds))
                : 10,
            hasConflicts: false
        };
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.cacheElements();
        this.updateTabUI();
        this.renderRows();
        this.updateThemeSelection();
        this.bindEvents();
    }

    cacheElements() {
        this.keymapSection = this.element.querySelector('[data-section="keymap"]');
        this.editorSection = this.element.querySelector('[data-section="editor"]');
        this.themeSection = this.element.querySelector('[data-section="theme"]');
        this.listEl = this.element.querySelector("#keymapList");
        this.warningEl = this.element.querySelector("#keymapWarning");
        this.editorAutoSaveEnabledInput = this.element.querySelector('#editorAutoSaveEnabled');
        this.editorAutoSaveIntervalInput = this.element.querySelector('#editorAutoSaveIntervalSeconds');
        this.saveButton = this.element.querySelector('[data-local-action="saveSettings"]');
        this.resetButton = this.element.querySelector('[data-role="reset-keymap"]');
    }

    bindEvents() {
        if (!this.element.dataset.boundSettingsModal) {
            this.element.addEventListener("keydown", (event) => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    this.closeModal();
                }
            });
            this.element.dataset.boundSettingsModal = "true";
        }
        if (this.editorAutoSaveEnabledInput && !this.editorAutoSaveEnabledInput.dataset.bound) {
            this.editorAutoSaveEnabledInput.addEventListener('change', () => this.handleEditorAutoSaveToggle());
            this.editorAutoSaveEnabledInput.dataset.bound = 'true';
        }
        if (this.editorAutoSaveIntervalInput && !this.editorAutoSaveIntervalInput.dataset.bound) {
            this.editorAutoSaveIntervalInput.addEventListener('input', () => this.handleEditorAutoSaveIntervalInput());
            this.editorAutoSaveIntervalInput.dataset.bound = 'true';
        }
    }

    switchTab(_target, tab) {
        this.state.activeTab = ['keymap', 'editor', 'theme'].includes(tab) ? tab : 'keymap';
        this.updateTabUI();
    }

    updateTabUI() {
        const tabs = this.element.querySelectorAll(".settings-tab");
        tabs.forEach((tab) => {
            const isActive = tab.dataset.tab === this.state.activeTab;
            tab.classList.toggle("active", isActive);
            tab.setAttribute("aria-selected", isActive ? "true" : "false");
        });

        const sections = [
            { key: 'keymap', element: this.keymapSection },
            { key: 'editor', element: this.editorSection },
            { key: 'theme', element: this.themeSection }
        ];
        sections.forEach(({ key, element }) => {
            if (!element) return;
            element.classList.toggle('hidden', key !== this.state.activeTab);
        });

        if (this.resetButton) {
            this.resetButton.style.display = this.state.activeTab === "keymap" ? "" : "none";
        }
        this.syncEditorSettingsUi();
    }

    renderRows() {
        if (!this.listEl) return;
        const actions = getKeymapActions();
        this.listEl.innerHTML = actions.map((action) => {
            const shortcut = this.state.keymap[action.id] || "";
            const displayValue = formatShortcutForDisplay(shortcut) || "";
            return `
                <div class="keymap-row">
                    <div class="keymap-info">
                        <div class="keymap-label">${action.label}</div>
                        <div class="keymap-meta">${action.description}</div>
                    </div>
                    <div class="keymap-input-group">
                        <input type="text" class="form-input keymap-input" data-action-id="${action.id}" value="${displayValue}" readonly>
                        <button type="button" class="gray-button keymap-clear" data-action-id="${action.id}" data-local-action="clearShortcut ${action.id}">Clear</button>
                    </div>
                </div>
            `;
        }).join("");
        this.bindRowEvents();
        this.updateConflicts();
    }

    bindRowEvents() {
        const inputs = this.element.querySelectorAll(".keymap-input");
        inputs.forEach((input) => {
            if (input.dataset.bound) return;
            input.addEventListener("keydown", (event) => {
                const actionId = event.currentTarget?.dataset?.actionId;
                if (!actionId) return;
                if (event.key === "Tab") return;
                event.preventDefault();
                event.stopPropagation();
                if (event.key === "Escape") {
                    event.currentTarget.blur();
                    return;
                }
                if (event.key === "Backspace" || event.key === "Delete") {
                    this.setShortcut(actionId, "");
                    return;
                }
                const shortcut = eventToShortcut(event);
                if (!shortcut) return;
                this.setShortcut(actionId, shortcut);
            });
            input.dataset.bound = "true";
        });
    }

    clearShortcut(_target, actionId) {
        if (!actionId) return;
        this.setShortcut(actionId, "");
    }

    setShortcut(actionId, shortcut) {
        const normalized = shortcut ? normalizeShortcutString(shortcut) : "";
        this.state.keymap[actionId] = normalized;
        this.updateRowDisplay(actionId);
        this.updateConflicts();
    }

    updateRowDisplay(actionId) {
        const input = this.element.querySelector(`.keymap-input[data-action-id="${actionId}"]`);
        if (!input) return;
        const raw = this.state.keymap[actionId] || "";
        input.value = formatShortcutForDisplay(raw) || "";
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
                conflicts.push(`${formatShortcutForDisplay(shortcut)}: ${labels.join(", ")}`);
            }
        }

        this.state.hasConflicts = conflicts.length > 0;
        if (this.warningEl) {
            this.warningEl.textContent = conflicts.length
                ? `Shortcut conflicts: ${conflicts.join(" | ")}`
                : "";
        }
        if (this.saveButton) {
            this.saveButton.disabled = this.state.hasConflicts;
        }
    }

    selectTheme(_target, theme) {
        this.state.selectedTheme = theme === "dark" ? "dark" : "light";
        this.updateThemeSelection();
    }

    updateThemeSelection() {
        const options = this.element.querySelectorAll(".theme-option");
        options.forEach((option) => {
            const isActive = option.dataset.theme === this.state.selectedTheme;
            option.classList.toggle("active", isActive);
            option.setAttribute("aria-checked", isActive ? "true" : "false");
        });
    }

    syncEditorSettingsUi() {
        if (this.editorAutoSaveEnabledInput) {
            this.editorAutoSaveEnabledInput.checked = Boolean(this.state.editorAutoSaveEnabled);
        }
        if (this.editorAutoSaveIntervalInput) {
            const nextValue = String(this.state.editorAutoSaveIntervalSeconds || 10);
            if (this.editorAutoSaveIntervalInput.value !== nextValue) {
                this.editorAutoSaveIntervalInput.value = nextValue;
            }
            this.editorAutoSaveIntervalInput.disabled = !this.state.editorAutoSaveEnabled;
        }
    }

    handleEditorAutoSaveToggle() {
        this.state.editorAutoSaveEnabled = Boolean(this.editorAutoSaveEnabledInput?.checked);
        this.syncEditorSettingsUi();
    }

    handleEditorAutoSaveIntervalInput() {
        const nextValue = Number.parseInt(String(this.editorAutoSaveIntervalInput?.value ?? ''), 10);
        this.state.editorAutoSaveIntervalSeconds = Number.isFinite(nextValue) && nextValue >= 1 ? nextValue : 10;
        this.syncEditorSettingsUi();
    }

    resetDefaults() {
        this.state.keymap = { ...getDefaultKeymap() };
        this.renderRows();
    }

    saveSettings() {
        if (this.state.hasConflicts) return;
        const keymap = setKeymap(this.state.keymap);
        const theme = setTheme(this.state.selectedTheme);
        this.closeModal({
            keymap,
            theme,
            editorAutoSaveEnabled: Boolean(this.state.editorAutoSaveEnabled),
            editorAutoSaveIntervalSeconds: Number.isFinite(this.state.editorAutoSaveIntervalSeconds)
                ? Math.max(1, Math.round(this.state.editorAutoSaveIntervalSeconds))
                : 10
        });
    }

    closeModal(payload) {
        assistOS.UI.closeModal(this.element, payload);
    }
}
