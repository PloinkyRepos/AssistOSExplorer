export async function withGlobalLoader(fn) {
    const webSkel = typeof window !== 'undefined' ? window.webSkel : null;
    const canShow = Boolean(webSkel?.showLoading) && Boolean(webSkel?.hideLoading);
    if (!canShow) {
        return fn();
    }

    const state = (window.__assistosExplorerGlobalLoader ??= { depth: 0, id: null });
    state.depth += 1;

    if (state.depth === 1) {
        state.id = webSkel.showLoading();
    }

    try {
        return await fn();
    } finally {
        state.depth = Math.max(0, state.depth - 1);
        if (state.depth === 0) {
            webSkel.hideLoading(state.id);
            state.id = null;
        }
    }
}

