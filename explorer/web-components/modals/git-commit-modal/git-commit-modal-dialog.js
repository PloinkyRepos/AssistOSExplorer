export function createGitCommitDialog(ctx) {
    const { element, dialogState } = ctx;

    const getDialogElement = () => element?.closest?.('dialog') || null;

    const ensureDialogPositioning = () => {
        const dialog = getDialogElement();
        if (!dialog) return null;
        if (dialog.dataset.gitPositioned === 'true') return dialog;
        const rect = dialog.getBoundingClientRect();
        dialog.style.left = `${rect.left}px`;
        dialog.style.top = `${rect.top}px`;
        dialog.style.width = `${rect.width}px`;
        dialog.style.height = `${rect.height}px`;
        dialog.classList.add('git-positioned');
        dialog.dataset.gitPositioned = 'true';
        return dialog;
    };

    const startResize = (event, dir) => {
        const dialog = ensureDialogPositioning();
        if (!dialog) return;
        if (dialog.classList.contains('is-fullscreen')) return;

        event.preventDefault();
        event.stopPropagation();

        const startRect = dialog.getBoundingClientRect();
        const startX = event.clientX;
        const startY = event.clientY;
        const minW = 760;
        const minH = 520;

        const onMove = (e) => {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            let left = startRect.left;
            let top = startRect.top;
            let width = startRect.width;
            let height = startRect.height;

            if (dir.includes('e')) width = startRect.width + dx;
            if (dir.includes('s')) height = startRect.height + dy;
            if (dir.includes('w')) {
                width = startRect.width - dx;
                left = startRect.left + dx;
            }
            if (dir.includes('n')) {
                height = startRect.height - dy;
                top = startRect.top + dy;
            }

            width = Math.max(minW, width);
            height = Math.max(minH, height);

            // Clamp left/top so resizing from west/north does not drift after hitting min sizes.
            if (dir.includes('w') && width === minW) {
                left = startRect.right - minW;
            }
            if (dir.includes('n') && height === minH) {
                top = startRect.bottom - minH;
            }

            dialog.style.left = `${left}px`;
            dialog.style.top = `${top}px`;
            dialog.style.width = `${width}px`;
            dialog.style.height = `${height}px`;
        };

        const onUp = () => {
            window.removeEventListener('pointermove', onMove, true);
            window.removeEventListener('pointerup', onUp, true);
        };

        window.addEventListener('pointermove', onMove, true);
        window.addEventListener('pointerup', onUp, true);
    };

    const ensureDialogResizable = () => {
        const dialog = getDialogElement();
        if (!dialog) return;
        if (dialog.dataset.gitResizable === 'true') return;

        const host = element.querySelector('.git-modal') || element;
        const handles = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
        for (const dir of handles) {
            const handle = document.createElement('div');
            handle.className = `git-resize-handle ${dir}`;
            handle.dataset.dir = dir;
            handle.addEventListener('pointerdown', (event) => startResize(event, dir));
            host.appendChild(handle);
        }
        dialog.dataset.gitResizable = 'true';
    };

    const toggleFullscreen = () => {
        const dialog = ensureDialogPositioning();
        if (!dialog) return;

        const isNowFullscreen = !dialog.classList.contains('is-fullscreen');
        if (isNowFullscreen) {
            const rect = dialog.getBoundingClientRect();
            dialogState.prev = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
            dialog.classList.add('is-fullscreen');
            dialogState.isFullscreen = true;
            return;
        }

        dialog.classList.remove('is-fullscreen');
        const prev = dialogState.prev;
        if (prev) {
            dialog.style.left = `${prev.left}px`;
            dialog.style.top = `${prev.top}px`;
            dialog.style.width = `${prev.width}px`;
            dialog.style.height = `${prev.height}px`;
        }
        dialogState.isFullscreen = false;
    };

    return { ensureDialogResizable, toggleFullscreen };
}
