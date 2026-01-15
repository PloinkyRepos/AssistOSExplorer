const isObject = (value) => value !== null && typeof value === 'object';
const isCollection = (value) => value instanceof Set || value instanceof Map;
const isPlainObject = (value) => isObject(value) && !Array.isArray(value) && !isCollection(value);

function getInRaw(obj, path) {
    let current = obj;
    for (const key of path) {
        if (!isObject(current)) return undefined;
        current = current[key];
    }
    return current;
}

function setIn(obj, path, value, { unwrapProxy, stateRef } = {}) {
    if (!path.length) return value;
    const [head, ...rest] = path;
    const base = Array.isArray(obj) ? obj.slice() : { ...(isPlainObject(obj) ? obj : {}) };
    base[head] = setIn(isObject(obj) ? obj[head] : undefined, rest, value, { unwrapProxy, stateRef });
    return base;
}

export function createStore({ initialState, reducer }) {
    let state = initialState;
    const listeners = new Set();
    const proxyPaths = new WeakMap();

    const unwrapValue = (value) => {
        if (!isObject(value)) return value;
        const proxyPath = proxyPaths.get(value);
        if (proxyPath) {
            return getInRaw(state, proxyPath);
        }
        return value;
    };

    const stripProxies = (value, seen = new WeakMap()) => {
        if (!isObject(value) || isCollection(value)) return value;
        const proxyPath = proxyPaths.get(value);
        if (proxyPath) {
            const raw = getInRaw(state, proxyPath);
            return stripProxies(raw, seen);
        }
        if (seen.has(value)) return seen.get(value);
        const clone = Array.isArray(value) ? [] : {};
        seen.set(value, clone);
        for (const key of Object.keys(value)) {
            clone[key] = stripProxies(value[key], seen);
        }
        return clone;
    };

    const baseReducer = (current, action) => {
        if (!action || typeof action !== 'object') return current;
        switch (action.type) {
            case 'PATCH':
                return { ...current, ...(action.payload || {}) };
            case 'SET_IN': {
                const { path = [], value } = action.payload || {};
                const safeValue = unwrapValue(value);
                return setIn(current, Array.isArray(path) ? path : [], safeValue, { unwrapProxy: unwrapValue, stateRef: state });
            }
            case 'RESET':
                return action.payload;
            default:
                return current;
        }
    };

    const reducerImpl = typeof reducer === 'function' ? reducer : baseReducer;

    const dispatch = (action) => {
        const next = reducerImpl(state, action);
        if (next !== state) {
            state = stripProxies(next);
            for (const listener of listeners) {
                listener(state, action);
            }
        }
        return state;
    };

    const subscribe = (listener) => {
        if (typeof listener !== 'function') return () => {};
        listeners.add(listener);
        return () => listeners.delete(listener);
    };

    const proxyCache = new Map();
    const createProxy = (path = []) => {
        const key = path.join('.');
        if (proxyCache.has(key)) return proxyCache.get(key);
        const current = getInRaw(state, path);
        const proxyTarget = Array.isArray(current) ? [] : {};
        const proxy = new Proxy(proxyTarget, {
            get(_target, prop) {
                if (prop === '__isProxy') return true;
                if (prop === '__path') return path.slice();
                if (prop === 'toJSON') {
                    return () => getInRaw(state, path);
                }
                const current = getInRaw(state, path);
                if (Array.isArray(current)) {
                    if (prop === Symbol.iterator) {
                        return current[Symbol.iterator].bind(current);
                    }
                    if (typeof prop === 'string' && prop in Array.prototype) {
                        const fn = Array.prototype[prop];
                        if (typeof fn === 'function') {
                            return fn.bind(current);
                        }
                    }
                }
                const nextPath = path.concat(prop);
                const value = getInRaw(state, nextPath);
                if (isObject(value)) {
                    if (isCollection(value)) {
                        return value;
                    }
                    return createProxy(nextPath);
                }
                return value;
            },
            set(_target, prop, value) {
                dispatch({ type: 'SET_IN', payload: { path: path.concat(prop), value } });
                return true;
            },
            deleteProperty(_target, prop) {
                dispatch({ type: 'SET_IN', payload: { path: path.concat(prop), value: undefined } });
                return true;
            },
            ownKeys() {
                const current = getInRaw(state, path);
                return current ? Reflect.ownKeys(current) : [];
            },
            getOwnPropertyDescriptor() {
                return { enumerable: true, configurable: true };
            }
        });
        proxyCache.set(key, proxy);
        proxyPaths.set(proxy, path.slice());
        return proxy;
    };

    return {
        getState: () => state,
        dispatch,
        subscribe,
        state: createProxy()
    };
}

export function createSelector(selectorFn) {
    return (state) => selectorFn(state);
}
