import { probeAuthenticatedSession } from './authApi.js';

export function isBackForwardRestore(event, performanceObject = globalThis.performance) {
    if (event?.persisted === true) {
        return true;
    }
    const navigation = performanceObject?.getEntriesByType?.('navigation')?.at?.(-1);
    return navigation?.type === 'back_forward';
}

export function buildLoginRedirect(locationObject = globalThis.location) {
    const returnTo = `${locationObject?.pathname || '/'}${locationObject?.search || ''}${locationObject?.hash || ''}`;
    return `/auth/login?returnTo=${encodeURIComponent(returnTo || '/')}`;
}

export function installAuthNavigationGuard({
    windowObject = globalThis.window,
    performanceObject = globalThis.performance,
    probeSession = probeAuthenticatedSession
} = {}) {
    if (!windowObject?.addEventListener) {
        return () => {};
    }

    let checking = false;
    const handlePageShow = async (event) => {
        if (checking || !isBackForwardRestore(event, performanceObject)) {
            return;
        }
        checking = true;
        try {
            const authenticated = await probeSession();
            if (authenticated === false) {
                windowObject.location.replace(buildLoginRedirect(windowObject.location));
            }
        } finally {
            checking = false;
        }
    };

    windowObject.addEventListener('pageshow', handlePageShow);
    return () => windowObject.removeEventListener('pageshow', handlePageShow);
}
