const root = document.querySelector('#auth_content');
const params = new URLSearchParams(window.location.search);
const state = params.get('state') || '';
const requestId = params.get('requestId') || params.get('providerState') || '';

let methods = ['password', 'emailCode'];
let defaultMethod = 'password';
let emailChallengeId = '';

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
    const status = root.querySelector('.status');
    status.textContent = message || '';
    status.hidden = !message;
    status.classList.toggle('error', isError);
}

function authPayload(extra = {}) {
    return { state, requestId, providerState: requestId, ...extra };
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

async function startEmailCode(form) {
    const email = form.querySelector('[name="email"]').value.trim();
    const selfRegister = form.querySelector('[name="selfRegister"]').checked;
    const button = form.querySelector('[data-email-start]');
    button.disabled = true;
    try {
        const result = await request('email-code/start', authPayload({ email, selfRegister }));
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

function methodOrder() {
    const ordered = [defaultMethod, ...methods].filter(Boolean);
    return [...new Set(ordered)].filter((method) => method === 'password' || method === 'emailCode');
}

function render() {
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
        element('label', { className: 'checkbox-row' }, [
            element('input', { name: 'selfRegister', type: 'checkbox' }),
            document.createTextNode('Create account')
        ]),
        element('button', { type: 'button', 'data-email-start': 'true', text: 'Send code', onClick: () => startEmailCode(emailCodeForm) }),
        element('section', { className: 'email-code-fields', hidden: true }, [
            element('label', { text: 'Code' }),
            element('input', { name: 'code', inputmode: 'numeric', pattern: '[0-9]{6}', maxlength: '6', autocomplete: 'one-time-code' }),
            element('button', { type: 'button', 'data-email-verify': 'true', text: 'Verify', onClick: () => verifyEmailCode(emailCodeForm) })
        ])
    ]);

    const panels = { password: passwordForm, emailCode: emailCodeForm };
    root.replaceChildren(...methodOrder().map((method) => panels[method]));
}

try {
    const response = await fetch('methods');
    const data = await response.json();
    if (response.ok && data.ok !== false) {
        methods = Array.isArray(data.methods) && data.methods.length ? data.methods : methods;
        defaultMethod = data.defaultMethod || defaultMethod;
    }
} catch {
}

render();
