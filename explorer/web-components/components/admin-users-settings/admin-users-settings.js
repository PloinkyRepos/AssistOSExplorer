import {
    encodeOptions,
    escapeAttr,
    parseRoles
} from '../admin-settings-panel/admin-settings-utils.js';

export class AdminUsersSettings {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.state = {
            users: [],
            availableRoles: []
        };
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.createForm = this.element.querySelector('[data-role="createForm"]');
        this.createRolesSelect = this.element.querySelector('[data-role="createRolesSelect"]');
        this.tableHost = this.element.querySelector('[data-role="tableHost"]');
        this.bindEvents();
        this.render();
    }

    bindEvents() {
        if (this.element.dataset.boundAdminUsersSettings) return;
        this.createForm?.addEventListener('submit', (event) => {
            event.preventDefault();
            this.submitCreateUser().catch((error) => this.emitError(error));
        });
        this.element.dataset.boundAdminUsersSettings = 'true';
    }

    setState(next = {}) {
        if (Array.isArray(next.users)) {
            this.state.users = next.users;
        }
        if (Array.isArray(next.availableRoles)) {
            this.state.availableRoles = next.availableRoles;
        }
        this.render();
    }

    render() {
        this.configureRoleSelect(this.createRolesSelect, []);
        this.renderUsers();
    }

    renderUsers() {
        if (!this.tableHost) return;
        const fragment = document.createDocumentFragment();
        const header = document.createElement('div');
        header.className = 'section-heading user-section-heading';
        header.innerHTML = '<h2>Manage users</h2>';
        fragment.appendChild(header);

        if (!this.state.users.length) {
            const empty = document.createElement('div');
            empty.className = 'empty';
            empty.textContent = 'No users.';
            fragment.appendChild(empty);
            this.tableHost.replaceChildren(fragment);
            return;
        }

        const table = document.createElement('table');
        table.innerHTML = `
            <thead>
                <tr>
                    <th>Username</th>
                    <th>Name</th>
                    <th>Roles</th>
                    <th>Password Reset</th>
                    <th></th>
                </tr>
            </thead>
            <tbody></tbody>
        `;
        const tbody = table.querySelector('tbody');
        for (const user of this.state.users) {
            const rowForm = document.createElement('form');
            rowForm.id = this.getUserFormId(user);
            rowForm.className = 'admin-user-row-form';
            rowForm.autocomplete = 'off';
            fragment.appendChild(rowForm);
            tbody.appendChild(this.createUserRow(user));
        }
        fragment.appendChild(table);
        this.tableHost.replaceChildren(fragment);
        this.tableHost.querySelectorAll('custom-select[data-field="roles"]').forEach((select) => {
            const row = select.closest('tr[data-user-id]');
            const user = this.state.users.find((entry) => String(entry.id) === String(row?.dataset.userId));
            this.configureRoleSelect(select, user?.roles || []);
        });
    }

    createUserRow(user) {
        const tr = document.createElement('tr');
        tr.dataset.userId = user.id;
        const formId = escapeAttr(this.getUserFormId(user));
        tr.innerHTML = `
            <td data-label="Username"><input class="form-input" form="${formId}" data-field="username" value="${escapeAttr(user.username)}"></td>
            <td data-label="Name"><input class="form-input" form="${formId}" data-field="name" value="${escapeAttr(user.name || '')}"></td>
            <td data-label="Roles">
                <custom-select data-presenter="custom-select" data-field="roles"></custom-select>
            </td>
            <td data-label="Password"><span class="password-field">
                <input class="form-input" form="${formId}" data-field="password" type="password" autocomplete="new-password" placeholder="Leave unchanged">
                <button type="button" class="password-toggle" data-local-action="togglePasswordVisibility" aria-label="Show password" title="Show password" aria-pressed="false">
                    <img src="/explorer/assets/icons/eye.svg" alt="">
                </button>
            </span></td>
            <td data-label="Actions"><div class="actions">
                <button type="button" class="general-button" data-local-action="saveUserRow">Save</button>
                <button type="button" class="gray-button danger" data-local-action="deleteUserRow">Delete</button>
            </div></td>
        `;
        return tr;
    }

    getUserFormId(user) {
        return `admin-user-row-form-${String(user.id || '').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    }

    configureRoleSelect(select, selectedRoles = []) {
        if (!select) return;
        const options = this.state.availableRoles.map((role) => ({ value: role, label: role }));
        const selectedRole = this.getEffectiveRole(selectedRoles);
        select.setAttribute('data-options', encodeOptions(options));
        select.setAttribute('data-selected', selectedRole);
        if (select.webSkelPresenter?.setOptions) {
            select.webSkelPresenter.setOptions(options, selectedRole);
        } else if (select.presenterReadyPromise) {
            select.presenterReadyPromise.then(() => {
                select.webSkelPresenter?.setOptions?.(options, selectedRole);
            }).catch(() => {});
        }
    }

    getEffectiveRole(roles = []) {
        const selectedRoles = parseRoles(roles);
        const elevatedRole = [...selectedRoles].reverse().find((role) => role !== 'user' && this.state.availableRoles.includes(role));
        if (elevatedRole) return elevatedRole;
        if (selectedRoles.includes('user') && this.state.availableRoles.includes('user')) return 'user';
        return selectedRoles.find((role) => this.state.availableRoles.includes(role)) || this.state.availableRoles[0] || '';
    }

    async getCustomSelectValue(select) {
        if (!select) return '';
        if (select.presenterReadyPromise) {
            await select.presenterReadyPromise.catch(() => {});
        }
        return String(select.value || select.getAttribute('data-selected') || '');
    }

    async getSelectedRoles(select) {
        return parseRoles(await this.getCustomSelectValue(select));
    }

    saveUserRow(button) {
        this.submitUserRowButton(button, 'save').catch((error) => this.emitError(error));
    }

    deleteUserRow(button) {
        this.submitUserRowButton(button, 'delete').catch((error) => this.emitError(error));
    }

    async submitUserRowButton(button, action) {
        const row = button?.closest?.('tr[data-user-id]');
        if (!row) return;
        await this.submitUserRowAction(row, action);
    }

    async submitCreateUser() {
        if (!this.createForm) return;
        const data = new FormData(this.createForm);
        const roles = await this.getSelectedRoles(this.createRolesSelect);
        this.dispatch('admin-users-create', {
            username: data.get('username'),
            password: data.get('password'),
            name: data.get('name'),
            roles
        });
    }

    async submitUserRowAction(row, action) {
        const userId = row.dataset.userId;
        if (!userId) return;
        if (action === 'delete') {
            this.dispatch('admin-users-delete', { userId });
            return;
        }
        if (action !== 'save') return;
        const body = {};
        for (const input of row.querySelectorAll('input[data-field], custom-select[data-field]')) {
            if (input.dataset.field === 'roles') {
                body.roles = await this.getSelectedRoles(input);
            } else if (input.dataset.field === 'password') {
                if (input.value) body.password = input.value;
            } else {
                body[input.dataset.field] = input.value;
            }
        }
        this.dispatch('admin-users-save', { userId, body });
    }

    togglePasswordVisibility(button) {
        const field = button.closest('.password-field');
        const input = field?.querySelector('input');
        if (!input) return;
        const shouldShow = input.type === 'password';
        input.type = shouldShow ? 'text' : 'password';
        const label = shouldShow ? 'Hide password' : 'Show password';
        button.setAttribute('aria-label', label);
        button.setAttribute('aria-pressed', shouldShow ? 'true' : 'false');
        button.title = label;
        input.focus();
    }

    emitError(error) {
        this.dispatch('admin-settings-error', { message: error?.message || 'Users settings failed.' });
    }

    dispatch(type, detail = {}) {
        this.element.dispatchEvent(new CustomEvent(type, {
            bubbles: true,
            detail
        }));
    }
}
