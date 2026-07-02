import {
    callAgentTool,
    ensureSuccess,
    parseToolResult
} from "/explorer/services/infrastructure/explorerApi.js";

const QR_LIB_URL = '/explorer/shared/libs/qr/qr.min.js';

async function callUserPersisto(toolName, args = {}) {
    const raw = await callAgentTool('userPersistoAgent', toolName, args, { raw: true });
    ensureSuccess(raw);
    return parseToolResult(raw) || {};
}

async function ensureQrLibrary() {
    if (window.qr?.encodeQR) return window.qr;
    await new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${QR_LIB_URL}"]`);
        if (existing) {
            existing.addEventListener('load', resolve, { once: true });
            existing.addEventListener('error', reject, { once: true });
            return;
        }
        const script = document.createElement('script');
        script.src = QR_LIB_URL;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Failed to load QR code library.'));
        document.head.appendChild(script);
    });
    if (!window.qr?.encodeQR) {
        throw new Error('QR code library is not available.');
    }
    return window.qr;
}

export class UserpersistoTotpSetupModal {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.setup = null;
        this.invalidate();
    }

    beforeRender() {}

    async afterRender() {
        this.status = this.element.querySelector('#totpSetupStatus');
        this.qrContainer = this.element.querySelector('#totpQrCode');
        this.secretEl = this.element.querySelector('#totpSecret');
        this.codeInput = this.element.querySelector('#totpCodeInput');
        this.verifyButton = this.element.querySelector('#totpVerifyButton');
        this.codeInput.addEventListener('input', () => this.updateVerifyButton());
        this.codeInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !this.verifyButton.disabled) this.verifyTotp();
        });
        await this.startSetup();
    }

    updateVerifyButton() {
        this.verifyButton.disabled = !/^[0-9]{6}$/.test(this.codeInput.value.trim());
    }

    showStatus(message, type = 'info') {
        this.status.textContent = message || '';
        this.status.hidden = !message;
        this.status.classList.toggle('error', type === 'error');
    }

    setBusy(isBusy) {
        this.element.querySelectorAll('button, input').forEach((control) => {
            control.disabled = isBusy;
        });
        if (!isBusy) this.updateVerifyButton();
    }

    async startSetup() {
        try {
            this.setBusy(true);
            this.showStatus('Preparing authenticator setup...');
            this.setup = await callUserPersisto('userpersisto_totp_setup_start');
            if (!this.setup?.secret || !this.setup?.otpauthUrl) {
                throw new Error('Authenticator setup data is missing.');
            }
            this.secretEl.textContent = this.setup.secret;
            const qrLib = await ensureQrLibrary();
            this.qrContainer.innerHTML = qrLib.encodeQR(this.setup.otpauthUrl, 'svg', { ecc: 'high', scale: 6 });
            this.showStatus('');
            this.codeInput.focus();
        } catch (error) {
            this.showStatus(error?.message || 'Failed to prepare authenticator setup.', 'error');
        } finally {
            this.setBusy(false);
        }
    }

    async verifyTotp() {
        const code = this.codeInput.value.trim();
        if (!/^[0-9]{6}$/.test(code)) return;
        try {
            this.setBusy(true);
            this.showStatus('Verifying code...');
            const result = await callUserPersisto('userpersisto_totp_setup_verify', { token: code });
            if (!result?.ok) {
                throw new Error('Authenticator code could not be verified.');
            }
            window.webSkel?.notificationHandler?.reportUserRelevantInfo?.('Authenticator app enabled.');
            assistOS.UI.closeModal(this.element, { verified: true });
        } catch (error) {
            this.showStatus(error?.message || 'Invalid authenticator code.', 'error');
        } finally {
            this.setBusy(false);
        }
    }

    closeModal() {
        assistOS.UI.closeModal(this.element, { verified: false });
    }
}
