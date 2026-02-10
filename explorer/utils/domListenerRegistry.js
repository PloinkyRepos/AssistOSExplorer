export function createDomListenerRegistry() {
    const keyedListeners = new Map();
    const disposableListeners = new Set();

    const bind = (target, type, listener, options) => {
        if (!target || typeof target.addEventListener !== 'function' || typeof listener !== 'function') {
            return () => {};
        }
        target.addEventListener(type, listener, options);
        return () => {
            target.removeEventListener(type, listener, options);
        };
    };

    const add = (target, type, listener, options) => {
        const cleanup = bind(target, type, listener, options);
        disposableListeners.add(cleanup);
        return () => {
            if (!disposableListeners.delete(cleanup)) return;
            cleanup();
        };
    };

    const set = (key, target, type, listener, options) => {
        if (!key) {
            return add(target, type, listener, options);
        }
        const existing = keyedListeners.get(key);
        if (typeof existing === 'function') {
            existing();
            keyedListeners.delete(key);
        }
        const cleanup = bind(target, type, listener, options);
        keyedListeners.set(key, cleanup);
        return () => {
            const current = keyedListeners.get(key);
            if (current !== cleanup) return;
            keyedListeners.delete(key);
            cleanup();
        };
    };

    const remove = (key) => {
        const cleanup = keyedListeners.get(key);
        if (!cleanup) return false;
        keyedListeners.delete(key);
        cleanup();
        return true;
    };

    const clear = () => {
        for (const cleanup of keyedListeners.values()) {
            cleanup();
        }
        keyedListeners.clear();
        for (const cleanup of disposableListeners.values()) {
            cleanup();
        }
        disposableListeners.clear();
    };

    return {
        add,
        set,
        remove,
        clear
    };
}
