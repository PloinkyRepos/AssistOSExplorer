function estimateMenuHeight(dropdown) {
    const renderedItems = dropdown.querySelectorAll('.action-menu-item, .app-menu-item, [role="menuitem"]').length;
    if (renderedItems > 0) {
        return 16 + renderedItems * 40;
    }
    const encodedItems = dropdown.querySelector('app-menu')?.getAttribute('data-items');
    if (encodedItems) {
        try {
            const parsed = JSON.parse(decodeURIComponent(encodedItems));
            if (Array.isArray(parsed) && parsed.length) {
                return 16 + parsed.length * 40;
            }
        } catch {}
    }
    return 220;
}

export function positionOpenActionMenu(fileExp) {
    const openPath = fileExp.state.openMenuPath;
    if (!openPath) return;
    const container = fileExp.element.querySelector(`[data-action-menu="true"][data-entry-path="${openPath}"]`);
    const dropdown = container?.querySelector('.action-menu-dropdown');
    const trigger = container?.querySelector('.action-menu-trigger');
    if (!dropdown || !trigger) {
        return;
    }

    const previousScrollTop = dropdown.scrollTop || 0;

    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = dropdown.getBoundingClientRect();
    const naturalMenuHeight = Math.max(menuRect.height, dropdown.scrollHeight || 0, estimateMenuHeight(dropdown));
    const spacing = 8;
    const margin = 8;
    const viewportWidth = document.documentElement?.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement?.clientHeight || window.innerHeight;
    const isMobileViewport = viewportWidth <= 720;

    const menuWidth = isMobileViewport
        ? Math.min(Math.max(menuRect.width, dropdown.scrollWidth || 0, 220), viewportWidth - margin * 2)
        : menuRect.width;
    let left = triggerRect.right - menuWidth;
    const maxLeft = Math.max(margin, viewportWidth - menuWidth - margin);
    left = Math.min(Math.max(left, margin), maxLeft);

    const availableBelow = Math.max(0, viewportHeight - triggerRect.bottom - spacing - margin);
    const availableAbove = Math.max(0, triggerRect.top - spacing - margin);
    const menuHeight = naturalMenuHeight;
    const shouldDropUp = !isMobileViewport && availableBelow < menuHeight && availableAbove > availableBelow;
    const availableVertical = shouldDropUp ? availableAbove : availableBelow;
    let top = triggerRect.bottom + spacing;
    let bottom = 'auto';

    if (shouldDropUp) {
        top = 'auto';
        bottom = `${Math.max(margin, viewportHeight - triggerRect.top + spacing)}px`;
    } else if (!(triggerRect.bottom < margin || triggerRect.top > viewportHeight - margin)) {
        const maxTop = Math.max(margin, viewportHeight - Math.min(menuHeight, availableVertical) - margin);
        top = Math.min(Math.max(top, margin), maxTop);
    }

    const positionedAvailableVertical = shouldDropUp
        ? availableAbove
        : Math.max(0, viewportHeight - (typeof top === 'number' ? top : triggerRect.bottom + spacing) - margin);

    dropdown.style.left = `${left}px`;
    dropdown.style.top = typeof top === 'number' ? `${top}px` : top;
    dropdown.style.right = 'auto';
    dropdown.style.bottom = bottom;
    dropdown.style.maxHeight = `${Math.max(80, Math.floor(positionedAvailableVertical || availableVertical))}px`;
    if (isMobileViewport) {
        dropdown.style.width = `${Math.floor(menuWidth)}px`;
        dropdown.style.maxWidth = `calc(100vw - ${margin * 2}px)`;
    } else {
        dropdown.style.width = '';
        dropdown.style.maxWidth = '';
    }
    dropdown.dataset.positioned = 'true';
    dropdown.classList.toggle('drop-up', shouldDropUp);
    if (previousScrollTop > 0) {
        const maxScrollTop = Math.max(0, dropdown.scrollHeight - dropdown.clientHeight);
        dropdown.scrollTop = Math.min(previousScrollTop, maxScrollTop);
    }
}
