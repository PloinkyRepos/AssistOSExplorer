function closeMenus(except) { document.querySelectorAll('.site-nav__group').forEach((group) => { if (group !== except) { group.querySelector('.site-nav__menu')?.setAttribute('hidden', ''); group.querySelector('.site-nav__trigger')?.setAttribute('aria-expanded', 'false'); } }); }
function initializeMenus() { document.querySelectorAll('.site-nav__trigger').forEach((trigger) => { trigger.addEventListener('click', () => { const group = trigger.closest('.site-nav__group'); const menu = group.querySelector('.site-nav__menu'); const open = trigger.getAttribute('aria-expanded') === 'true'; closeMenus(open ? null : group); trigger.setAttribute('aria-expanded', String(!open)); menu.toggleAttribute('hidden', open); }); trigger.addEventListener('keydown', (event) => { if (event.key === 'Escape') { closeMenus(null); trigger.focus(); } }); }); document.addEventListener('click', (event) => { if (!event.target.closest('.site-nav__group')) closeMenus(null); }); }
async function loadPartial(selector, path) { const target = document.querySelector(selector); if (!target) return; const response = await fetch(path, { cache: 'no-cache' }); if (response.ok) target.innerHTML = await response.text(); }
function initializeDocumentationSidebar() {
  const pages = [['index.html', 'Overview'], ['architecture.html', 'Architecture'], ['execution-workflow.html', 'Execution workflow'], ['mcp-tools.html', 'MCP tools'], ['integrations.html', 'Integrations'], ['configuration.html', 'Configuration']];
  const main = document.querySelector('main');
  const content = main?.firstElementChild;
  if (!main || !content || main.querySelector('.doc-layout')) return;
  const layout = document.createElement('div');
  const sidebar = document.createElement('aside');
  const title = document.createElement('h2');
  const navigation = document.createElement('nav');
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  layout.className = 'doc-layout';
  sidebar.className = 'doc-sidebar';
  sidebar.setAttribute('aria-label', 'Documentation pages');
  title.textContent = 'Documentation';
  pages.forEach(([href, label]) => {
    const link = document.createElement('a');
    link.href = href;
    link.textContent = label;
    if (href === currentPage) link.setAttribute('aria-current', 'page');
    navigation.append(link);
  });
  sidebar.append(title, navigation);
  main.classList.add('content--with-sidebar');
  main.insertBefore(layout, content);
  layout.append(sidebar, content);
}
document.addEventListener('DOMContentLoaded', async () => { await Promise.all([loadPartial('[data-include="partials/header.html"]', 'partials/header.html'), loadPartial('[data-include="partials/footer.html"]', 'partials/footer.html')]); (await import('../../docs/documentation-breadcrumb.js')).initializeDocumentationBreadcrumb('Workspace Monitor'); initializeMenus(); initializeDocumentationSidebar(); });
