function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function normalizeOption(option) {
    if (typeof option === 'string') {
        return { name: option, value: option };
    }
    return {
        name: option?.name ?? option?.label ?? option?.value ?? '',
        value: option?.value ?? option?.name ?? option?.label ?? ''
    };
}

function readEncodedOptions(encodedOptions) {
    if (!encodedOptions) return null;
    try {
        const parsed = JSON.parse(decodeURIComponent(encodedOptions));
        return Array.isArray(parsed) ? parsed.map(normalizeOption) : [];
    } catch (_) {
        return [];
    }
}

export class CustomSelect {
    constructor(element, invalidate, props = {}) {
        this.element = element;
        this.invalidate = invalidate;
        this.options = this.readOptions(props);
        this.defaultSelected = this.element.getAttribute('data-selected');
        this.name = this.element.getAttribute('data-name') || this.element.id || `custom-select-${Math.random().toString(36).slice(2)}`;
        this.value = '';
        this.invalidate();
    }

    readOptions(props) {
        const encodedOptions = this.element.getAttribute('data-options');
        const options = readEncodedOptions(encodedOptions);
        if (options) return options;
        return Array.isArray(props.options) ? props.options.map(normalizeOption) : [];
    }

    beforeRender() {}

    afterRender() {
        this.trigger = this.element.querySelector('.custom-select');
        this.currentOption = this.element.querySelector('.current-option');
        this.optionsList = this.element.querySelector('.options-list');
        this.renderOptions(this.options);
        this.applySelectedValue(this.defaultSelected || this.options[0]?.value || '', { emit: false });
        this.applyConfiguredWidth();
        this.bindKeyboard();
    }

    afterUnload() {
        this.closeSelect();
    }

    applyConfiguredWidth() {
        const width = Number.parseInt(this.element.getAttribute('data-width'), 10);
        if (Number.isFinite(width) && width > 0) {
            this.element.style.width = `${width}px`;
            return;
        }
        this.element.style.removeProperty('width');
    }

    bindKeyboard() {
        this.trigger?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                this.openSelect();
                return;
            }
            if (event.key === 'Escape') {
                this.closeSelect();
            }
        });
    }

    openSelect(event) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (!this.optionsList || !this.trigger) return;
        if (!this.optionsList.classList.contains('hidden')) {
            this.closeSelect();
            return;
        }

        this.controller?.abort();
        this.controller = new AbortController();
        const { signal } = this.controller;

        this.trigger.classList.add('focused');
        this.trigger.setAttribute('aria-expanded', 'true');
        this.optionsList.classList.remove('hidden');
        this.optionsList.hidden = false;

        this.portalHost = this.element.closest('dialog') || document.body;
        this.previousPortalOverflow = this.portalHost.style.overflow;
        this.portalHost.style.overflow = 'visible';
        if (this.optionsList.parentElement !== this.portalHost) {
            this.portalHost.appendChild(this.optionsList);
        }

        this.positionOptionsList();
        this.optionsList.querySelector('.option[data-selected="true"]')?.focus({ preventScroll: true });

        this.optionsList.addEventListener('click', (clickEvent) => this.handleOptionsClick(clickEvent), { signal });
        document.addEventListener('pointerdown', (pointerEvent) => this.handleOutsidePointer(pointerEvent), { capture: true, signal });
        window.addEventListener('resize', () => this.positionOptionsList(), { signal });
        document.addEventListener('scroll', () => this.positionOptionsList(), { capture: true, signal });
        document.addEventListener('keydown', (keyEvent) => {
            if (keyEvent.key === 'Escape') this.closeSelect();
        }, { signal });
    }

    closeSelect() {
        if (!this.optionsList || this.optionsList.classList.contains('hidden')) return;
        this.optionsList.classList.add('hidden');
        this.optionsList.hidden = true;
        this.trigger?.classList.remove('focused');
        this.trigger?.setAttribute('aria-expanded', 'false');
        this.controller?.abort();
        this.controller = null;
        this.element.appendChild(this.optionsList);
        if (this.portalHost) {
            this.portalHost.style.overflow = this.previousPortalOverflow || '';
        }
        this.portalHost = null;
        this.previousPortalOverflow = '';
        for (const property of ['left', 'top', 'width', 'maxHeight']) {
            this.optionsList.style.removeProperty(property);
        }
    }

    handleOutsidePointer(event) {
        if (this.element.contains(event.target) || this.optionsList?.contains(event.target)) return;
        this.closeSelect();
    }

    handleOptionsClick(event) {
        const option = event.target.closest('.option');
        if (!option || !this.optionsList.contains(option)) return;
        event.preventDefault();
        event.stopPropagation();
        this.selectOption(option);
    }

    renderOptions(options) {
        this.options = options.map(normalizeOption);
        if (!this.currentOption || !this.optionsList) return;
        this.optionsList.innerHTML = this.options.map((option) => `
            <button type="button" class="option custom-select-option" data-value="${escapeHtml(option.value)}" role="option">
                ${escapeHtml(option.name)}
            </button>
        `).join('');
    }

    applySelectedValue(value, { emit } = { emit: true }) {
        const normalizedValue = String(value ?? '');
        const selected = this.options.find((option) => String(option.value) === normalizedValue) || this.options[0] || { name: '', value: '' };
        this.value = String(selected.value ?? '');
        this.element.value = this.value;
        if (this.currentOption) {
            this.currentOption.textContent = String(selected.name ?? '');
        }
        for (const optionElement of this.optionsList?.querySelectorAll('.option') || []) {
            const isSelected = optionElement.getAttribute('data-value') === this.value;
            optionElement.toggleAttribute('data-selected', isSelected);
            optionElement.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        }
        if (emit) {
            const changeEvent = new Event('change', { bubbles: true, cancelable: true });
            changeEvent.value = this.value;
            this.element.dispatchEvent(changeEvent);
        }
    }

    selectOption(option) {
        this.applySelectedValue(option.getAttribute('data-value'), { emit: true });
        this.closeSelect();
    }

    positionOptionsList() {
        if (!this.optionsList || !this.trigger) return;
        const triggerRect = this.trigger.getBoundingClientRect();
        const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
        const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
        const margin = 8;
        const gap = 4;
        const mobile = window.matchMedia?.('(max-width: 720px)')?.matches || viewportWidth <= 720;
        const desiredMaxHeight = Number.parseInt(this.element.getAttribute('data-max-height'), 10) || 330;
        const width = mobile ? viewportWidth - margin * 2 : Math.min(Math.max(triggerRect.width, 180), viewportWidth - margin * 2);
        const left = mobile ? margin : Math.min(Math.max(triggerRect.left, margin), viewportWidth - width - margin);
        const spaceBelow = viewportHeight - triggerRect.bottom - margin - gap;
        const spaceAbove = triggerRect.top - margin - gap;
        const openAbove = spaceBelow < Math.min(180, desiredMaxHeight) && spaceAbove > spaceBelow;
        const available = Math.max(64, openAbove ? spaceAbove : spaceBelow);
        const maxHeight = Math.min(desiredMaxHeight, available);
        const listHeight = Math.min(this.optionsList.scrollHeight || maxHeight, maxHeight);
        const top = openAbove
            ? Math.max(margin, triggerRect.top - gap - listHeight)
            : Math.min(triggerRect.bottom + gap, viewportHeight - margin - listHeight);

        this.optionsList.style.left = `${left}px`;
        this.optionsList.style.top = `${top}px`;
        this.optionsList.style.width = `${width}px`;
        this.optionsList.style.maxHeight = `${maxHeight}px`;
    }
}
