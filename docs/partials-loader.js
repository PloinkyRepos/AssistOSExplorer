async function loadPartial(selector, target) {
  const host = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!host) return;
  try {
    const response = await fetch(target);
    if (response.ok) host.innerHTML = await response.text();
  } catch (_) {}
}

function installDocumentationNavigation() {
  const triggers = [...document.querySelectorAll('.site-nav__trigger')];
  const closeAll = (except = null) => triggers.forEach((trigger) => {
    if (trigger === except) return;
    trigger.setAttribute('aria-expanded', 'false');
    const menu = document.getElementById(trigger.getAttribute('aria-controls'));
    if (menu) menu.hidden = true;
  });
  triggers.forEach((trigger) => trigger.addEventListener('click', () => {
    const menu = document.getElementById(trigger.getAttribute('aria-controls'));
    const opening = trigger.getAttribute('aria-expanded') !== 'true';
    closeAll(opening ? trigger : null);
    trigger.setAttribute('aria-expanded', String(opening));
    if (menu) menu.hidden = !opening;
  }));
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.site-nav')) closeAll();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const open = triggers.find((trigger) => trigger.getAttribute('aria-expanded') === 'true');
    closeAll();
    open?.focus();
  });
}

async function installSharedChrome() {
  const headerHost = document.querySelector('[data-include="partials/header.html"]') || document.querySelector('#site-header');
  const existingHeader = document.querySelector('body > header');
  const footerHost = document.querySelector('[data-include="partials/footer.html"]') || document.querySelector('#site-footer');
  try {
    const [header, footer] = await Promise.all([
      fetch('partials/header.html').then((response) => response.ok ? response.text() : ''),
      fetch('partials/footer.html').then((response) => response.ok ? response.text() : '')
    ]);
    if (headerHost) headerHost.innerHTML = header;
    else if (existingHeader && header) existingHeader.outerHTML = header;
    if (footerHost) footerHost.innerHTML = footer;
    installDocumentationNavigation();
  } catch (_) {}
}

document.addEventListener('DOMContentLoaded', installSharedChrome);
