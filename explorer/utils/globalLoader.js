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
        if (typeof window?.requestAnimationFrame === 'function') {
            await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
        }
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

export async function callToolWithLoader(agentName, toolName, args, appServices = null) {
    const services = appServices
        || (typeof window !== 'undefined' ? window.webSkel?.appServices : null);
    if (!services || typeof services.callTool !== 'function') {
        throw new Error('callToolWithLoader: appServices.callTool is not available.');
    }
    return withGlobalLoader(() => services.callTool(agentName, toolName, args));
}

export async function callTool(agentName, toolName, args, appServices = null) {
    const services = appServices
        || (typeof window !== 'undefined' ? window.webSkel?.appServices : null);
    if (!services || typeof services.callTool !== 'function') {
        throw new Error('callTool: appServices.callTool is not available.');
    }
    return services.callTool(agentName, toolName, args);
}
