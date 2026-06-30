import {
  attestationCredentialToServer,
  decodeSetupPayload,
  postJson,
  publicKeyCreationFromServer
} from '../../auth-api.js';

export class UserPersistoPasskeyRegister {
  constructor(element, invalidate) {
    this.element = element;
    this.invalidate = invalidate;
    this.invalidate();
  }

  async beforeRender() {
  }

  async afterRender() {
    this.status = this.element.querySelector('#passkeyStatus');
    this.error = this.element.querySelector('#passkeyError');
    this.button = this.element.querySelector('#startButton');
    window.setTimeout(() => this.setupPasskey(), 100);
  }

  showError(error) {
    this.error.textContent = error?.message || String(error || 'Passkey setup failed.');
    this.error.hidden = false;
    this.status.textContent = 'Passkey setup could not be completed.';
    this.button.disabled = false;
  }

  async setupPasskey() {
    try {
      if (!window.PublicKeyCredential || !navigator.credentials?.create) {
        throw new Error('Passkeys are not supported in this browser.');
      }
      this.button.disabled = true;
      this.error.hidden = true;
      const payload = decodeSetupPayload();
      this.status.textContent = 'Waiting for browser passkey confirmation...';
      const credential = await navigator.credentials.create({
        publicKey: publicKeyCreationFromServer(payload.publicKey)
      });
      if (!credential) throw new Error('Passkey setup was cancelled.');
      await postJson('/public-services/userpersisto/auth/passkey/register/verify', {
        credential: attestationCredentialToServer(credential)
      });
      this.status.textContent = 'Passkey added. Returning to settings...';
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'userpersisto:passkey-setup', ok: true }, '*');
        window.close();
        return;
      }
      const returnUrl = new URL(payload.returnUrl || '/', window.location.origin);
      returnUrl.searchParams.set('passkeySetup', 'success');
      window.location.href = returnUrl.toString();
    } catch (error) {
      this.showError(error);
    }
  }
}
