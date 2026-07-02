import { ensureSettingsComponentRegistered } from "./settings-component-loader.js";

function isAdminUser(user) {
    if (!user || typeof user !== "object") return false;
    if (user.role === "admin") return true;
    if (Array.isArray(user.roles) && user.roles.includes("admin")) return true;
    if (user.raw && typeof user.raw === "object") {
        if (user.raw.role === "admin") return true;
        if (Array.isArray(user.raw.roles) && user.raw.roles.includes("admin")) return true;
    }
    return false;
}

export const usersController = {
    async refreshUsersAccess() {
        if (this.state.adminAccessChecked) return;
        this.state.adminAccessChecked = true;
        this.state.adminAccess = false;

        try {
            const response = await fetch("/auth/token", {
                method: "GET",
                credentials: "include",
                headers: { Accept: "application/json" }
            });
            if (response.ok) {
                const payload = await response.json();
                this.state.adminAccess = isAdminUser(payload?.user);
            }
        } catch (_) {
            this.state.adminAccess = false;
        }

        this.updateTabUI();
        this.renderPluginSettings();
        this.renderAgentSettings();
        if (this.state.activeTab === "users" && this.state.activeUsersTab === "administration") {
            this.loadUserAdministration();
        }
    },

    renderUserAdministrationStatus() {
        if (!this.userAdministrationStatusEl) return;
        this.userAdministrationStatusEl.textContent = this.state.userAdministrationStatus || "";
        this.userAdministrationStatusEl.classList.toggle("error", this.state.userAdministrationStatusType === "error");
    },

    async loadUserAdministration() {
        if (!this.state.adminAccess || !this.userAdministrationMount) return;
        if (this.state.userAdministrationLoaded || this.state.userAdministrationBusy) return;
        this.state.userAdministrationBusy = true;
        this.state.userAdministrationStatus = "Loading user administration...";
        this.state.userAdministrationStatusType = "";
        this.renderUserAdministrationStatus();

        try {
            if (!this.state.pluginDataLoaded) {
                await this.loadPluginSettingsData();
            }
            const item = this.state.userAdministrationSettingsItem;
            if (!item || !item.available || !item.sourcePlugin || !item.settingsComponent) {
                throw new Error("UserPersisto settings component is not available.");
            }
            await ensureSettingsComponentRegistered({
                ...item.sourcePlugin,
                settingsComponent: item.settingsComponent
            });
            if (!this.userAdministrationMount.querySelector(item.settingsComponent)) {
                this.userAdministrationMount.innerHTML = `
                    <${item.settingsComponent}
                        data-presenter="${item.settingsComponent}"
                        data-initial-panel="${this.state.activeUserAdministrationPanel || 'users'}"
                        data-active-panel="${this.state.activeUserAdministrationPanel || 'users'}"
                        data-embedded="true">
                    </${item.settingsComponent}>
                `;
            }
            this.applyUserAdministrationPanel?.();
            this.state.userAdministrationLoaded = true;
            this.state.userAdministrationStatus = "";
            this.state.userAdministrationStatusType = "";
        } catch (error) {
            this.state.userAdministrationStatus = error?.message || "Failed to load user administration.";
            this.state.userAdministrationStatusType = "error";
        } finally {
            this.state.userAdministrationBusy = false;
            this.renderUserAdministrationStatus();
        }
    }
};
