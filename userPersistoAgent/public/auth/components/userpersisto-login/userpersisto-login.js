import {
  assertionCredentialToServer,
  loginParams,
  postJson,
  publicKeyRequestFromServer
} from '../../auth-api.js';

const METHOD_LABELS = {
  emailCode: 'Email Code',
  password: 'Username and password',
  passkey: 'Passkey',
  totp: 'Authenticator (OTP)'
};

const METHOD_ICONS = {
  emailCode: '/public-services/userpersisto/auth/shared/icons/email-auth-icon.svg',
  password: '/public-services/userpersisto/auth/shared/icons/keys.svg',
  passkey: '/public-services/userpersisto/auth/shared/icons/passkey-auth-icon.svg',
  totp: '/public-services/userpersisto/auth/shared/icons/totp-auth-icon.svg'
};

const METHOD_DESCRIPTIONS = {
  emailCode: 'Receive a one-time code by email.',
  password: 'Use your configured username and password.',
  passkey: 'Use this device security prompt.',
  totp: 'Use a 6-digit authenticator code.'
};

export class UserPersistoLogin {
  constructor(element, invalidate) {
    this.element = element;
    this.invalidate = invalidate;
    this.params = loginParams();
    this.email = '';
    this.username = '';
    this.methods = [];
    this.selectedMethod = '';
    this.authMode = 'login';
    this.invalidate();
  }

  beforeRender() {
  }

  afterRender() {
    this.authContainer = this.element.querySelector('.auth_container');
    this.status = this.element.querySelector('#loginStatus');
    this.emailInput = this.element.querySelector('.email_input');
    this.emailButton = this.element.querySelector('.submit_email_button');
    this.methodList = this.element.querySelector('.auth_methods_section');
    this.actionsContainer = this.element.querySelector('.actions_container');
    this.usernameInput = this.element.querySelector('.username_input');
    this.passwordInput = this.element.querySelector('.password_input');
    this.passwordButton = this.element.querySelector('.password_action_button');
    this.codeInput = this.element.querySelector('.code_input');
    this.codeButton = this.element.querySelector('.submit_code_button');
    this.totpInput = this.element.querySelector('.totp_input');
    this.totpButton = this.element.querySelector('.totp_action_button');
    this.accountLabels = [...this.element.querySelectorAll('.account_label')];

    this.emailInput.addEventListener('input', () => {
      this.emailButton.disabled = !this.isValidEmail(this.emailInput.value);
    });
    this.emailInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !this.emailButton.disabled) this.submitEmail();
    });
    this.passwordInput.addEventListener('input', () => this.updatePasswordButton());
    this.usernameInput.addEventListener('input', () => this.updatePasswordButton());
    this.passwordInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !this.passwordButton.disabled) this.submitPassword();
    });
    this.codeInput.addEventListener('input', () => {
      this.codeButton.disabled = this.codeInput.value.trim().length < 5;
    });
    this.codeInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !this.codeButton.disabled) this.submitEmailCode();
    });
    this.totpInput.addEventListener('input', () => {
      this.totpButton.disabled = !/^[0-9]{6}$/.test(this.totpInput.value.trim());
    });
    this.totpInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !this.totpButton.disabled) this.submitTotp();
    });
  }

  isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
  }

  setBusy(isBusy) {
    this.element.querySelectorAll('button, input').forEach((control) => {
      control.disabled = isBusy;
    });
    if (!isBusy) {
      this.emailButton.disabled = !this.isValidEmail(this.emailInput.value);
      this.updatePasswordButton();
      this.codeButton.disabled = this.codeInput.value.trim().length < 5;
      this.totpButton.disabled = !/^[0-9]{6}$/.test(this.totpInput.value.trim());
    }
  }

  updatePasswordButton() {
    this.passwordButton.disabled = !this.usernameInput.value.trim() || !this.passwordInput.value;
  }

  showStatus(message, type = 'info') {
    this.status.textContent = message || '';
    this.status.hidden = !message;
    this.status.classList.toggle('error', type === 'error');
  }

  setAccountLabels() {
    const prefix = this.authMode === 'signup' ? 'Creating account for' : 'Signing in as';
    const text = this.email ? `${prefix} ${this.email}` : '';
    this.accountLabels.forEach((label) => {
      label.textContent = text;
    });
  }

  resetToEmailStep() {
    this.authMode = 'login';
    this.authContainer.classList.add('auth_step1');
    this.authContainer.setAttribute('auth-step', 'login');
    this.authContainer.removeAttribute('selected-auth');
    this.authContainer.removeAttribute('login-step');
    this.emailInput.readOnly = false;
    this.emailButton.style.display = '';
    this.methodList.replaceChildren();
    this.actionsContainer.replaceChildren();
  }

  setMethodSelectionStep() {
    this.authContainer.classList.remove('auth_step1');
    this.authContainer.removeAttribute('login-step');
    this.emailInput.readOnly = true;
    this.emailButton.style.display = 'none';
    this.renderMethodOptions();
  }

  renderMethodOptions() {
    this.methodList.replaceChildren(...this.methods.map((method) => {
      const label = document.createElement('label');
      label.className = `choice ${method.type}`;
      const input = document.createElement('input');
      input.type = 'radio';
      input.className = 'custom_radio';
      input.name = 'auth_method';
      input.value = method.type;
      input.dataset.methodType = method.type;
      if (method.id) input.dataset.methodId = method.id;
      const icon = document.createElement('img');
      icon.className = 'icon';
      icon.src = METHOD_ICONS[method.type] || '/public-services/userpersisto/auth/shared/icons/keys.svg';
      icon.alt = '';
      icon.setAttribute('aria-hidden', 'true');
      const copy = document.createElement('section');
      copy.className = 'choice-copy';
      const text = document.createElement('section');
      text.className = 'label';
      text.textContent = method.name || METHOD_LABELS[method.type] || method.type;
      const hint = document.createElement('section');
      hint.className = 'hint';
      hint.textContent = METHOD_DESCRIPTIONS[method.type] || '';
      copy.append(text, hint);
      label.append(input, icon, copy);
      input.addEventListener('change', () => this.selectMethod(method.type));
      return label;
    }));

    this.actionsContainer.replaceChildren(
      this.createButton('Cancel', 'general-button secondary', () => this.resetToEmailStep()),
      this.createButton('Sign in', 'general-button', () => this.submitLoginMethod())
    );
    this.selectMethod(this.selectedMethod || this.methods[0]?.type || '');
  }

  setSignupPromptStep() {
    this.authMode = 'signup';
    this.methods = [{ type: 'emailCode', name: METHOD_LABELS.emailCode }];
    this.selectedMethod = 'emailCode';
    this.authContainer.classList.remove('auth_step1');
    this.authContainer.removeAttribute('login-step');
    this.authContainer.setAttribute('auth-step', 'signup');
    this.emailInput.readOnly = true;
    this.emailButton.style.display = 'none';
    this.setAccountLabels();
    this.renderMethodOptions();
    this.actionsContainer.replaceChildren(
      this.createButton('Cancel', 'general-button secondary', () => this.resetToEmailStep()),
      this.createButton('Create account', 'general-button', () => this.signupWithEmailCode())
    );
    this.showStatus(`No account exists for ${this.email}. Create one with an email authentication code.`);
  }

  createButton(label, className, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', handler);
    return button;
  }

  selectMethod(methodType) {
    this.selectedMethod = methodType;
    this.authContainer.setAttribute('selected-auth', methodType);
    this.element.querySelectorAll('.choice').forEach((choice) => {
      const selected = choice.querySelector('input')?.value === methodType;
      choice.classList.toggle('selected', selected);
      const input = choice.querySelector('input');
      if (input) input.checked = selected;
    });
  }

  async submitEmail() {
    this.email = this.emailInput.value.trim();
    if (!this.isValidEmail(this.email)) return;
    await this.run(async () => {
      this.authMode = 'login';
      const result = await postJson('/public-services/userpersisto/auth/api/methods', {
        ...this.params,
        email: this.email
      });
      this.params.clientId = result.clientId || this.params.clientId;
      if (result.userExists === false) {
        if (result.canSignup) {
          this.setSignupPromptStep();
          return;
        }
        throw new Error('No account is available for this email.');
      }
      this.methods = result.methods || [];
      this.selectedMethod = result.selectedMethod || this.methods[0]?.type || '';
      this.username = result.user?.username || '';
      this.usernameInput.value = this.username;
      this.setAccountLabels();
      if (this.methods.length === 1) {
        await this.openMethod(this.methods[0].type);
        return;
      }
      this.setMethodSelectionStep();
    });
  }

  async submitLoginMethod() {
    await this.run(() => this.openMethod(this.selectedMethod));
  }

  async openMethod(method) {
    this.selectMethod(method);
    if (method === 'emailCode') {
      await this.startEmailCode();
      return;
    }
    if (method === 'passkey') {
      await this.loginWithPasskey();
      return;
    }
    this.authContainer.classList.remove('auth_step1');
    this.authContainer.setAttribute('login-step', method);
    this.emailInput.readOnly = true;
    this.emailButton.style.display = 'none';
    this.setAccountLabels();
    if (method === 'password') {
      this.usernameInput.value = this.username || '';
      this.updatePasswordButton();
      this.passwordInput.focus();
      return;
    }
    if (method === 'totp') {
      this.totpInput.focus();
      return;
    }
    throw new Error('This authentication method is not available.');
  }

  async startEmailCode() {
    const result = await postJson('/public-services/userpersisto/auth/api/email/start', {
      ...this.params,
      email: this.email,
      mode: this.authMode
    });
    this.params.clientId = result.clientId || this.params.clientId;
    this.authContainer.classList.remove('auth_step1');
    this.authContainer.setAttribute('login-step', 'emailCode');
    this.emailInput.readOnly = true;
    this.emailButton.style.display = 'none';
    this.setAccountLabels();
    this.showStatus(this.authMode === 'signup'
      ? 'Account created. Authentication code sent. Check your email.'
      : 'Authentication code sent. Check your email.');
    this.codeInput.focus();
  }

  async signupWithEmailCode() {
    this.authMode = 'signup';
    await this.run(() => this.startEmailCode());
  }

  async sendEmailCode() {
    await this.run(() => this.startEmailCode());
  }

  async submitEmailCode() {
    await this.run(async () => {
      const result = await postJson('/public-services/userpersisto/auth/api/email/verify', {
        ...this.params,
        email: this.email,
        code: this.codeInput.value.trim(),
        mode: this.authMode
      });
      window.location.href = result.redirectUrl;
    });
  }

  async submitPassword() {
    await this.run(async () => {
      const result = await postJson('/public-services/userpersisto/auth/api/password/verify', {
        ...this.params,
        email: this.email,
        username: this.usernameInput.value.trim(),
        password: this.passwordInput.value
      });
      window.location.href = result.redirectUrl;
    });
  }

  async submitTotp() {
    await this.run(async () => {
      const result = await postJson('/public-services/userpersisto/auth/api/totp/verify', {
        ...this.params,
        email: this.email,
        token: this.totpInput.value.trim()
      });
      window.location.href = result.redirectUrl;
    });
  }

  async loginWithPasskey() {
    if (!window.PublicKeyCredential || !navigator.credentials?.get) {
      throw new Error('Passkeys are not supported in this browser.');
    }
    const start = await postJson('/public-services/userpersisto/auth/passkey/start', {
      ...this.params,
      email: this.email
    });
    const credential = await navigator.credentials.get({
      publicKey: publicKeyRequestFromServer(start.publicKey)
    });
    if (!credential) throw new Error('Passkey sign-in was cancelled.');
    const result = await postJson('/public-services/userpersisto/auth/passkey/verify', {
      ...this.params,
      email: this.email,
      credential: assertionCredentialToServer(credential)
    });
    window.location.href = result.redirectUrl;
  }

  async run(operation) {
    try {
      this.setBusy(true);
      this.showStatus('');
      await operation();
    } catch (error) {
      this.showStatus(error?.message || 'Unable to continue sign-in. Check your details and try again.', 'error');
    } finally {
      this.setBusy(false);
    }
  }
}
