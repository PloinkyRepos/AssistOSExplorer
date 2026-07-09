export class AdminBrandingSettings {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.state = {
            loginBrandingName: 'Login'
        };
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.nameInput = this.element.querySelector('input[name="loginBrandingName"]');
        this.render();
    }

    setState(next = {}) {
        if (Object.prototype.hasOwnProperty.call(next, 'loginBrandingName')) {
            this.state.loginBrandingName = String(next.loginBrandingName || 'Login');
        }
        this.render();
    }

    render() {
        if (this.nameInput && this.nameInput.value !== this.state.loginBrandingName) {
            this.nameInput.value = this.state.loginBrandingName;
        }
    }

    saveBrandingSettings() {
        this.element.dispatchEvent(new CustomEvent('admin-branding-save', {
            bubbles: true,
            detail: {
                loginBrandingName: this.nameInput?.value || ''
            }
        }));
    }
}
