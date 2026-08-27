import { getContextualElement } from "../utils/pluginUtils.js";
import { uploadBlobFile } from "../utils/blobUpload.js";
import { buildBlobUrl } from "../utils/blobUrl.js";

const documentModule = assistOS.loadModule("document");

export class FilesMenu {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.contextPayload = this.readContextPayload();

        this._document = null;
        this.chapter = null;
        this.paragraph = null;
        this.paragraphId = "";

        this.hydrateContextFromElement();
        if (!this.paragraph) {
            this.hydrateContextFromSelection();
        }

        this.invalidate();
    }

    beforeRender() {
        this.filesHTML = '<div class="files-empty-state">No files uploaded yet.</div>';
    }

    async afterRender() {
        this.filesListElement = this.element.querySelector(".files-list");
        this.fileInput = this.element.querySelector(".file-input");
        this.insertFileButton = this.element.querySelector('[data-local-action="insertFile"]');
        this.resetFileInputListener();
        await this.renderFiles();
    }

    setActionBusy(button, busy, busyLabel) {
        if (!button) {
            return;
        }
        if (busy) {
            button.dataset.idleLabel = button.textContent.trim();
            button.textContent = busyLabel;
            button.classList.add('is-loading');
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
            return;
        }
        button.textContent = button.dataset.idleLabel || button.textContent;
        delete button.dataset.idleLabel;
        button.classList.remove('is-loading');
        button.disabled = false;
        button.removeAttribute('aria-busy');
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

    ensureParagraphContext() {
        if (this.chapter && this.paragraph) {
            return true;
        }
        this.hydrateContextFromSelection();
        if (!this.chapter || !this.paragraph) {
            return false;
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
        return Array.isArray(this.paragraph?.attachments) ? this.paragraph.attachments : [];
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
                <button class="general-button danger files-plugin-action" type="button" data-local-action="${deleteAction}">Delete</button>
            </div>
        </div>`;
    }

    async insertFile(triggerElement) {
        if (!this.ensureParagraphContext()) {
            assistOS.showToast("Paragraph context missing, please reopen the plugin.", "error");
            return;
        }
        if (this.uploadInProgress) {
            return;
        }
        this.insertFileButton = triggerElement || this.insertFileButton;

        try {
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
        if (!file) {
            this.fileInput.value = "";
            this.resetFileInputListener();
            return;
        }
        if (this.uploadInProgress) {
            return;
        }
        this.uploadInProgress = true;
        this.setActionBusy(this.insertFileButton, true, 'Inserting…');
        try {
            if (!this.ensureParagraphContext()) {
                assistOS.showToast("Paragraph context missing, please reopen the plugin.", "error");
                return;
            }
            const uploadedId = await this.uploadFile(file);
            await this.persistFileEntry(uploadedId, file);
            await this.renderFiles();
            assistOS.showToast("File uploaded.", "success");
        } catch (error) {
            console.error("Failed to upload file", error);
            assistOS.showToast("Failed to upload file.", "error");
        } finally {
            this.uploadInProgress = false;
            this.setActionBusy(this.insertFileButton, false);
            if (this.fileInput) {
                this.fileInput.value = "";
            }
            this.resetFileInputListener();
        }
    }

    async uploadFile(file) {
        const result = await uploadBlobFile(file);
        const id = result?.id || result?.filename;
        if (typeof id === "string" && id) {
            return id;
        }
        throw new Error("Blob upload did not return a valid file id.");
    }

    async persistFileEntry(fileId, file) {
        if (!this.paragraph || !this.chapter) {
            throw new Error("Paragraph context is not available.");
        }
        const nextEntry = {
            id: fileId,
            name: file?.name || fileId,
            type: file?.type || "application/octet-stream",
            size: Number.isFinite(file?.size) ? file.size : 0
        };

        const previousAttachments = Array.isArray(this.paragraph.attachments) ? this.paragraph.attachments : [];
        const nextAttachments = [...previousAttachments, nextEntry];
        this.paragraph.attachments = nextAttachments;
        this.paragraph.metadata.attachments = nextAttachments;
        try {
            this.paragraph = await documentModule.updateParagraph(this.chapter.id, this.paragraph.id);
        } catch (error) {
            this.paragraph.attachments = previousAttachments;
            this.paragraph.metadata.attachments = previousAttachments;
            throw error;
        }
    }

    async deleteFile(triggerElement, fileId) {
        if (!this.ensureParagraphContext()) {
            assistOS.showToast("Paragraph context missing, please reopen the plugin.", "error");
            return;
        }
        if (!fileId) {
            return;
        }
        if (triggerElement?.getAttribute('aria-busy') === 'true') {
            return;
        }
        this.setActionBusy(triggerElement, true, 'Deleting…');
        try {
            const previousAttachments = this.getFiles();
            const nextAttachments = previousAttachments.filter((item) => item?.id !== fileId);
            this.paragraph.attachments = nextAttachments;
            this.paragraph.metadata.attachments = nextAttachments;
            try {
                this.paragraph = await documentModule.updateParagraph(this.chapter.id, this.paragraph.id);
            } catch (error) {
                this.paragraph.attachments = previousAttachments;
                this.paragraph.metadata.attachments = previousAttachments;
                throw error;
            }
            await this.renderFiles();
            assistOS.showToast("File removed.", "info");
        } catch (error) {
            console.error("Failed to delete file", error);
            assistOS.showToast("Failed to delete file.", "error");
        } finally {
            this.setActionBusy(triggerElement, false);
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
            const downloadURL = buildBlobUrl(file.id);
            if (!downloadURL) {
                throw new Error("File download URL is not available.");
            }
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
