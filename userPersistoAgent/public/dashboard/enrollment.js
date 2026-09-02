import { publicKeyCreationFromServer, attestationCredentialToServer } from '../auth/auth-api.js';

function enrollmentError(error, fallback) {
    const code = error?.payload?.reason || error?.payload?.error
        || error?.data?.reason || error?.data?.error || error?.reason || error?.message;
    if (error?.name === 'NotAllowedError' || error?.name === 'AbortError') return 'Passkey setup was canceled. You can try again.';
    if (error?.name === 'SecurityError') return 'Passkeys are unavailable at this address. Open your workspace using its secure address.';
    if (code === 'invalid_token') return 'That code did not match. Enter the current six-digit code from your authenticator.';
    if (code === 'setup_expired' || code === 'setup_not_found') return 'This setup has expired. Cancel and start again.';
    if (code === 'auth_method_disabled') return 'This sign-in method is disabled by your administrator.';
    return fallback;
}

function checkedResult(result) {
    if (!result || result.ok === false || result.error) {
        const error = new Error(result?.error || result?.reason || 'Enrollment failed');
        error.payload = result;
        throw error;
    }
    return result;
}

export class AccountEnrollment {
    constructor(element, { callTool, onEnrolled = async () => {}, browser = globalThis } = {}) {
        this.element = element;
        this.callTool = callTool;
        this.onEnrolled = onEnrolled;
        this.browser = browser;
        this.operation = 0;
        this.disposed = false;
        this.busy = false;
        this.pending = false;
        this.activeMethod = '';
        this.element.classList.add('up-enrollment');
        this.element.innerHTML = `
            <div class="up-method">
                <div><h3>Passkeys</h3><p>Sign in with your device, fingerprint, or security key.</p><p data-passkey-status></p></div>
                <button type="button" data-passkey-start>Add a passkey</button>
            </div>
            <div class="up-method">
                <div><h3>Authenticator app</h3><p>Use a one-time code from an authenticator app.</p><p data-totp-status></p></div>
                <button type="button" data-totp-start>Set up authenticator</button>
            </div>
            <form class="up-totp-setup" data-totp-setup hidden autocomplete="off">
                <p>Add a new account in your authenticator app using this setup key, then enter its current code.</p>
                <label>Setup key<input data-totp-secret readonly autocomplete="off" spellcheck="false"></label>
                <details><summary>Manual setup URI</summary><textarea data-totp-uri readonly rows="3" autocomplete="off" spellcheck="false" aria-label="Authenticator setup URI"></textarea></details>
                <label>Six-digit code<input data-totp-token inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>
                <div class="up-enrollment-actions"><button type="submit" data-totp-confirm>Confirm authenticator</button><button type="button" class="up-secondary" data-totp-cancel>Cancel</button></div>
            </form>
            <p class="up-enrollment-status" data-enrollment-status role="status" aria-live="polite"></p>`;
        const select = (name) => this.element.querySelector(`[data-${name}]`);
        this.passkeyButton = select('passkey-start');
        this.passkeyStatus = select('passkey-status');
        this.totpButton = select('totp-start');
        this.totpStatus = select('totp-status');
        this.setupForm = select('totp-setup');
        this.secretInput = select('totp-secret');
        this.uriInput = select('totp-uri');
        this.tokenInput = select('totp-token');
        this.confirmButton = select('totp-confirm');
        this.status = select('enrollment-status');
        this.passkeyButton.addEventListener('click', () => void this.startPasskey());
        this.totpButton.addEventListener('click', () => void this.startTotp());
        select('totp-cancel').addEventListener('click', () => this.cancel());
        this.setupForm.addEventListener('submit', (event) => { event.preventDefault(); void this.verifyTotp(); });
        this.pageHide = () => this.cancel();
        this.browser.addEventListener?.('pagehide', this.pageHide);
        this.loadStyles();
        this.updateProfile(null);
    }

    loadStyles() {
        const document = this.element.ownerDocument;
        if (!document?.head || document.querySelector('link[data-userpersisto-enrollment]')) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = new URL('./enrollment.css', import.meta.url).href;
        link.dataset.userpersistoEnrollment = '';
        document.head.append(link);
    }

    enabled(method) {
        return !!this.profile?.user && this.profile.allowedAuthMethods?.includes(method) === true;
    }

    updateProfile(profile) {
        if (this.disposed) return;
        if (this.profile?.user?.id !== profile?.user?.id
            || (this.activeMethod && !profile?.allowedAuthMethods?.includes(this.activeMethod))) {
            this.clearSensitiveState();
            this.setStatus('');
        }
        this.profile = profile;
        this.render();
    }

    render() {
        if (this.disposed) return;
        const passkey = this.profile?.enrollments?.passkey || {};
        const totp = this.profile?.enrollments?.totp || {};
        const passkeyAvailable = this.browser.isSecureContext === true && typeof this.browser.navigator?.credentials?.create === 'function';
        this.passkeyStatus.textContent = !this.enabled('passkey') ? 'Disabled by your administrator.'
            : !passkeyAvailable ? 'Use a secure address and a browser that supports passkeys.'
                : passkey.configured ? `${passkey.count || 1} passkey${(passkey.count || 1) === 1 ? '' : 's'} configured.` : 'No passkey configured yet.';
        this.passkeyButton.textContent = passkey.configured ? 'Add another passkey' : 'Add a passkey';
        this.passkeyButton.disabled = this.busy || !this.enabled('passkey') || !passkeyAvailable;
        this.totpStatus.textContent = !this.enabled('totp') ? 'Disabled by your administrator.'
            : totp.configured ? 'Authenticator configured.'
                : this.pending ? 'Enter a code below to finish setup.'
                    : totp.pending ? 'Setup is unfinished. Start again to get a new key.' : 'No authenticator configured yet.';
        this.totpButton.textContent = totp.configured ? 'Authenticator configured' : 'Set up authenticator';
        this.totpButton.disabled = this.busy || this.pending || !this.enabled('totp') || totp.configured === true;
        this.confirmButton.disabled = this.busy || !this.pending || !this.enabled('totp');
        this.tokenInput.disabled = this.confirmButton.disabled;
        this.setupForm.hidden = !this.pending || !this.enabled('totp');
    }

    setStatus(message, error = false) {
        if (this.disposed) return;
        this.status.textContent = message;
        this.status.classList.toggle('error', error);
    }

    clearSensitiveState() {
        this.operation += 1;
        this.abortController?.abort();
        this.abortController = null;
        this.pending = false;
        this.activeMethod = '';
        this.busy = false;
        this.secretInput.value = '';
        this.uriInput.value = '';
        this.tokenInput.value = '';
        this.setupForm.hidden = true;
    }

    cancel() {
        this.clearSensitiveState();
        this.setStatus('');
        this.render();
    }

    current(operation) {
        return !this.disposed && operation === this.operation && this.element.isConnected !== false;
    }

    async startPasskey() {
        if (this.disposed || this.busy || this.passkeyButton.disabled) return;
        this.clearSensitiveState();
        const operation = this.operation;
        this.activeMethod = 'passkey';
        this.busy = true;
        this.render();
        this.setStatus('Follow your browser’s instructions to create a passkey.');
        this.abortController = new AbortController();
        try {
            const origin = this.browser.location.origin;
            const start = checkedResult(await this.callTool('userpersisto_passkey_registration_options', { origin }));
            if (!this.current(operation)) return;
            const credential = await this.browser.navigator.credentials.create({
                publicKey: publicKeyCreationFromServer(start.publicKey), signal: this.abortController.signal,
            });
            if (!this.current(operation)) return;
            if (!credential) throw new Error('No credential returned');
            checkedResult(await this.callTool('userpersisto_passkey_registration_verify', {
                attestation: attestationCredentialToServer(credential), challengeKey: start.challengeKey, origin,
            }));
            if (!this.current(operation)) return;
            this.profile = { ...this.profile, enrollments: { ...this.profile.enrollments,
                passkey: { configured: true, count: (this.profile.enrollments?.passkey?.count || 0) + 1 },
            } };
            this.setStatus('Passkey added. You can use it the next time you sign in.');
            try { await this.onEnrolled(); } catch (_) {
                if (this.current(operation)) this.setStatus('Passkey added. Refresh your profile to see its current status.');
            }
        } catch (error) {
            if (this.current(operation)) this.setStatus(enrollmentError(error, 'Unable to add a passkey. Try again.'), true);
        } finally {
            if (this.current(operation)) { this.abortController = null; this.activeMethod = ''; this.busy = false; this.render(); }
        }
    }

    async startTotp() {
        if (this.disposed || this.busy || this.totpButton.disabled) return;
        this.clearSensitiveState();
        const operation = this.operation;
        this.activeMethod = 'totp';
        this.busy = true;
        this.render();
        this.setStatus('Preparing authenticator setup…');
        try {
            const setup = checkedResult(await this.callTool('userpersisto_totp_setup_start', {}));
            if (!this.current(operation)) return;
            if (typeof setup.secret !== 'string' || !/^[A-Z2-7]+=*$/.test(setup.secret)) throw new Error('Invalid setup key');
            this.secretInput.value = setup.secret;
            this.uriInput.value = String(setup.otpauthUrl || '');
            this.pending = true;
            this.setStatus('Keep this setup key private. It is cleared when you leave or cancel.');
        } catch (error) {
            if (this.current(operation)) this.setStatus(enrollmentError(error, 'Unable to start authenticator setup. Try again.'), true);
        } finally {
            if (this.current(operation)) { this.busy = false; this.render(); if (this.pending) this.tokenInput.focus(); }
        }
    }

    async verifyTotp() {
        if (this.disposed || this.busy || !this.pending || !this.enabled('totp')) return;
        const token = this.tokenInput.value.trim();
        if (!/^\d{6}$/.test(token)) { this.setStatus('Enter the current six-digit code from your authenticator.', true); return; }
        const operation = this.operation;
        this.busy = true;
        this.render();
        try {
            checkedResult(await this.callTool('userpersisto_totp_setup_verify', { token }));
            if (!this.current(operation)) return;
            this.clearSensitiveState();
            const completedOperation = this.operation;
            this.profile = { ...this.profile, enrollments: { ...this.profile.enrollments,
                totp: { configured: true, pending: false },
            } };
            this.render();
            this.setStatus('Authenticator configured. You can use its codes to sign in.');
            try { await this.onEnrolled(); } catch (_) {
                if (this.current(completedOperation)) this.setStatus('Authenticator configured. Refresh your profile to see its current status.');
            }
        } catch (error) {
            if (this.current(operation)) this.setStatus(enrollmentError(error, 'Unable to confirm the code. Try again.'), true);
        } finally {
            if (this.current(operation)) { this.busy = false; this.tokenInput.value = ''; this.render(); }
        }
    }

    dispose() {
        this.clearSensitiveState();
        this.disposed = true;
        this.browser.removeEventListener?.('pagehide', this.pageHide);
        this.element.replaceChildren();
        this.profile = null;
    }
}
