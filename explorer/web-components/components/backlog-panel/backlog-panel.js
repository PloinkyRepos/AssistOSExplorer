import { callAgentTool, parseToolResult } from "../../../services/infrastructure/explorerApi.js";
import { withGlobalLoader } from "../../../utils/globalLoader.js";
import { getReposRoot } from "../../../utils/reposRoot.js";

export class BacklogPanel {
    constructor(element, invalidate, props = {}) {
        this.element = element;
        this.invalidate = invalidate;
        this.props = props || {};
        this.reposRoot = getReposRoot();
        this.state = {
            config: null,
            repos: [],
            tasks: [],
            filters: {
                repoPath: '',
                status: '',
                type: '',
                priority: '',
                assignee: '',
                tag: '',
                q: ''
            },
            error: ''
        };
        this.invalidate();
    }

    beforeRender() {}

    async afterRender() {
        this.cacheElements();
        this.bindEvents();
        this.mountFiltersInHeader();
        await this.refreshAll();
    }

    cacheElements() {
        this.errorBox = this.element.querySelector('#backlogError');
        this.filtersContainer = this.element.querySelector('#backlogFilters');
        this.repoFilter = this.element.querySelector('#backlogRepoFilter');
        this.statusFilter = this.element.querySelector('#backlogStatusFilter');
        this.typeFilter = this.element.querySelector('#backlogTypeFilter');
        this.priorityFilter = this.element.querySelector('#backlogPriorityFilter');
        this.assigneeFilter = this.element.querySelector('#backlogAssigneeFilter');
        this.tagFilter = this.element.querySelector('#backlogTagFilter');
        this.searchFilter = this.element.querySelector('#backlogSearchFilter');
        this.list = this.element.querySelector('#backlogList');
        this.empty = this.element.querySelector('#backlogEmpty');
    }

    mountFiltersInHeader() {
        if (!this.filtersContainer) return;
        const headerExtras = document.querySelector('#previewHeaderExtras');
        if (!headerExtras) return;
        const existing = headerExtras.querySelector('.backlog-filters');
        if (existing && existing !== this.filtersContainer) {
            existing.remove();
        }
        if (headerExtras.contains(this.filtersContainer)) return;
        headerExtras.appendChild(this.filtersContainer);
    }

    bindEvents() {
        if (!this.element.dataset.boundBacklogPanel) {
            this.element.addEventListener('backlog-task-save', (event) => {
                this.saveTask(event?.detail || {});
            });
            this.element.addEventListener('backlog-task-delete', (event) => {
                this.deleteTask(event?.detail || {});
            });
            if (!window.__backlogCreateBound) {
                window.addEventListener('backlog-task-create', (event) => {
                    this.createBacklogTask(event?.detail || {});
                });
                window.__backlogCreateBound = true;
            }
            this.element.dataset.boundBacklogPanel = 'true';
        }

        this.bindFilterInput(this.repoFilter, 'repoPath');
        this.bindFilterInput(this.statusFilter, 'status');
        this.bindFilterInput(this.typeFilter, 'type');
        this.bindFilterInput(this.priorityFilter, 'priority');
        this.bindFilterInput(this.assigneeFilter, 'assignee');
        this.bindFilterInput(this.tagFilter, 'tag');
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
            await this.loadRepos();
            await this.loadTasks();
        });
    }

    async loadConfig() {
        try {
            const payload = await this.callTasksTool('task_config', {});
            this.state.config = payload?.config || null;
            this.clearError();
            this.renderSelectOptions();
        } catch (error) {
            this.setError(`Backlog config error: ${error?.message || error}`);
        }
    }

    async loadRepos() {
        try {
            const payload = await this.callAgentToolRaw('gitAgent', 'git_repos_overview', { path: this.reposRoot });
            const repos = Array.isArray(payload?.repos) ? payload.repos : [];
            this.state.repos = repos.map((repo) => ({
                path: repo?.path || '',
                name: repo?.name || repo?.relativePath || repo?.path || ''
            })).filter((repo) => repo.path);
            this.clearError();
            this.renderSelectOptions();
        } catch (error) {
            this.setError(`Repo list error: ${error?.message || error}`);
        }
    }

    async loadTasks() {
        try {
            const args = {};
            const filters = this.state.filters;
            if (filters.repoPath) args.repoPath = filters.repoPath;
            if (filters.status) args.status = filters.status;
            if (filters.type) args.type = filters.type;
            if (filters.priority) args.priority = filters.priority;
            if (filters.assignee) args.assignee = filters.assignee;
            if (filters.tag) args.tag = filters.tag;
            if (filters.q) args.q = filters.q;
            const payload = await this.callTasksTool('task_list', args);
            this.state.tasks = Array.isArray(payload?.tasks) ? payload.tasks : [];
            this.clearError();
            this.renderTasks();
        } catch (error) {
            this.setError(`Task list error: ${error?.message || error}`);
        }
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
        const repos = this.state.repos || [];

        if (this.repoFilter) {
            this.repoFilter.innerHTML = '';
            this.repoFilter.appendChild(new Option('All', ''));
            for (const repo of repos) {
                this.repoFilter.appendChild(new Option(repo.name || repo.path, repo.path));
            }
            if (this.state.filters.repoPath) {
                this.repoFilter.value = this.state.filters.repoPath;
            }
        }
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
            return;
        }
        if (this.empty) this.empty.style.display = 'none';
        const statuses = this.state.config?.statuses || {};
        const priorities = this.state.config?.priorities || {};
        const types = this.state.config?.types || {};
        const repos = this.state.repos || [];
        for (const task of tasks) {
            const row = document.createElement('backlog-task-row');
            row.setAttribute('data-presenter', 'backlog-task-row');
            row.setAttribute('data-task', encodeURIComponent(JSON.stringify(task)));
            row.setAttribute('data-statuses', encodeURIComponent(JSON.stringify(statuses)));
            row.setAttribute('data-priorities', encodeURIComponent(JSON.stringify(priorities)));
            row.setAttribute('data-types', encodeURIComponent(JSON.stringify(types)));
            row.setAttribute('data-repos', encodeURIComponent(JSON.stringify(repos)));
            this.list.appendChild(row);
        }
    }

    async createBacklogTask(payload = {}) {
        const description = String(payload.description || '').trim();
        if (!description) {
            this.setError('Description is required.');
            return;
        }
        const request = {
            description,
            type: payload.type || '',
            observations: payload.observations || '',
            repoPath: payload.repoPath || '',
            status: payload.status || '',
            priority: payload.priority || '',
            assignee: payload.assignee || '',
            tags: Array.isArray(payload.tags) ? payload.tags : []
        };
        await withGlobalLoader(async () => {
            await this.callTasksTool('task_create', request);
            await this.loadTasks();
        });
    }

    async saveTask(payload) {
        if (!payload?.id) return;
        await withGlobalLoader(async () => {
            await this.callTasksTool('task_update', payload);
            await this.loadTasks();
        });
    }

    async deleteTask(payload) {
        const id = payload?.id;
        if (!id) return;
        const ok = window.confirm('Delete this task?');
        if (!ok) return;
        await withGlobalLoader(async () => {
            await this.callTasksTool('task_delete', { id });
            await this.loadTasks();
        });
    }

    async refreshBacklog(button) {
        if (button) button.disabled = true;
        await this.refreshAll();
        if (button) button.disabled = false;
    }

    openCreateTaskModal() {
        const config = this.state.config || {};
        const repos = this.state.repos || [];
        assistOS.UI.createReactiveModal('backlog-create-modal', {
            repos: encodeURIComponent(JSON.stringify(repos)),
            statuses: encodeURIComponent(JSON.stringify(config.statuses || {})),
            priorities: encodeURIComponent(JSON.stringify(config.priorities || {})),
            types: encodeURIComponent(JSON.stringify(config.types || {})),
            defaultStatus: config.defaultStatus || '',
            defaultPriority: config.defaultPriority || '',
            defaultType: config.defaultType || ''
        });
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
}
