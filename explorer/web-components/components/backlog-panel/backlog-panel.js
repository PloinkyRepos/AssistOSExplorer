import { callAgentTool, parseToolResult } from "../../../services/infrastructure/explorerApi.js";
import { withGlobalLoader } from "../../../utils/globalLoader.js";
import { getWorkspaceRoot } from "../../../utils/workspaceRoot.js";
import { normalizeGitStatusPayload, normalizeRepoPath } from "../../modals/git-commit-modal/git-commit-modal-utils.js";

export class BacklogPanel {
    constructor(element, invalidate, props = {}) {
        this.element = element;
        this.invalidate = invalidate;
        this.props = props || {};
        this.workspaceRoot = getWorkspaceRoot();
        this.repoPath = '';
        this.state = {
            config: null,
            tasks: [],
            conflict: false,
            filters: {
                status: '',
                type: '',
                priority: '',
                q: ''
            },
            error: ''
        };
        this.invalidate();
    }

    beforeRender() {}

    async afterRender() {
        this.cacheElements();
        this.bindFilterEvents();
        this.mountFiltersInHeader();
        await this.refreshAll();
    }

    afterUnload() {
    }

    cacheElements() {
        this.errorBox = this.element.querySelector('#backlogError');
        this.conflictBox = this.element.querySelector('#backlogConflict');
        this.header = this.element.querySelector('#backlogHeader');
        this.filtersContainer = this.element.querySelector('#backlogFilters');
        this.statusFilter = this.element.querySelector('#backlogStatusFilter');
        this.typeFilter = this.element.querySelector('#backlogTypeFilter');
        this.priorityFilter = this.element.querySelector('#backlogPriorityFilter');
        this.searchFilter = this.element.querySelector('#backlogSearchFilter');
        this.list = this.element.querySelector('#backlogList');
        this.empty = this.element.querySelector('#backlogEmpty');
        this.carouselInfo = this.element.querySelector('#backlogCarouselInfo');
        this.state.currentIndex = this.state.currentIndex || 0;
        this.workspaceRoot = getWorkspaceRoot();
        this.repoPath = String(this.element.getAttribute('data-repo-path') || '').trim();
        if (!this.repoPath) {
            const pathAttr = String(this.element.getAttribute('data-path') || '').trim();
            if (pathAttr) {
                this.repoPath = this.parentPath(pathAttr);
            }
        }
        this.repoPath = this.normalizeRepoPath(this.repoPath);
    }

    mountFiltersInHeader() {
        if (!this.filtersContainer || !this.header) return;
        const headerExtras = document.querySelector('#previewHeaderExtras');
        if (!headerExtras) return;
        const existingHeader = headerExtras.querySelector('#backlogHeader');
        if (existingHeader && existingHeader !== this.header) {
            existingHeader.remove();
        }
        const existingFilters = headerExtras.querySelector('.backlog-filters');
        if (existingFilters && existingFilters !== this.filtersContainer) {
            existingFilters.remove();
        }
        if (!headerExtras.contains(this.header)) {
            headerExtras.appendChild(this.header);
        }
        if (!headerExtras.contains(this.filtersContainer)) {
            headerExtras.appendChild(this.filtersContainer);
        }
        this.header.webSkelPresenter = this;
        this.filtersContainer.webSkelPresenter = this;
    }

    bindFilterEvents() {
        this.bindFilterInput(this.statusFilter, 'status');
        this.bindFilterInput(this.typeFilter, 'type');
        this.bindFilterInput(this.priorityFilter, 'priority');
        this.bindFilterInput(this.searchFilter, 'q');
    }

    bindFilterInput(element, key) {
        if (!element || element.dataset.boundBacklogFilter) return;
        const handler = async (event) => {
            const value = event?.target?.value ?? '';
            this.state.filters[key] = value;
            await this.loadTasks();
        };
        element.addEventListener('input', handler);
        element.addEventListener('change', handler);
        element.dataset.boundBacklogFilter = 'true';
    }

    async refreshAll() {
        await withGlobalLoader(async () => {
            await this.loadConfig();
            await this.checkBacklogConflict();
            if (!this.state.conflict) {
                await this.loadTasks();
            } else {
                this.state.tasks = [];
                this.renderTasks();
            }
        });
    }

    async loadConfig() {
        try {
            const payload = await this.callTasksTool('task_config', { repoPath: this.repoPath });
            this.state.config = payload?.config || null;
            this.clearError();
            this.renderSelectOptions();
        } catch (error) {
            this.setError(`Backlog config error: ${error?.message || error}`);
        }
    }

    async loadTasks() {
        try {
            if (this.state.conflict) {
                this.state.tasks = [];
                this.renderTasks();
                return;
            }
            const args = {};
            const filters = this.state.filters;
            if (filters.status) args.status = filters.status;
            if (filters.type) args.type = filters.type;
            if (filters.priority) args.priority = filters.priority;
            if (filters.q) args.q = filters.q;
            const payload = await this.callTasksTool('task_list', { ...args, repoPath: this.repoPath });
            this.state.tasks = Array.isArray(payload?.tasks) ? payload.tasks : [];
            this.clearError();
            this.renderTasks();
        } catch (error) {
            this.setError(`Task list error: ${error?.message || error}`);
        }
    }

    async checkBacklogConflict() {
        let conflict = false;
        try {
            const payload = await this.callAgentToolRaw('gitAgent', 'git_status', { path: this.repoPath || this.workspaceRoot });
            const conflicted = Array.isArray(payload?.status?.conflicted) ? payload.status.conflicted : [];
            conflict = conflicted.some((entry) => String(entry || '') === '.backlog' || String(entry || '').endsWith('/.backlog'));
        } catch {
            conflict = false;
        }
        this.state.conflict = conflict;
        this.updateConflictUI();
    }

    async callTasksTool(name, args) {
        const raw = await callAgentTool('tasksAgent', name, args || {}, { raw: true });
        const parsed = parseToolResult(raw);
        return parsed || {};
    }

    async callAgentToolRaw(agentName, toolName, args) {
        const raw = await callAgentTool(agentName, toolName, args || {}, { raw: true });
        const parsed = parseToolResult(raw);
        return parsed || {};
    }

    renderSelectOptions() {
        const config = this.state.config || {};
        const statuses = Object.entries(config.statuses || {});
        const priorities = Object.entries(config.priorities || {});
        const types = Object.entries(config.types || {});
        if (this.statusFilter) {
            this.statusFilter.innerHTML = '';
            this.statusFilter.appendChild(new Option('All', ''));
            for (const [key, label] of statuses) {
                this.statusFilter.appendChild(new Option(label, key));
            }
            if (this.state.filters.status) {
                this.statusFilter.value = this.state.filters.status;
            }
        }
        if (this.typeFilter) {
            this.typeFilter.innerHTML = '';
            this.typeFilter.appendChild(new Option('All', ''));
            for (const [key, label] of types) {
                this.typeFilter.appendChild(new Option(label, key));
            }
            if (this.state.filters.type) {
                this.typeFilter.value = this.state.filters.type;
            }
        }
        if (this.priorityFilter) {
            this.priorityFilter.innerHTML = '';
            this.priorityFilter.appendChild(new Option('All', ''));
            for (const [key, label] of priorities) {
                this.priorityFilter.appendChild(new Option(label, key));
            }
            if (this.state.filters.priority) {
                this.priorityFilter.value = this.state.filters.priority;
            }
        }

    }

    renderTasks() {
        if (!this.list) return;
        this.list.innerHTML = '';
        const tasks = Array.isArray(this.state.tasks) ? this.state.tasks : [];
        if (!tasks.length) {
            if (this.empty) this.empty.style.display = 'block';
            if (this.carouselInfo) this.carouselInfo.textContent = '0 / 0';
            return;
        }
        if (this.empty) this.empty.style.display = 'none';
        if (this.state.currentIndex >= tasks.length) {
            this.state.currentIndex = Math.max(0, tasks.length - 1);
        }
        const statuses = this.state.config?.statuses || {};
        const priorities = this.state.config?.priorities || {};
        const types = this.state.config?.types || {};
        const task = tasks[this.state.currentIndex];
        if (!task) return;
        const row = document.createElement('backlog-task-row');
        row.setAttribute('data-presenter', 'backlog-task-row');
        row.setAttribute('data-task', encodeURIComponent(JSON.stringify(task)));
        row.setAttribute('data-statuses', encodeURIComponent(JSON.stringify(statuses)));
        row.setAttribute('data-priorities', encodeURIComponent(JSON.stringify(priorities)));
        row.setAttribute('data-types', encodeURIComponent(JSON.stringify(types)));
        this.list.appendChild(row);
        if (this.carouselInfo) {
            this.carouselInfo.textContent = `${this.state.currentIndex + 1} / ${tasks.length}`;
        }
    }

    prevTask() {
        if (!Array.isArray(this.state.tasks) || !this.state.tasks.length) return;
        this.state.currentIndex = Math.max(0, this.state.currentIndex - 1);
        this.renderTasks();
    }

    nextTask() {
        if (!Array.isArray(this.state.tasks) || !this.state.tasks.length) return;
        this.state.currentIndex = Math.min(this.state.tasks.length - 1, this.state.currentIndex + 1);
        this.renderTasks();
    }

    async createBacklogTask(payload = {}) {
        if (this.state.conflict) {
            this.setError('Resolve .backlog conflicts before editing.');
            return;
        }
        const description = String(payload.description || '').trim();
        if (!description) {
            this.setError('Description is required.');
            return;
        }
        const request = {
            description,
            proposedSolution: payload.proposedSolution || '',
            type: payload.type || '',
            observations: payload.observations || '',
            status: payload.status || '',
            priority: payload.priority || '',
            updatedBy: this.getCurrentUser(),
            repoPath: this.repoPath
        };
        await withGlobalLoader(async () => {
            await this.callTasksTool('task_create', request);
            await this.commitBacklog('Add backlog task');
            await this.loadTasks();
        });
    }

    async saveTask(payload) {
        if (!payload?.id) return;
        if (this.state.conflict) {
            this.setError('Resolve .backlog conflicts before editing.');
            return;
        }
        await withGlobalLoader(async () => {
            await this.callTasksTool('task_update', { ...payload, updatedBy: this.getCurrentUser(), repoPath: this.repoPath });
            await this.commitBacklog('Update backlog task');
            await this.loadTasks();
        });
    }

    async updateTaskStatus(payload) {
        const id = payload?.id;
        const status = payload?.status;
        if (!id || !status) return;
        if (this.state.conflict) {
            this.setError('Resolve .backlog conflicts before editing.');
            return;
        }
        await withGlobalLoader(async () => {
            await this.callTasksTool('task_update', {
                id,
                status,
                description: payload.description,
                proposedSolution: payload.proposedSolution,
                observations: payload.observations,
                type: payload.type,
                priority: payload.priority,
                updatedBy: this.getCurrentUser(),
                repoPath: this.repoPath
            });
            await this.commitBacklog('Update backlog status');
            await this.loadTasks();
        });
    }

    async deleteTask(payload) {
        const id = payload?.id;
        if (!id) return;
        if (this.state.conflict) {
            this.setError('Resolve .backlog conflicts before editing.');
            return;
        }
        const ok = window.confirm('Delete this task?');
        if (!ok) return;
        await withGlobalLoader(async () => {
            try {
                await this.callTasksTool('task_delete', { id, repoPath: this.repoPath });
                await this.commitBacklog('Delete backlog task');
            } catch (error) {
                const message = String(error?.message || error);
                if (!message.includes('Task not found')) {
                    throw error;
                }
            } finally {
                await this.loadTasks();
            }
        });
    }

    async refreshBacklog(button) {
        if (button) button.disabled = true;
        await this.refreshAll();
        if (button) button.disabled = false;
    }

    async openCreateTaskModal() {
        if (this.state.conflict) {
            this.setError('Resolve .backlog conflicts before editing.');
            return;
        }
        if (!this.state.config || !Object.keys(this.state.config.statuses || {}).length) {
            await this.loadConfig();
        }
        const config = this.state.config || {};
        const payload = await assistOS.UI.createReactiveModal('backlog-create-modal', {
            statuses: encodeURIComponent(JSON.stringify(config.statuses || {})),
            priorities: encodeURIComponent(JSON.stringify(config.priorities || {})),
            types: encodeURIComponent(JSON.stringify(config.types || {})),
            defaultStatus: config.defaultStatus || '',
            defaultPriority: config.defaultPriority || '',
            defaultType: config.defaultType || ''
        }, true);
        if (payload) {
            await this.createBacklogTask(payload);
        }
    }

    setError(message) {
        this.state.error = String(message || 'Unknown error');
        if (this.errorBox) {
            this.errorBox.textContent = this.state.error;
            this.errorBox.classList.add('is-visible');
        }
    }

    clearError() {
        this.state.error = '';
        if (this.errorBox) {
            this.errorBox.textContent = '';
            this.errorBox.classList.remove('is-visible');
        }
    }

    updateConflictUI() {
        if (this.conflictBox) {
            this.conflictBox.classList.toggle('is-visible', this.state.conflict);
        }
        const disabled = Boolean(this.state.conflict);
        const inputs = this.element.querySelectorAll('input, select, textarea, button');
        for (const input of inputs) {
            if (input.closest('.backlog-actions')) continue;
            if (input.closest('.backlog-create-actions')) continue;
            input.disabled = disabled;
        }
        const createButton = this.element.querySelector('.backlog-create-actions button');
        if (createButton) createButton.disabled = disabled;
    }

    getCurrentUser() {
        const email = window?.assistOS?.user?.email;
        return typeof email === 'string' ? email.trim() : '';
    }

    parentPath(value) {
        const normalized = String(value || '').replace(/\\/g, '/').replace(/\/+$/g, '');
        if (!normalized || normalized === '/') return '/';
        const parts = normalized.split('/');
        parts.pop();
        const next = parts.join('/') || '/';
        return next;
    }

    normalizeRepoPath(value) {
        const root = this.workspaceRoot || getWorkspaceRoot();
        return normalizeRepoPath(value, root);
    }


    async commitBacklog(message) {
        try {
            const status = await this.callAgentToolRaw('gitAgent', 'git_status', { path: this.repoPath || this.workspaceRoot });
            const normalized = normalizeGitStatusPayload(status?.status || status);
            const changed = normalized.paths.unstaged
                .concat(normalized.paths.staged, normalized.paths.untracked);
            const hasBacklog = changed.some((entry) => entry === '.backlog' || entry.endsWith('/.backlog'));
            if (!hasBacklog) return;
            await this.callAgentToolRaw('gitAgent', 'git_stage', { path: this.repoPath || this.workspaceRoot, files: ['.backlog'] });
            await this.callAgentToolRaw('gitAgent', 'git_commit', {
                path: this.repoPath || this.workspaceRoot,
                message: message || 'Update backlog',
                userEmail: this.getCurrentUser() || null
            });
        } catch (error) {
            const msg = String(error?.message || error);
            if (!msg.toLowerCase().includes('nothing to commit')) {
                this.setError(`Backlog commit failed: ${msg}`);
            }
        }
    }
}
