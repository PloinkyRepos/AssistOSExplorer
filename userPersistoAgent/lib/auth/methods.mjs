const ALL = ['password', 'emailCode', 'passkey', 'totp'];

export function getEnabledAuthMethods() {
    const raw = String(process.env.USERPERSISTO_AUTH_METHODS || '').trim();
    if (raw) {
        const parsed = raw.split(',').map((value) => value.trim()).filter((value) => ALL.includes(value));
        if (parsed.length) {
            return parsed;
        }
    }
    return process.env.USERPERSISTO_DEV_BOOTSTRAP === 'true'
        ? ['password', 'emailCode']
        : ['emailCode', 'password'];
}

export function getDefaultAuthMethod() {
    return getEnabledAuthMethods()[0];
}
