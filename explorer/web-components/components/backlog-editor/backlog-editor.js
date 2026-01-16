import { withGlobalLoader } from "../../../utils/globalLoader.js";
import { callExplorerTool, callAgentTool } from "../../../services/infrastructure/explorerApi.js";
import { createBacklogEditorService } from "./backlog-editor-service.js";

function safeParseJson(text) {
    try { return JSON.parse(text); } catch { return null; }
}

function extractToolMessage(raw) {
    const parsed = safeParseJson(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.message === 'string') {
        return parsed.message;
    }
    return raw;
}

function encodeAttribute(value) {
    if (typeof value !== 'string') return '';
    return encodeURIComponent(value);
}

export class BacklogEditor {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.path = this.element.dataset.path || '';
        this.state = {
            backlogContent: '',
            planItems: [],
            availableModels: [],
            selectedModel: '',
            statusMessage: '',
            statusError: false
        };
        this.boundPlanEvents = this.handlePlanEvent.bind(this);
        this.initialized = false;
        this.service = createBacklogEditorService({
            callTool: this.callTool.bind(this),
            callAgentTool: this.callAgentTool.bind(this)
        });
        this.invalidate();
    }

    callTool(name, args) {
        return callExplorerTool(name, args);
    }

    callAgentTool(agentName, name, args) {
        return callAgentTool(agentName, name, args);
    }

    async beforeRender() {
        this.planCount = `${this.state.planItems.length} items`;
        this.planItemsHTML = this.renderPlanItems();
        this.statusMessage = this.state.statusMessage || '';
        this.statusClass = this.state.statusError ? 'is-error' : '';
    }

    async afterRender() {
        this.bindEvents();
        if (!this.initialized) {
            this.initialized = true;
            await this.initialize();
        }
        const textarea = this.element.querySelector('#backlogContent');
        if (textarea && textarea.value !== this.state.backlogContent) {
            textarea.value = this.state.backlogContent;
        }
        this.renderModelOptions();
    }

    bindEvents() {
        const modelSelect = this.element.querySelector('#backlogModelSelect');
        if (modelSelect) {
            modelSelect.removeEventListener('change', this.boundModelChange);
            this.boundModelChange = () => {
                this.state.selectedModel = modelSelect.value || '';
            };
            modelSelect.addEventListener('change', this.boundModelChange);
        }
        const textarea = this.element.querySelector('#backlogContent');
        if (textarea) {
            textarea.removeEventListener('input', this.boundBacklogInput);
            this.boundBacklogInput = () => {
                this.state.backlogContent = textarea.value;
            };
            textarea.addEventListener('input', this.boundBacklogInput);
        }
        const planList = this.element.querySelector('.backlog-editor__plan-list');
        if (planList) {
            planList.removeEventListener('update-item', this.boundPlanEvents);
            planList.removeEventListener('regenerate-item', this.boundPlanEvents);
            planList.removeEventListener('accept-item', this.boundPlanEvents);
            planList.addEventListener('update-item', this.boundPlanEvents);
            planList.addEventListener('regenerate-item', this.boundPlanEvents);
            planList.addEventListener('accept-item', this.boundPlanEvents);
        }
    }

    async initialize() {
        await withGlobalLoader(async () => {
            await Promise.all([this.loadBacklogContent(), this.loadModels()]);
        });
    }

    async loadBacklogContent() {
        if (!this.path) return;
        try {
            const result = await this.service.readTextFile(this.path);
            this.state.backlogContent = result.text || '';
            this.invalidate();
        } catch (error) {
            this.setStatus(error?.message || 'Failed to load backlog.', true);
        }
    }

    async loadModels() {
        try {
            const raw = await this.service.getAvailableModels();
            const message = extractToolMessage(raw);
            const parsed = safeParseJson(message);
            const list = Array.isArray(parsed) ? parsed : [];
            this.state.availableModels = list;
            if (!this.state.selectedModel && list.length) {
                this.state.selectedModel = list[0];
            }
            this.invalidate();
        } catch (error) {
            this.setStatus(error?.message || 'Failed to load models.', true);
        }
    }

    renderModelOptions() {
        const select = this.element.querySelector('#backlogModelSelect');
        if (!select) return;
        const models = this.state.availableModels || [];
        if (!models.length) {
            select.innerHTML = '<option value="">No models available</option>';
            return;
        }
        select.innerHTML = models.map((name) => {
            const selected = name === this.state.selectedModel ? 'selected' : '';
            return `<option value="${name}" ${selected}>${name}</option>`;
        }).join('');
    }

    renderPlanItems() {
        if (!this.state.planItems.length) {
            return '<div class="plan-item__empty">No plan items yet.</div>';
        }
        return this.state.planItems.map((item) => {
            const id = encodeAttribute(String(item.id || ''));
            const description = encodeAttribute(String(item.description || ''));
            const status = encodeAttribute(String(item.status || 'proposed'));
            const filePath = encodeAttribute(String(item.filePath || ''));
            return `<plan-item data-presenter="plan-item" data-id="${id}" data-description="${description}" data-status="${status}" data-file-path="${filePath}"></plan-item>`;
        }).join('');
    }

    setStatus(message, isError) {
        this.state.statusMessage = message || '';
        this.state.statusError = Boolean(isError);
        this.invalidate();
    }

    getSelectedPlanItems() {
        return (this.state.planItems || []).filter((item) => item?.status === 'accepted' || item?.accepted === true);
    }

    async saveBacklog() {
        if (!this.path) return;
        await withGlobalLoader(async () => {
            try {
                await this.service.writeFile(this.path, this.state.backlogContent || '');
                this.setStatus('Backlog saved.', false);
            } catch (error) {
                this.setStatus(error?.message || 'Failed to save backlog.', true);
            }
        });
    }

    async analyzeBacklog() {
        const content = String(this.state.backlogContent || '').trim();
        if (!content) {
            this.setStatus('Backlog content is empty.', true);
            return;
        }
        await withGlobalLoader(async () => {
            try {
                const raw = await this.service.analyze(content, { filePath: this.path }, this.state.selectedModel);
                const message = extractToolMessage(raw);
                const parsed = safeParseJson(message);
                if (!Array.isArray(parsed)) {
                    throw new Error('Analyze returned invalid JSON.');
                }
                this.state.planItems = parsed;
                this.setStatus('Plan generated.', false);
            } catch (error) {
                this.setStatus(error?.message || 'Failed to analyze backlog.', true);
            }
        });
    }

    async reviewPlan() {
        const accepted = this.getSelectedPlanItems();
        if (!accepted.length) {
            this.setStatus('No accepted plan items to review.', true);
            return;
        }
        await withGlobalLoader(async () => {
            try {
                const reviewRaw = await this.service.reviewPlan(accepted, this.state.selectedModel);
                const review = extractToolMessage(reviewRaw);
                this.setStatus(review || 'Plan review completed.', false);
                await this.persistPlanToFile(accepted);
            } catch (error) {
                this.setStatus(error?.message || 'Failed to review plan.', true);
            }
        });
    }

    async executePlan() {
        const accepted = this.getSelectedPlanItems();
        if (!accepted.length) {
            this.setStatus('No accepted plan items to execute.', true);
            return;
        }
        await withGlobalLoader(async () => {
            try {
                const resultRaw = await this.service.executePlan(accepted, this.state.selectedModel);
                const message = extractToolMessage(resultRaw);
                const parsed = safeParseJson(message) || {};
                if (parsed?.ok) {
                    this.setStatus('Plan executed.', false);
                } else {
                    this.setStatus('Plan execution finished with warnings.', true);
                }
                await this.persistPlanToFile(accepted);
            } catch (error) {
                this.setStatus(error?.message || 'Failed to execute plan.', true);
            }
        });
    }

    async persistPlanToFile(planItems) {
        const accepted = Array.isArray(planItems) ? planItems : [];
        const lines = ['# Backlog Plan', ''];
        if (!accepted.length) {
            lines.push('No accepted plan items.');
        } else {
            accepted.forEach((item) => {
                lines.push(`- ${item.description || ''}`);
            });
        }
        await this.service.writeFile('/backlogPlan.md', lines.join('\n'));
    }

    async handlePlanEvent(event) {
        const detail = event.detail || {};
        if (event.type === 'update-item') {
            this.updatePlanItem(detail.id, { description: detail.description });
            return;
        }
        if (event.type === 'accept-item') {
            this.updatePlanItem(detail.id, { status: 'accepted' });
            await this.persistPlanToFile(this.getSelectedPlanItems());
            return;
        }
        if (event.type === 'regenerate-item') {
            await this.regenerateItem(detail.id, detail.feedback || '');
        }
    }

    updatePlanItem(id, patch) {
        this.state.planItems = (this.state.planItems || []).map((item) => {
            if (item.id !== id) return item;
            return { ...item, ...patch };
        });
        this.invalidate();
    }

    async regenerateItem(id, feedback) {
        const item = (this.state.planItems || []).find((entry) => entry.id === id);
        if (!item) return;
        await withGlobalLoader(async () => {
            try {
                const raw = await this.service.regenerateItem(item, feedback, this.state.selectedModel);
                const message = extractToolMessage(raw);
                const parsed = safeParseJson(message);
                if (!parsed || typeof parsed !== 'object') {
                    throw new Error('Regenerate returned invalid JSON.');
                }
                this.updatePlanItem(id, parsed);
                this.setStatus('Item regenerated.', false);
            } catch (error) {
                this.setStatus(error?.message || 'Failed to regenerate item.', true);
            }
        });
    }
}
