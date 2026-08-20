function closeMenus(except = null) {
  document.querySelectorAll('.site-nav__group').forEach((group) => {
    if (group === except) return;
    group.querySelector('.site-nav__menu')?.setAttribute('hidden', '');
    group.querySelector('.site-nav__trigger')?.setAttribute('aria-expanded', 'false');
  });
}

function initializeMenus() {
  document.querySelectorAll('.site-nav__trigger').forEach((trigger) => {
    trigger.addEventListener('click', () => {
      const group = trigger.closest('.site-nav__group');
      const menu = group?.querySelector('.site-nav__menu');
      if (!group || !menu) return;
      const isOpen = trigger.getAttribute('aria-expanded') === 'true';
      closeMenus(isOpen ? null : group);
      trigger.setAttribute('aria-expanded', String(!isOpen));
      menu.toggleAttribute('hidden', isOpen);
    });
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.site-nav__group')) closeMenus();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const openTrigger = document.querySelector('.site-nav__trigger[aria-expanded="true"]');
    if (!openTrigger) return;
    closeMenus();
    openTrigger.focus();
  });
}

async function loadPartial(selector, path) {
  const target = document.querySelector(selector);
  if (!target) return;
  try {
    const response = await fetch(path, { cache: 'no-cache' });
    if (response.ok) target.innerHTML = await response.text();
  } catch (_) {
    // Keep local documentation readable when a partial cannot be loaded.
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const jobs = [];
  document.querySelectorAll('[data-include]').forEach((element) => {
    jobs.push(loadPartial(element, element.getAttribute('data-include')));
  });
  if (document.querySelector('#site-header')) jobs.push(loadPartial('#site-header', 'partials/header.html'));
  if (document.querySelector('#site-footer')) jobs.push(loadPartial('#site-footer', 'partials/footer.html'));
  await Promise.all(jobs);
  initializeMenus();
});
