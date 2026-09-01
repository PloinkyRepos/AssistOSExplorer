import { publicKeyRequestFromServer, assertionCredentialToServer } from './auth-api.js';

const root = document.querySelector('#auth_content');
const params = new URLSearchParams(window.location.search);
const state = params.get('state') || '';
const requestId = params.get('requestId') || params.get('providerState') || '';

let methods = ['password'];
let defaultMethod = 'password';
let emailChallengeId = '';
let setup = {
    needsInitialAdmin: false,
    selfRegistrationEnabled: true,
    enabledAuthMethods: ['password']
};

function element(tag, attributes = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
        if (key === 'className') {
            node.className = value;
        } else if (key === 'text') {
            node.textContent = value;
        } else if (key.startsWith('on') && typeof value === 'function') {
            node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (value !== undefined && value !== null) {
            node.setAttribute(key, String(value));
        }
    }
    node.append(...children);
    return node;
}

async function request(path, body) {
    const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
        throw new Error(data.error || `Request failed (${response.status})`);
    }
    return data;
}

function redirectWithCode(result) {
    const redirectUrl = new URL(result.redirectUri, window.location.origin);
    redirectUrl.searchParams.set('state', result.state || state);
    redirectUrl.searchParams.set('code', result.code);
    window.location.assign(redirectUrl.toString());
}

function setStatus(message, isError = false) {
    let status = root.querySelector('.status');
    if (!status) {
        status = element('p', { className: 'status', hidden: true });
        root.prepend(status);
    }
    status.textContent = message || '';
    status.hidden = !message;
    status.classList.toggle('error', isError);
}

function authPayload(extra = {}) {
    return { state, requestId, providerState: requestId, origin: window.location.origin, ...extra };
}

async function submitPassword(form) {
    const email = form.querySelector('[name="email"]').value.trim();
    const password = form.querySelector('[name="password"]').value;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
        const result = await request('password/login', authPayload({ email, password }));
        redirectWithCode(result);
    } catch (error) {
        setStatus(error.message || 'Unable to sign in.', true);
        button.disabled = false;
    }
}

async function submitRegistration(form) {
    const email = form.querySelector('[name="email"]').value.trim();
    const password = form.querySelector('[name="password"]').value;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
        const result = await request('register', authPayload({ email, password }));
        redirectWithCode(result);
    } catch (error) {
        setStatus(error.message || 'Unable to create the account.', true);
        button.disabled = false;
    }
}

async function startEmailCode(form) {
    const email = form.querySelector('[name="email"]').value.trim();
    const button = form.querySelector('[data-email-start]');
    button.disabled = true;
    try {
        const result = await request('email-code/start', authPayload({ email }));
        emailChallengeId = result.challengeId;
        form.querySelector('.email-code-fields').hidden = false;
        form.querySelector('[name="code"]').focus();
        setStatus('Code sent.');
    } catch (error) {
        setStatus(error.message || 'Unable to start email sign-in.', true);
    } finally {
        button.disabled = false;
    }
}

async function verifyEmailCode(form) {
    const code = form.querySelector('[name="code"]').value.trim();
    const button = form.querySelector('[data-email-verify]');
    button.disabled = true;
    try {
        const result = await request('email-code/verify', authPayload({ challengeId: emailChallengeId, code }));
        redirectWithCode(result);
    } catch (error) {
        setStatus(error.message || 'Unable to verify the code.', true);
        button.disabled = false;
    }
}

async function submitPasskey(form) {
    const email = form.querySelector('[name="email"]').value.trim();
    const button = form.querySelector('button[type="submit"]');
    if (!window.PublicKeyCredential || !navigator.credentials?.get) {
        setStatus('Passkeys are not available in this browser.', true);
        return;
    }
    button.disabled = true;
    try {
        const options = await request('passkey/options', authPayload({ email }));
        const credential = await navigator.credentials.get({
            publicKey: publicKeyRequestFromServer(options.publicKey)
        });
        const result = await request('passkey/verify', authPayload({
            email,
            challengeKey: options.challengeKey,
            assertion: assertionCredentialToServer(credential)
        }));
        redirectWithCode(result);
    } catch (error) {
        setStatus(error.message || 'Unable to use this passkey.', true);
        button.disabled = false;
    }
}

async function submitTotp(form) {
    const email = form.querySelector('[name="email"]').value.trim();
    const token = form.querySelector('[name="token"]').value.trim();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
        const result = await request('totp/verify', authPayload({ email, token }));
        redirectWithCode(result);
    } catch (error) {
        setStatus(error.message || 'Unable to verify the authenticator code.', true);
        button.disabled = false;
    }
}

function methodOrder() {
    const ordered = [defaultMethod, ...methods].filter(Boolean);
    return [...new Set(ordered)].filter((method) => ['password', 'emailCode', 'passkey', 'totp'].includes(method));
}

function render() {
    const registrationTitle = setup.needsInitialAdmin ? 'Create the installation owner' : 'Create an account';
    const registrationCopy = setup.needsInitialAdmin
        ? 'The first account becomes administrator. Only email and password are required.'
        : 'Your account receives the standard installation role. A username can be added later in Settings.';
    const registrationForm = element('form', { className: 'auth-panel registration-panel' }, [
        element('h1', { text: registrationTitle }),
        element('p', { className: 'auth-copy', text: registrationCopy }),
        element('label', { text: 'Email' }),
        element('input', { name: 'email', type: 'email', autocomplete: 'email', required: true }),
        element('label', { text: 'Password' }),
        element('input', { name: 'password', type: 'password', minlength: '8', maxlength: '1024', autocomplete: 'new-password', required: true }),
        element('button', { type: 'submit', text: setup.needsInitialAdmin ? 'Create admin account' : 'Create account' }),
        element('p', { className: 'status', hidden: true })
    ]);
    registrationForm.addEventListener('submit', (event) => {
        event.preventDefault();
        submitRegistration(registrationForm);
    });
    if (setup.needsInitialAdmin) {
        root.replaceChildren(registrationForm);
        return;
    }

    const passwordForm = element('form', { className: 'auth-panel password-panel' }, [
        element('h1', { text: 'UserPersisto' }),
        element('label', { text: 'Email' }),
        element('input', { name: 'email', type: 'email', autocomplete: 'username', required: true }),
        element('label', { text: 'Password' }),
        element('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true }),
        element('button', { type: 'submit', text: 'Sign in' }),
        element('p', { className: 'status', hidden: true })
    ]);
    passwordForm.addEventListener('submit', (event) => {
        event.preventDefault();
        submitPassword(passwordForm);
    });

    const emailCodeForm = element('form', { className: 'auth-panel email-panel' }, [
        element('h2', { text: 'Email Code' }),
        element('label', { text: 'Email' }),
        element('input', { name: 'email', type: 'email', autocomplete: 'email', required: true }),
        element('button', { type: 'button', 'data-email-start': 'true', text: 'Send code', onClick: () => startEmailCode(emailCodeForm) }),
        element('section', { className: 'email-code-fields', hidden: true }, [
            element('label', { text: 'Code' }),
            element('input', { name: 'code', inputmode: 'numeric', pattern: '[0-9]{6}', maxlength: '6', autocomplete: 'one-time-code' }),
            element('button', { type: 'button', 'data-email-verify': 'true', text: 'Verify', onClick: () => verifyEmailCode(emailCodeForm) })
        ])
    ]);

    const passkeyForm = element('form', { className: 'auth-panel passkey-panel' }, [
        element('h2', { text: 'Passkey' }),
        element('label', { text: 'Email' }),
        element('input', { name: 'email', type: 'email', autocomplete: 'username webauthn', required: true }),
        element('button', { type: 'submit', text: 'Use passkey' })
    ]);
    passkeyForm.addEventListener('submit', (event) => {
        event.preventDefault();
        submitPasskey(passkeyForm);
    });

    const totpForm = element('form', { className: 'auth-panel totp-panel' }, [
        element('h2', { text: 'Authenticator Code' }),
        element('label', { text: 'Email' }),
        element('input', { name: 'email', type: 'email', autocomplete: 'username', required: true }),
        element('label', { text: 'Code' }),
        element('input', { name: 'token', inputmode: 'numeric', pattern: '[0-9]{6}', maxlength: '6', autocomplete: 'one-time-code', required: true }),
        element('button', { type: 'submit', text: 'Verify code' })
    ]);
    totpForm.addEventListener('submit', (event) => {
        event.preventDefault();
        submitTotp(totpForm);
    });

    const panels = { password: passwordForm, emailCode: emailCodeForm, passkey: passkeyForm, totp: totpForm };
    const authPanels = methodOrder().map((method) => panels[method]);
    if (setup.selfRegistrationEnabled && methods.includes('password')) authPanels.push(registrationForm);
    root.replaceChildren(...authPanels);
}

try {
    const [methodsResponse, setupResponse] = await Promise.all([fetch('methods'), fetch('setup')]);
    const [methodsData, setupData] = await Promise.all([methodsResponse.json(), setupResponse.json()]);
    if (methodsResponse.ok && methodsData.ok !== false) {
        methods = Array.isArray(methodsData.methods) && methodsData.methods.length ? methodsData.methods : methods;
        defaultMethod = methodsData.defaultMethod || defaultMethod;
    }
    if (setupResponse.ok && setupData.ok !== false) setup = { ...setup, ...setupData };
} catch {
}

render();
