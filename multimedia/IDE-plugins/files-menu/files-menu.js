import { getContextualElement } from "../utils/pluginUtils.js";

const workspaceModule = assistOS.loadModule("workspace");
const documentModule = assistOS.loadModule("document");

export class FilesMenu {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.paragraphPresenter = null;
        this.commandsEditor = null;
        this.contextPayload = this.readContextPayload();

        this._document = null;
        this.chapter = null;
        this.paragraph = null;
        this.paragraphId = "";

        this.hydrateContextFromElement();
        if (!this.paragraph) {
            this.hydrateContextFromSelection();
        }

        this.bindParagraphPresenter();
        this.invalidate();
    }

    beforeRender() {
        this.filesHTML = '<div class="files-empty-state">No files uploaded yet.</div>';
    }

    async afterRender() {
        this.filesListElement = this.element.querySelector(".files-list");
        this.fileInput = this.element.querySelector(".file-input");
        this.resetFileInputListener();
        await this.renderFiles();
    }

    readContextPayload() {
        const rawContext = this.element.getAttribute("data-context") || this.element.getAttribute("context") || "{}";
        try {
            return JSON.parse(decodeURIComponent(rawContext));
        } catch {
            return {};
        }
    }

    hydrateContextFromElement() {
        try {
            const { document, chapter, paragraph } = getContextualElement(this.element);
            this._document = document;
            this.chapter = chapter;
            this.paragraph = paragraph;
            this.paragraphId = paragraph?.id || this.contextPayload?.paragraphId || "";
        } catch (error) {
            console.error("FilesMenu context unavailable", error);
        }
    }

    hydrateContextFromSelection() {
        const docPage = document.querySelector("document-view-page");
        const docPresenter = docPage?.webSkelPresenter;
        const doc = docPresenter?._document;
        if (!doc || !Array.isArray(doc.chapters)) {
            return;
        }

        const chapterId = this.contextPayload?.chapterId || assistOS?.workspace?.currentChapterId || "";
        const paragraphId = this.contextPayload?.paragraphId || assistOS?.workspace?.currentParagraphId || "";
        const chapter = doc.chapters.find((item) => item.id === chapterId) || null;
        const paragraph = chapter?.paragraphs?.find((item) => item.id === paragraphId) || null;

        this._document = doc;
        this.chapter = chapter;
        this.paragraph = paragraph;
        this.paragraphId = paragraph?.id || paragraphId || "";
    }

    bindParagraphPresenter() {
        const hostSelector = this.contextPayload?.hostSelector;
        let paragraphElement = null;

        if (typeof hostSelector === "string" && hostSelector.trim()) {
            paragraphElement = document.querySelector(hostSelector.trim());
        }
        if (!paragraphElement && this.paragraphId) {
            paragraphElement = document.querySelector(`paragraph-item[data-paragraph-id="${this.paragraphId}"]`);
        }

        this.paragraphPresenter = paragraphElement?.webSkelPresenter || null;
        this.commandsEditor = this.paragraphPresenter?.commandsEditor || null;
        return Boolean(this.paragraphPresenter);
    }

    ensureParagraphContext() {
        if (this.chapter && this.paragraph) {
            return true;
        }
        this.hydrateContextFromSelection();
        if (!this.chapter || !this.paragraph) {
            return false;
        }
        if (!this.paragraphPresenter) {
            this.bindParagraphPresenter();
        }
        return true;
    }

    refreshParagraphReference() {
        if (!this._document || !this.chapter?.id || !this.paragraphId) {
            return;
        }
        const chapter = this._document.chapters?.find((item) => item.id === this.chapter.id);
        if (!chapter) {
            return;
        }
        this.chapter = chapter;
        const paragraph = chapter.paragraphs?.find((item) => item.id === this.paragraphId);
        if (paragraph) {
            this.paragraph = paragraph;
        }
    }

    getFiles() {
        this.refreshParagraphReference();
        return Array.isArray(this.paragraph?.commands?.files) ? this.paragraph.commands.files : [];
    }

    async renderFiles() {
        if (!this.filesListElement) {
            return;
        }
        const files = this.getFiles();
        if (!files.length) {
            this.filesListElement.innerHTML = '<div class="files-empty-state">No files uploaded yet.</div>';
            return;
        }
        this.filesListElement.innerHTML = files.map((file) => this.renderFileItem(file)).join("");
    }

    renderFileItem(file) {
        const sanitize = (value) => typeof assistOS?.UI?.sanitize === "function" ? assistOS.UI.sanitize(value) : value;
        const escapeAttr = (value) => {
            if (value === undefined || value === null) {
                return "";
            }
            return String(value).replace(/"/g, "&quot;");
        };
        const id = file?.id || "";
        const name = sanitize(file?.name || id || "Untitled file");
        const type = sanitize(file?.type || "unknown");
        const size = this.formatFileSize(file?.size);
        const idAttr = escapeAttr(id);
        const downloadAction = escapeAttr(`downloadFile ${id}`);
        const deleteAction = escapeAttr(`deleteFile ${id}`);

        return `
        <div class="file-item" data-file-id="${idAttr}">
            <div class="file-item-header">
                <div class="file-item-title" title="${escapeAttr(name)}">${name}</div>
                <div class="file-item-size">${size}</div>
            </div>
            <div class="file-item-meta">Type: ${type}</div>
            <div class="file-item-actions">
                <button class="general-button" type="button" data-local-action="${downloadAction}">Download</button>
                <button class="general-button danger" type="button" data-local-action="${deleteAction}">Delete</button>
            </div>
        </div>`;
    }

    async insertFile() {
        if (!this.ensureParagraphContext()) {
            assistOS.showToast("Paragraph context missing, please reopen the plugin.", "error");
            return;
        }

        try {
            if (this.commandsEditor && typeof this.commandsEditor.insertAttachmentCommand === "function") {
                await this.commandsEditor.insertAttachmentCommand("files");
                await this.renderFiles();
                return;
            }
            if (!this.fileInput) {
                throw new Error("File input unavailable.");
            }
            this.fileInput.click();
        } catch (error) {
            console.error("Failed to insert file", error);
            assistOS.showToast("Failed to insert file.", "error");
        }
    }

    resetFileInputListener() {
        if (!this.fileInput) {
            return;
        }
        this.fileInput.addEventListener("change", this.handleFileSelected.bind(this), { once: true });
    }

    async handleFileSelected(event) {
        const file = event?.target?.files?.[0];
        try {
            if (!file) {
                return;
            }
            if (!this.ensureParagraphContext()) {
                assistOS.showToast("Paragraph context missing, please reopen the plugin.", "error");
                return;
            }
            const uploadedId = await this.uploadViaWorkspace(file);
            await this.persistFileEntry(uploadedId, file);
            await this.renderFiles();
            assistOS.showToast("File uploaded.", "success");
        } catch (error) {
            console.error("Failed to upload file", error);
            assistOS.showToast("Failed to upload file.", "error");
        } finally {
            if (this.fileInput) {
                this.fileInput.value = "";
            }
            this.resetFileInputListener();
        }
    }

    async uploadViaWorkspace(file) {
        if (typeof workspaceModule?.putFile === "function") {
            const buffer = await file.arrayBuffer();
            const payload = new Uint8Array(buffer);
            const response = await workspaceModule.putFile(payload);
            if (typeof response === "string") {
                return response;
            }
            const id = response?.id || response?.fileId || response?.filename;
            if (typeof id === "string" && id) {
                return id;
            }
            throw new Error("Workspace putFile did not return a valid file id.");
        }
        throw new Error("File upload API is not available in this environment.");
    }

    async persistFileEntry(fileId, file) {
        if (!this.paragraph || !this.chapter) {
            throw new Error("Paragraph context is not available.");
        }
        if (!this.paragraph.commands || typeof this.paragraph.commands !== "object" || Array.isArray(this.paragraph.commands)) {
            this.paragraph.commands = {};
        }
        if (!Array.isArray(this.paragraph.commands.files)) {
            this.paragraph.commands.files = [];
        }

        const nextEntry = {
            id: fileId,
            name: file?.name || fileId,
            type: file?.type || "application/octet-stream",
            size: Number.isFinite(file?.size) ? file.size : 0
        };

        this.paragraph.commands.files.push(nextEntry);
        await documentModule.updateParagraphCommands(this.chapter.id, this.paragraph.id, this.paragraph.commands);
    }

    async deleteFile(_targetElement, fileId) {
        if (!this.ensureParagraphContext()) {
            assistOS.showToast("Paragraph context missing, please reopen the plugin.", "error");
            return;
        }
        if (!fileId) {
            return;
        }
        try {
            if (this.commandsEditor && typeof this.commandsEditor.deleteCommand === "function") {
                await this.commandsEditor.deleteCommand("files", fileId);
                await this.renderFiles();
                assistOS.showToast("File removed.", "info");
                return;
            }
            if (!this.paragraph.commands || typeof this.paragraph.commands !== "object" || Array.isArray(this.paragraph.commands)) {
                this.paragraph.commands = {};
            }
            const currentFiles = Array.isArray(this.paragraph.commands.files) ? this.paragraph.commands.files : [];
            this.paragraph.commands.files = currentFiles.filter((item) => item?.id !== fileId);
            await documentModule.updateParagraphCommands(this.chapter.id, this.paragraph.id, this.paragraph.commands);
            await this.renderFiles();
            assistOS.showToast("File removed.", "info");
        } catch (error) {
            console.error("Failed to delete file", error);
            assistOS.showToast("Failed to delete file.", "error");
        }
    }

    async downloadFile(_targetElement, fileId) {
        const files = this.getFiles();
        const file = files.find((item) => item?.id === fileId);
        if (!file?.id) {
            assistOS.showToast("File not found.", "error");
            return;
        }

        try {
            if (typeof workspaceModule?.getFileURL !== "function") {
                throw new Error("Workspace getFileURL is not available.");
            }
            const downloadURL = await workspaceModule.getFileURL(file.id);
            const response = await fetch(downloadURL);
            if (!response.ok) {
                throw new Error(`HTTP error ${response.status}`);
            }
            const blob = await response.blob();
            const link = document.createElement("a");
            const blobUrl = URL.createObjectURL(blob);
            link.href = blobUrl;
            link.download = file.name || "download";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(blobUrl);
        } catch (error) {
            console.error("Failed to download file", error);
            assistOS.showToast("Failed to download file.", "error");
        }
    }

    async closeModal() {
        assistOS.UI.closeModal(this.element);
    }

    formatFileSize(bytes) {
        const size = Number(bytes);
        const units = ["Bytes", "KB", "MB", "GB"];
        if (!Number.isFinite(size) || size <= 0) {
            return "0 Bytes";
        }
        const unitIndex = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
        return `${(size / (1024 ** unitIndex)).toFixed(2)} ${units[unitIndex]}`;
    }
}
