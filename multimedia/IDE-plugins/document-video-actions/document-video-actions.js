const documentModule = assistOS.loadModule("document");
const llmModule = assistOS.loadModule("llm");

function parseContext(element) {
    const raw = element.getAttribute("data-context") || element.getAttribute("context") || "{}";
    try {
        return JSON.parse(decodeURIComponent(raw));
    } catch {
        return {};
    }
}

export class DocumentVideoActions {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.context = parseContext(element);
        this.documentPresenter = element.closest("document-view-page")?.webSkelPresenter
            || document.querySelector("document-view-page")?.webSkelPresenter
            || null;
        this.document = this.documentPresenter?._document || null;
        this.documentId = this.context.documentId || this.document?.id || "";
        this.documentTitle = this.document?.title || "document";
        this.taskId = "";
        this.taskStatus = "idle";
        this.statusText = "No video task started yet.";
        this.boundTaskStatus = null;
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.statusTextElement = this.element.querySelector('[data-role="status-text"]');
        this.taskIdElement = this.element.querySelector('[data-role="task-id"]');
        this.downloadButton = this.element.querySelector('[data-role="download-button"]');
        this.refreshStatusUi();
    }

    refreshStatusUi() {
        if (this.statusTextElement) {
            this.statusTextElement.textContent = this.statusText;
        }
        if (this.taskIdElement) {
            this.taskIdElement.textContent = this.taskId ? `Task ID: ${this.taskId}` : "";
        }
        if (this.downloadButton) {
            this.downloadButton.disabled = !(this.taskStatus === "completed" && this.taskId);
        }
    }

    async documentToVideo() {
        if (!this.documentId) {
            assistOS.showToast("Document context missing.", "error");
            return;
        }
        try {
            this.taskStatus = "running";
            this.statusText = "Starting video compilation...";
            this.refreshStatusUi();

            const taskId = await documentModule.documentToVideo(this.documentId);
            this.taskId = taskId;
            this.taskStatus = "running";
            this.statusText = "Video compilation in progress.";
            this.refreshStatusUi();

            assistOS.watchTask?.(taskId);
            this.boundTaskStatus = this.onTaskStatus.bind(this, taskId);
            await assistOS.NotificationRouter.subscribeToWorkspace?.(taskId, this.boundTaskStatus);
        } catch (error) {
            console.error("documentToVideo failed", error);
            this.taskStatus = "failed";
            this.statusText = error?.message ? `Video compilation failed: ${error.message}` : "Video compilation failed.";
            this.refreshStatusUi();
            assistOS.showToast("Failed to start video compilation.", "error");
        }
    }

    onTaskStatus(taskId, statusOrPayload) {
        const status = typeof statusOrPayload === "string"
            ? statusOrPayload
            : statusOrPayload?.status || "";

        if (!status) {
            return;
        }

        if (status === "completed") {
            this.taskId = taskId;
            this.taskStatus = "completed";
            this.statusText = "Video compilation completed.";
            this.refreshStatusUi();
            return;
        }

        if (status === "failed" || status === "error") {
            this.taskId = taskId;
            this.taskStatus = "failed";
            this.statusText = "Video compilation failed.";
            this.refreshStatusUi();
            return;
        }

        this.taskId = taskId;
        this.taskStatus = status;
        this.statusText = `Task status: ${status}`;
        this.refreshStatusUi();
    }

    executeDownload() {
        if (!this.taskId) {
            assistOS.showToast("No completed video task available.", "info");
            return;
        }
        const url = `/documents/video/${this.taskId}`;
        const a = document.createElement("a");
        a.style.display = "none";
        a.href = url;
        a.download = `${assistOS.UI.unsanitize(this.documentTitle)}.mp4`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    async lipsyncVideo() {
        try {
            await llmModule.lipsync("sync-1.6.0", {});
            assistOS.showToast("Lipsync task started.", "success");
        } catch (error) {
            console.error("lipsync failed", error);
            assistOS.showToast("Failed to start lipsync.", "error");
        }
    }

    closeModal() {
        assistOS.UI.closeModal(this.element);
    }
}
