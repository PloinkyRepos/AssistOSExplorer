import { getPreviewUiState } from "../../pages/file-exp/file-exp-preview-state.js";

export class FileExpPreview {
    constructor(element, invalidate, props = {}) {
        this.element = element;
        this.invalidate = invalidate;
        this.props = props || {};
        this.previewUiState = null;
        this.content = null;
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.content = this.element.querySelector('.preview-content');
        this.renderPreview(this.previewUiState);
    }

    beforeUnload() {
        this.content = null;
    }

    getHostPresenter() {
        return this.element.closest('file-exp')?.webSkelPresenter || null;
    }

    renderPreview(previewUiState) {
        this.previewUiState = previewUiState || null;
        if (!this.content) return;
        const host = this.getHostPresenter();
        if (!host || typeof host.renderPreviewPanel !== 'function') return;
        const effectiveUiState = this.previewUiState
            || getPreviewUiState(host.state || {});
        host.renderPreviewPanel(this.content, effectiveUiState);
    }

    setPreviewViewMode(target, mode) {
        return this.getHostPresenter()?.setPreviewViewMode?.(target, mode);
    }

    refreshWebPreviewPane() {
        return this.getHostPresenter()?.refreshWebPreviewPane?.();
    }

    openWebPreviewInTab() {
        return this.getHostPresenter()?.openWebPreviewInTab?.();
    }

    deleteDpuComment(target, commentId) {
        return this.getHostPresenter()?.deleteDpuComment?.(target, commentId);
    }
}
