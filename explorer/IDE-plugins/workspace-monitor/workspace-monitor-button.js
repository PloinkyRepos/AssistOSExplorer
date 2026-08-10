function isAdmin() {
  const user = globalThis.assistOS?.user;
  const roles = Array.isArray(user?.roles) ? user.roles.map((role) => String(role).toLowerCase()) : [];
  return roles.includes('admin') || String(user?.username || '').toLowerCase() === 'admin'
    || String(user?.id || '').toLowerCase() === 'local:admin';
}

export class WorkspaceMonitorButton {
  constructor(element, invalidate) {
    this.element = element;
    this.invalidate = invalidate;
    this.hostContext = {};
    this.invalidate();
  }

  beforeRender() {}

  afterRender() {
    if (!isAdmin()) {
      this.element.hidden = true;
      return;
    }
    this.syncButtonMetadata();
  }

  afterUnload() {}

  updateHostContext(context = {}) {
    this.hostContext = context;
    this.syncButtonMetadata();
  }

  syncButtonMetadata() {
    const icon = typeof this.hostContext?.pluginIcon === 'string' && this.hostContext.pluginIcon.trim()
      ? this.hostContext.pluginIcon.trim()
      : this.element.getAttribute('data-plugin-icon') || '';
    const iconElement = this.element.querySelector('.action-menu-item-icon');
    if (iconElement && icon) iconElement.src = icon;
  }

  openDashboard() {
    const targetUrl = new URL(globalThis.location.href);
    targetUrl.hash = 'workspace-monitor-dashboard';
    globalThis.open(targetUrl.toString(), '_blank', 'noopener,noreferrer');
  }
}
