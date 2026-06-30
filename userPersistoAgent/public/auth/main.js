import WebSkel from './shared/webskel/webskel.mjs';

const showPublicAuthError = async (_title, message) => {
  const target = document.querySelector('#auth_content');
  if (target) {
    target.textContent = message || 'Unable to load authentication page.';
  }
};

globalThis.showApplicationError = globalThis.showApplicationError || showPublicAuthError;
window.showApplicationError = globalThis.showApplicationError;

const webSkel = await WebSkel.initialise('/public-services/userpersisto/auth/webskel.json');
globalThis.showApplicationError = showPublicAuthError;
window.showApplicationError = showPublicAuthError;
webSkel.setDomElementForPages(document.querySelector('#auth_content'));

const pathname = window.location.pathname;
const page = pathname.endsWith('/auth/passkey/register')
  ? 'userpersisto-passkey-register'
  : 'userpersisto-login';

await webSkel.changeToDynamicPage(page, page, null, true);
