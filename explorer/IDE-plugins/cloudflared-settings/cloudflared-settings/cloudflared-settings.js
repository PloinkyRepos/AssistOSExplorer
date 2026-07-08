import {
  callAgentTool,
  parseToolResult
} from '/explorer/services/infrastructure/explorerApi.js';

function normalizeRoute(route) {
  return {
    id: String(route?.id || `route_${Date.now()}`).trim(),
    enabled: route?.enabled !== false,
    hostname: String(route?.hostname || '').trim(),
    path: String(route?.path || '').trim(),
    originId: String(route?.originId || '').trim(),
    service: String(route?.service || '').trim(),
    description: String(route?.description || '').trim()
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export class CloudflaredSettings {
  constructor(element, invalidate) {
    this.element = element;
    this.invalidate = invalidate;
    this.loaded = false;
    this.state = {
      busy: false,
      status: 'Loading tunnel status...',
      notice: '',
      origins: [],
      routes: []
    };
    this.invalidate();
  }

  async afterRender() {
    this.statusEl = this.element.querySelector('[data-role="status"]');
    this.noticeEl = this.element.querySelector('[data-role="notice"]');
    this.originsEl = this.element.querySelector('[data-role="origins"]');
    this.routesEl = this.element.querySelector('[data-role="routes"]');
    this.originSelect = this.element.querySelector('select[name="originId"]');
    this.form = this.element.querySelector('[data-role="route-form"]');
    this.createDnsEl = this.element.querySelector('[data-role="create-dns"]');

    this.element.querySelector('[data-action="refresh"]')?.addEventListener('click', this.refresh);
    this.element.querySelector('[data-action="validate"]')?.addEventListener('click', this.validate);
    this.element.querySelector('[data-action="apply"]')?.addEventListener('click', this.apply);
    this.form?.addEventListener('submit', this.addRoute);
    this.routesEl?.addEventListener('click', this.handleRouteClick);

    this.renderState();
    if (!this.loaded) {
      this.loaded = true;
      await this.refresh();
    }
  }

  afterUnload() {
    this.element.querySelector('[data-action="refresh"]')?.removeEventListener('click', this.refresh);
    this.element.querySelector('[data-action="validate"]')?.removeEventListener('click', this.validate);
    this.element.querySelector('[data-action="apply"]')?.removeEventListener('click', this.apply);
    this.form?.removeEventListener('submit', this.addRoute);
    this.routesEl?.removeEventListener('click', this.handleRouteClick);
  }

  setStatus(message, notice = '') {
    this.state.status = message;
    this.state.notice = notice;
    this.renderState();
  }

  callTool = async (name, args = {}) => {
    const result = await callAgentTool('cloudflared', name, args, { raw: true });
    return parseToolResult(result) || {};
  };

  refresh = async () => {
    this.state.busy = true;
    this.renderState();
    try {
      const payload = await this.callTool('cloudflared_status');
      this.state.origins = Array.isArray(payload.origins) ? payload.origins : [];
      this.state.routes = Array.isArray(payload.routes) ? payload.routes.map(normalizeRoute) : [];
      const ready = payload.cloudflare?.ready ? 'Cloudflare API configured' : 'Cloudflare API config incomplete';
      this.setStatus(`${payload.status?.state || 'unknown'} - ${ready}`);
    } catch (error) {
      this.setStatus(error?.message || 'Failed to load tunnel status.', 'Start Explorer with the production profile and confirm the cloudflared agent is running.');
    } finally {
      this.state.busy = false;
      this.renderState();
    }
  };

  validate = async () => {
    try {
      const payload = await this.callTool('cloudflared_routes_validate', { routes: this.state.routes });
      this.state.routes = Array.isArray(payload.routes) ? payload.routes.map(normalizeRoute) : this.state.routes;
      this.setStatus(`Valid route set: ${Math.max(0, (payload.ingress || []).length - 1)} active ingress rules.`);
    } catch (error) {
      this.setStatus('Validation failed.', error?.message || String(error));
    }
  };

  apply = async () => {
    try {
      const payload = await this.callTool('cloudflared_routes_apply', {
        routes: this.state.routes,
        createDnsRecords: this.createDnsEl?.checked !== false
      });
      this.state.routes = Array.isArray(payload.routes) ? payload.routes.map(normalizeRoute) : this.state.routes;
      this.setStatus(`Applied ${Math.max(0, (payload.ingress || []).length - 1)} ingress rules.`);
    } catch (error) {
      this.setStatus('Apply failed.', error?.message || String(error));
    }
  };

  addRoute = (event) => {
    event.preventDefault();
    const data = new FormData(this.form);
    const route = normalizeRoute({
      hostname: data.get('hostname'),
      path: data.get('path'),
      originId: data.get('originId'),
      description: data.get('description')
    });
    if (!route.hostname || !route.originId) return;
    this.state.routes = [...this.state.routes, route];
    this.form.reset();
    this.renderState();
  };

  handleRouteClick = (event) => {
    const button = event.target?.closest?.('[data-remove-route]');
    if (!button) return;
    const id = button.getAttribute('data-remove-route');
    this.state.routes = this.state.routes.filter((route) => route.id !== id);
    this.renderState();
  };

  renderState() {
    if (this.statusEl) this.statusEl.textContent = this.state.status;
    if (this.noticeEl) {
      this.noticeEl.textContent = this.state.notice;
      this.noticeEl.hidden = !this.state.notice;
    }
    for (const button of this.element.querySelectorAll('button')) {
      button.disabled = this.state.busy;
    }
    if (this.originSelect) {
      this.originSelect.innerHTML = this.state.origins
        .map((origin) => `<option value="${escapeHtml(origin.id)}">${escapeHtml(origin.label)}</option>`)
        .join('');
    }
    if (this.originsEl) {
      this.originsEl.innerHTML = this.state.origins
        .map((origin) => `
          <div class="origin-row">
            <div>
              <strong>${escapeHtml(origin.label)}</strong>
              <div class="muted">${escapeHtml(origin.service)}</div>
            </div>
          </div>
        `)
        .join('');
    }
    if (this.routesEl) {
      this.routesEl.innerHTML = this.state.routes
        .map((route) => `
          <div class="route-row">
            <div>
              <strong>${escapeHtml(route.hostname)}${escapeHtml(route.path || '/')}</strong>
              <div class="muted">${escapeHtml(route.originId)} -> ${escapeHtml(route.service || '(preset)')}</div>
            </div>
            <button type="button" data-remove-route="${escapeHtml(route.id)}">Remove</button>
          </div>
        `)
        .join('');
    }
  }
}
