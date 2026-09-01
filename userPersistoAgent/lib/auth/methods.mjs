import { getAuthPolicy, isAuthMethodEnabled } from '../policy.mjs';

export async function getEnabledAuthMethods() {
    return (await getAuthPolicy()).enabledAuthMethods;
}

export async function getDefaultAuthMethod() {
    return (await getEnabledAuthMethods())[0] || 'password';
}

export { isAuthMethodEnabled };
