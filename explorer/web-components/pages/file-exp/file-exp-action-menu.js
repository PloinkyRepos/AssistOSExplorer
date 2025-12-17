export function positionOpenActionMenu(fileExp) {
    const openPath = fileExp.state.openMenuPath;
    if (!openPath) return;
    const container = fileExp.element.querySelector(`[data-action-menu="true"][data-entry-path="${openPath}"]`);
    const dropdown = container?.querySelector('.action-menu-dropdown');
    const trigger = container?.querySelector('.action-menu-trigger');
    if (!dropdown || !trigger) {
        return;
    }

    dropdown.removeAttribute('data-positioned');
    dropdown.classList.remove('drop-up');
    dropdown.style.left = '';
    dropdown.style.top = '';
    dropdown.style.right = '';
    dropdown.style.bottom = '';

    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = dropdown.getBoundingClientRect();
    const spacing = 8;
    const margin = 8;

    let left = triggerRect.right - menuRect.width;
    const maxLeft = window.innerWidth - menuRect.width - margin;
    left = Math.min(Math.max(left, margin), maxLeft);

    let top = triggerRect.bottom + spacing;
    let dropUp = false;
    if (top + menuRect.height > window.innerHeight - margin) {
        const aboveTop = triggerRect.top - menuRect.height - spacing;
        if (aboveTop >= margin) {
            top = aboveTop;
            dropUp = true;
        } else {
            top = Math.max(margin, window.innerHeight - menuRect.height - margin);
        }
    }

    dropdown.style.left = `${left}px`;
    dropdown.style.top = `${top}px`;
    dropdown.style.right = 'auto';
    dropdown.style.bottom = 'auto';
    dropdown.dataset.positioned = 'true';
    dropdown.classList.toggle('drop-up', dropUp);
}

