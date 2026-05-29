import { getCurrentTheme } from "../../../utils/theme.js";

export function getCurrentAgentName(win = globalThis.window) {
    try {
        const parts = win.location.pathname.split('/').filter(Boolean);
        return parts[0] || 'explorer';
    } catch (_) {
        return 'explorer';
    }
}

export function buildUsersSettingsUrl(agentName) {
    const normalizedAgentName = String(agentName || 'explorer').trim() || 'explorer';
    return `/${encodeURIComponent(normalizedAgentName)}/admin/settings.html?embedded=1&theme=${getCurrentTheme()}`;
}

export const usersController = {
    async refreshUsersAccess() {
        if (this.state.usersAccessChecked) return;
        this.state.usersAccessChecked = true;
        const agentName = getCurrentAgentName();
        this.state.usersUrl = buildUsersSettingsUrl(agentName);
        try {
            const response = await fetch(`/api/agents/${encodeURIComponent(agentName)}/users`, {
                credentials: 'include',
                headers: { Accept: 'application/json' }
            });
            this.state.usersAccess = response.ok;
        } catch (_) {
            this.state.usersAccess = false;
        }
        this.updateTabUI();
    },

    syncUsersFrame() {
        if (!this.usersFrame) return;
        if (!this.state.usersAccess || this.state.activeTab !== "users") {
            return;
        }
        if (this.usersFrame.getAttribute("src") !== this.state.usersUrl) {
            this.usersFrame.setAttribute("src", this.state.usersUrl);
        }
    }
};
