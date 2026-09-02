const encode = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const decode = (value) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0));

document.querySelectorAll('[data-passkey]').forEach((button) => {
    button.form.addEventListener('submit', async (event) => {
        event.preventDefault();
        button.disabled = true;
        const form = button.form;
        try {
            const response = await fetch(form.action, { method: 'POST', body: new URLSearchParams(new FormData(form)), credentials: 'same-origin' });
            if (!response.ok) throw new Error('Unable to start passkey sign-in.');
            const result = await response.json();
            const options = result.publicKey;
            options.challenge = decode(options.challenge);
            options.allowCredentials = (options.allowCredentials || []).map((item) => ({ ...item, id: decode(item.id) }));
            const credential = await navigator.credentials.get({ publicKey: options });
            const assertion = { id: credential.id, rawId: encode(credential.rawId), type: credential.type,
                response: { clientDataJSON: encode(credential.response.clientDataJSON), authenticatorData: encode(credential.response.authenticatorData), signature: encode(credential.response.signature),
                    userHandle: credential.response.userHandle ? encode(credential.response.userHandle) : null } };
            const input = document.createElement('input');
            input.type = 'hidden'; input.name = 'assertion'; input.value = JSON.stringify(assertion); form.appendChild(input);
            form.action = form.action.replace(/passkey-options$/, 'passkey-verify');
            form.submit();
        } catch (error) {
            form.querySelector('[data-passkey-error]').textContent = error.message || 'Unable to sign in with this passkey.';
            button.disabled = false;
        }
    });
});
