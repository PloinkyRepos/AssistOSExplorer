import {
    callAgentTool,
    ensureSuccess,
    parseToolResult
} from "../../../services/infrastructure/explorerApi.js";

const AUTH_METHOD_LABELS = {
    password: "Username and password",
    emailCode: "Email authentication code",
    passkey: "Passkey",
    totp: "TOTP verification"
};

const SETUP_METHODS = [
    { type: "passkey", label: "Passkey", description: "Use this device or a password manager to sign in." },
    { type: "totp", label: "Authenticator app", description: "Use a 6-digit verification code from an authenticator app." }
];

async function callUserPersistoTool(toolName, args = {}) {
    const raw = await callAgentTool("userPersistoAgent", toolName, args, { raw: true });
    ensureSuccess(raw);
    return parseToolResult(raw) || {};
}

function base64urlToBuffer(value) {
    const base64 = String(value || "").replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes.buffer;
}

function bufferToBase64url(value) {
    const bytes = new Uint8Array(value);
    let binary = "";
    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function publicKeyCreationOptionsFromServer(publicKey = {}) {
    const options = { ...publicKey };
    options.challenge = base64urlToBuffer(options.challenge);
    options.user = { ...(options.user || {}), id: base64urlToBuffer(options.user?.id) };
    if (Array.isArray(options.excludeCredentials)) {
        options.excludeCredentials = options.excludeCredentials.map((credential) => ({
            ...credential,
            id: base64urlToBuffer(credential.id)
        }));
    }
    return options;
}

function credentialToServer(credential) {
    const response = {
        clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
        attestationObject: bufferToBase64url(credential.response.attestationObject)
    };
    if (typeof credential.response.getTransports === "function") {
        response.transports = credential.response.getTransports();
    }
    return {
        id: credential.id,
        rawId: bufferToBase64url(credential.rawId),
        type: credential.type,
        response
    };
}

function isLocalIpHost(hostname = window.location.hostname) {
    return hostname === "127.0.0.1" || hostname === "::1";
}

function encodeJsonBase64url(value) {
    const json = JSON.stringify(value);
    const bytes = new TextEncoder().encode(json);
    let binary = "";
    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function passkeyRegistrationUrl(publicKey) {
    if (!isLocalIpHost()) return "";
    const url = new URL(window.location.href);
    const hostname = url.hostname;
    url.hostname = "localhost";
    url.pathname = "/public-services/userpersisto/auth/passkey/register";
    url.search = "";
    url.hash = `setup=${encodeJsonBase64url({
        publicKey,
        returnUrl: window.location.href
    })}`;
    return url.toString();
}

async function showToast(message, type = "info") {
    const api = globalThis.assistOS;
    await (api?.showToast || api?.UI?.showToast)?.(message, type, 2500);
}

export const authPreferenceController = {
    renderPreferredAuthStatus() {
        if (!this.preferredAuthStatusEl) return;
        this.preferredAuthStatusEl.textContent = this.state.preferredAuthStatus || "";
        this.preferredAuthStatusEl.classList.toggle("error", this.state.preferredAuthStatusType === "error");
    },

    renderPreferredAuthMethods() {
        if (!this.preferredAuthSelectEl) return;
        const methods = Array.isArray(this.state.authMethods) ? this.state.authMethods : [];
        this.preferredAuthSelectEl.replaceChildren(...methods.map((method) => {
            const option = document.createElement("option");
            option.value = method.type;
            option.textContent = method.name || AUTH_METHOD_LABELS[method.type] || method.type;
            return option;
        }));

        const preferred = String(this.state.authUser?.preferredAuthMethod || "").trim();
        const available = methods.map((method) => method.type);
        this.preferredAuthSelectEl.value = available.includes(preferred) ? preferred : (available[0] || "");
        this.preferredAuthSelectEl.disabled = methods.length <= 1 || this.state.authPreferenceBusy;
        if (this.savePreferredAuthButton) {
            this.savePreferredAuthButton.disabled = methods.length <= 1 || this.state.authPreferenceBusy;
        }
        if (!this.state.preferredAuthStatus && !this.state.preferredAuthStatusType) {
            if (!this.state.authUser) {
                this.state.preferredAuthStatus = "No authenticated UserPersisto profile is available.";
            } else if (methods.length <= 1) {
                this.state.preferredAuthStatus = methods.length
                    ? "Only one sign-in method is available for your account."
                    : "No sign-in methods are available for your account.";
            } else {
                this.state.preferredAuthStatus = "";
            }
        }
        this.renderPreferredAuthStatus();
        this.renderAuthEnrollment();
    },

    renderAuthEnrollment() {
        if (!this.authEnrollmentListEl) return;
        const allowed = new Set(Array.isArray(this.state.allowedAuthMethods) ? this.state.allowedAuthMethods : []);
        const enrollments = this.state.authEnrollments || {};
        const busy = Boolean(this.state.authPreferenceBusy);
        const rows = SETUP_METHODS
            .filter((method) => allowed.has(method.type))
            .map((method) => {
                const enrollment = enrollments[method.type] || {};
                const configured = Boolean(enrollment.configured);
                const pending = Boolean(enrollment.pending);
                const status = configured ? "Configured" : (pending ? "Pending verification" : "Not configured");
                const action = method.type === "passkey" ? "setupMyPasskey" : "setupMyTotp";
                const buttonLabel = configured
                    ? (method.type === "passkey" ? "Add another passkey" : "Reset authenticator")
                    : `Set up ${method.label.toLowerCase()}`;
                return `
                    <div class="auth-enrollment-row">
                        <div>
                            <div class="auth-enrollment-title">${method.label}</div>
                            <div class="auth-enrollment-description">${method.description}</div>
                            <div class="auth-enrollment-status">${status}</div>
                        </div>
                        <button type="button" class="gray-button" data-local-action="${action}" ${busy ? "disabled" : ""}>${buttonLabel}</button>
                    </div>
                `;
            });
        this.authEnrollmentListEl.innerHTML = rows.length
            ? rows.join("")
            : `<div class="auth-enrollment-empty">No additional sign-in methods are enabled for this workspace.</div>`;
    },

    async loadPreferredAuthProfile() {
        if (this.state.authPreferenceBusy) return;
        this.state.authPreferenceBusy = true;
        this.state.preferredAuthStatus = "Loading sign-in methods...";
        this.state.preferredAuthStatusType = "";
        this.renderPreferredAuthStatus();
        this.renderPreferredAuthMethods();
        try {
            const payload = await callUserPersistoTool("userpersisto_profile_get");
            this.state.authUser = payload.user || null;
            this.state.authMethods = Array.isArray(payload.authMethods) ? payload.authMethods : [];
            this.state.allowedAuthMethods = this.state.authUser
                ? (Array.isArray(payload.allowedAuthMethods) && payload.allowedAuthMethods.length
                    ? payload.allowedAuthMethods
                    : ["passkey", "totp"])
                : [];
            this.state.authEnrollments = payload.enrollments || {};
            this.state.preferredAuthStatusType = "";
            this.state.preferredAuthStatus = "Profile loaded. Preferred sign-in selection is not available in this workspace contract.";
        } catch (error) {
            this.state.authUser = null;
            this.state.authMethods = [];
            this.state.allowedAuthMethods = [];
            this.state.authEnrollments = {};
            this.state.preferredAuthStatus = error?.message || "Failed to load sign-in methods.";
            this.state.preferredAuthStatusType = "error";
        } finally {
            this.state.authPreferenceBusy = false;
            this.renderPreferredAuthMethods();
        }
    },

    async savePreferredAuthMethod() {
        this.state.preferredAuthStatus = "Preferred sign-in selection is not available in this workspace contract.";
        this.state.preferredAuthStatusType = "";
        this.renderPreferredAuthMethods();
    },

    async setupMyPasskey() {
        if (this.state.authPreferenceBusy) return;
        if (!window.PublicKeyCredential || !navigator.credentials?.create) {
            this.state.preferredAuthStatus = "Passkeys are not supported in this browser.";
            this.state.preferredAuthStatusType = "error";
            this.renderPreferredAuthMethods();
            return;
        }
        this.state.authPreferenceBusy = true;
        this.state.preferredAuthStatus = "Starting passkey setup...";
        this.state.preferredAuthStatusType = "";
        this.renderPreferredAuthMethods();
        try {
            const start = await callUserPersistoTool("userpersisto_passkey_registration_options", {});
            const registrationUrl = passkeyRegistrationUrl(start.publicKey);
            if (registrationUrl) {
                await this.completePasskeySetupInPopup(registrationUrl);
                this.state.preferredAuthStatus = "Passkey added.";
                this.state.preferredAuthStatusType = "";
                await showToast("Passkey added.", "success");
                this.state.authPreferenceBusy = false;
                await this.loadPreferredAuthProfile();
                return;
            }
            const credential = await navigator.credentials.create({
                publicKey: publicKeyCreationOptionsFromServer(start.publicKey)
            });
            if (!credential) throw new Error("Passkey setup was cancelled.");
            await callUserPersistoTool("userpersisto_passkey_registration_verify", {
                attestation: credentialToServer(credential)
            });
            this.state.preferredAuthStatus = "Passkey added.";
            this.state.preferredAuthStatusType = "";
            await showToast("Passkey added.", "success");
            this.state.authPreferenceBusy = false;
            await this.loadPreferredAuthProfile();
        } catch (error) {
            this.state.preferredAuthStatus = error?.message || "Failed to add passkey.";
            this.state.preferredAuthStatusType = "error";
        } finally {
            this.state.authPreferenceBusy = false;
            this.renderPreferredAuthMethods();
        }
    },

    completePasskeySetupInPopup(registrationUrl) {
        this.state.preferredAuthStatus = "Complete passkey setup in the popup window...";
        this.state.preferredAuthStatusType = "";
        this.renderPreferredAuthMethods();
        return new Promise((resolve, reject) => {
            const popup = window.open(registrationUrl, "userpersisto-passkey-setup", "width=520,height=680");
            if (!popup) {
                reject(new Error("Passkey setup popup was blocked by the browser."));
                return;
            }
            let completed = false;
            const cleanup = () => {
                window.removeEventListener("message", onMessage);
                window.clearInterval(poll);
            };
            const onMessage = (event) => {
                if (event.source !== popup) return;
                if (event.data?.type !== "userpersisto:passkey-setup") return;
                completed = true;
                cleanup();
                if (event.data.ok) resolve();
                else reject(new Error(event.data.error || "Passkey setup failed."));
            };
            const poll = window.setInterval(() => {
                if (!popup.closed || completed) return;
                cleanup();
                reject(new Error("Passkey setup window was closed before completion."));
            }, 500);
            window.addEventListener("message", onMessage);
        });
    },

    async setupMyTotp() {
        if (this.state.authPreferenceBusy) return;
        this.state.authPreferenceBusy = true;
        this.state.preferredAuthStatus = "Opening authenticator setup...";
        this.state.preferredAuthStatusType = "";
        this.renderPreferredAuthMethods();
        try {
            const result = await assistOS.UI.showModal("userpersisto-totp-setup-modal", {}, true);
            if (result?.verified) {
                this.state.preferredAuthStatus = "Authenticator app enabled.";
                this.state.preferredAuthStatusType = "";
                this.state.authPreferenceBusy = false;
                await this.loadPreferredAuthProfile();
                return;
            }
            this.state.preferredAuthStatus = "";
            this.state.preferredAuthStatusType = "";
        } catch (error) {
            this.state.preferredAuthStatus = error?.message || "Failed to start authenticator setup.";
            this.state.preferredAuthStatusType = "error";
        } finally {
            this.state.authPreferenceBusy = false;
            this.renderPreferredAuthMethods();
        }
    }
};
