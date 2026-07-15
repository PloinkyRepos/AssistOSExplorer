const documentModule = assistOS.loadModule("document");
const workspaceModule = assistOS.loadModule("workspace");
import {unescapeHtmlEntities} from "../../../imports.js";
import UIUtils from "./UIUtils.js";
import pluginUtils from "../../../utils/pluginUtils.ui.js";
import {
    updateChapterMediaState,
    updateParagraphMediaState
} from "../../../services/document/local/mediaAttachmentUtils.js";

export class DocumentViewPage {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.observers = [];
        this.autoSaveTimeout = null;
        this.autoSaveFunction = null;
        this.autoSavePromise = null;
        this.autoSaveInputElement = null;
        this.autoSaveInputHandler = null;
        const rawDocumentId = this.element.getAttribute("documentId");
        const documentId = rawDocumentId && rawDocumentId !== "null" && rawDocumentId !== "undefined" ? rawDocumentId : null;
        this.invalidate(async () => {
            if (documentId === "demo") {
                const documents = await documentModule.getDocuments();
                const docId = documents[documents.length - 1].id;
                this._document = await documentModule.loadDocument(docId);
                this.viewMode = "demo";
            } else {
                const hashDocumentId = window.location.hash.split("/")[3];
                const targetDocumentId = documentId || hashDocumentId;
                if (!targetDocumentId) {
                    throw new Error("Document identifier is required.");
                }
                const currentCrdt = window.assistOS?.workspace?.currentMarkdownCrdtDocument;
                if (this.isMarkdownDocumentPath(targetDocumentId) && currentCrdt?.model) {
                    this._document = {
                        ...this.normalizeRemoteMarkdownDocument(currentCrdt.model),
                        path: currentCrdt.path || targetDocumentId
                    };
                } else {
                    this._document = await documentModule.loadDocument(targetDocumentId);
                }
            }

            this.syncWorkspaceDocumentContext();
        });
    }
    isMarkdownDocumentPath(path) {
        return String(path || "").toLowerCase().endsWith(".md");
    }

    syncWorkspaceDocumentContext() {
        this.documentId = this._document?.id;
        const path = this._document?.path || null;
        const metadataId = this._document?.documentId || this._document?.metadata?.id || this._document?.docId || '';
        const isMarkdown = this.isMarkdownDocumentPath(path);
        assistOS.workspace.currentDocumentId = isMarkdown ? path : this._document?.id;
        assistOS.workspace.currentDocumentMetadataId = metadataId;
        assistOS.workspace.currentDocumentPath = path;
    }

    async refreshVariables(){
        const docId = this.isMarkdownCrdtDocument()
            ? (this._document?.path || assistOS.workspace.currentDocumentPath || "")
            : (this._document?.docId || this._document?.documentId || this._document?.metadata?.id || this._document?.id || "");
        this.variables = [];
        if (!docId) {
            return;
        }
        try {
            this.variables = await documentModule.getDocCommandsParsed(docId);
        } catch (error) {
            console.warn("Failed to load document variables", error);
            this.variables = [];
            return;
        }
        if (!this.variables.length) {
            return;
        }
        try {
            const result = await assistOS.appServices?.callTool("soplangAgent", "get_variables_with_values");
            if (result?.isError || result?.raw?.isError || /^MCP error/i.test(String(result?.text || "").trim())) {
                return;
            }
            const enriched = Array.isArray(result?.json) ? result.json : [];
            for (const cmd of this.variables) {
                const match = enriched.find(v =>
                    (v.varName || v.name) === cmd.varName &&
                    (v.docId || v.documentId) === docId
                );
                if (match) {
                    cmd.value = match.value;
                    if (match.errorInfo) cmd.errorInfo = match.errorInfo;
                }
            }
        } catch (_) {
            // MCP unavailable — variables render without values
        }
    }
    getVariables(chapterId, paragraphId) {
        return (this.variables || []).filter(variable => {
            return variable.chapterId === chapterId && variable.paragraphId === paragraphId;
        })
    }
    async printDocument() {
        await assistOS.UI.showModal("print-document-modal", {id: this._document.id, title: this._document.title});
    }

    async insertNewChapter(chapterId, position) {
        let newChapter = this._document.chapters.find((chapter) => chapter.id === chapterId);
        if (!newChapter) {
            newChapter = await documentModule.getChapter(chapterId);
        }
        const existingIndex = this._document.chapters.findIndex((chapter) => chapter.id === chapterId);
        if (existingIndex !== -1) {
            this._document.chapters.splice(existingIndex, 1);
        }
        this._document.chapters.splice(position, 0, newChapter);
        let previousChapterIndex = position - 1;
        if (previousChapterIndex < 0) {
            previousChapterIndex = 0;
        }
        let previousChapterId = this._document.chapters[previousChapterIndex]?.id;
        let previousChapter = previousChapterId
            ? this.element.querySelector(`chapter-item[data-chapter-id="${previousChapterId}"]`)
            : null;
        const shouldCreateParagraph = !(newChapter?.paragraphs?.length);
        const createParagraphAttr = shouldCreateParagraph ? ' data-create-paragraph="true"' : '';
        const chapterHTML = `<chapter-item${createParagraphAttr} data-chapter-number="${position + 1}" data-chapter-id="${newChapter.id}" data-presenter="chapter-item"></chapter-item>`;
        if (!previousChapter) {
            let chapterContainer = this.element.querySelector(".chapters-container");
            chapterContainer.insertAdjacentHTML("afterbegin", chapterHTML);
        } else {
            previousChapter.insertAdjacentHTML("afterend", chapterHTML);
        }
        this.updateChapterOrdering();
    }

    changeChapterOrder(chapterId, position) {
        let chapters = this._document.chapters;
        let currentChapterIndex = this._document.chapters.findIndex((chapter => chapter.id === chapterId));

        let [chapter] = chapters.splice(currentChapterIndex, 1);
        chapters.splice(position, 0, chapter);

        // Update the DOM
        let chapterElement = this.element.querySelector(`chapter-item[data-chapter-id="${chapterId}"]`);
        let referenceElement = this.element.querySelectorAll("chapter-item")[position];

        if (referenceElement) {
            referenceElement.insertAdjacentElement(position > currentChapterIndex ? 'afterend' : 'beforebegin', chapterElement);
        } else {
            this.element.appendChild(chapterElement); // If moving to the last position
        }
        this.updateChapterOrdering();
        this.refreshTableOfContents();
    }
    refreshTableOfContents(){
        let contentsTable = this.element.querySelector("contents-table");
        if(contentsTable) {
            contentsTable.webSkelPresenter.refreshTableOfContents();
        }
    }
    deleteChapter(chapterId) {
        let chapter = this.element.querySelector(`chapter-item[data-chapter-id="${chapterId}"]`);
        chapter.remove();
        this._document.chapters = this._document.chapters.filter((chapter) => chapter.id !== chapterId);
        this.updateChapterOrdering();
        this.refreshTableOfContents();
    }

    async onDocumentUpdate(data) {
        if (typeof data === "object") {
            if (data.operationType === "add") {
                await this.insertNewChapter(data.chapterId, data.position);
                this.refreshTableOfContents();

            } else if (data.operationType === "delete") {
                this.deleteChapter(data.chapterId);
                this.refreshTableOfContents();

            } else if (data.operationType === "swap") {
                this.changeChapterOrder(data.chapterId, data.swapChapterId, data.direction);
                this.refreshTableOfContents();
            }
        } else {
            switch (data) {
                case "delete":
                    alert("The document has been deleted");
                    break;
                case "title":
                    let document = await documentModule.getDocument(this._document.id);
                    this._document.title = document.title;
                    this.renderDocumentTitle();
                    this.refreshTableOfContents();
                    break;
                case "infoText":
                    let documentUpdated = await documentModule.getDocument(this._document.id);
                    this._document.infoText = documentUpdated.infoText;
                    this.renderInfoText();
                    break;
                case "snapshots":
                    this._document.snapshots = await documentModule.getDocumentSnapshots(this._document.id);
                    break;
                default:
                    console.error("Document: Unknown update type ", data);
                    break;
            }
        }
        //this.toggleEditingState(true);
    }

    getFileExplorerPresenter() {
        const host = this.element.closest("file-exp") || document.querySelector("file-exp");
        return host?.webSkelPresenter || null;
    }

    hasBlockingLocalEdit() {
        return Boolean(this.currentElement || this.autoSaveTimeout || this.autoSavePromise);
    }

    getMarkdownCrdtRevision(crdt = {}) {
        const heads = Array.isArray(crdt.heads) ? crdt.heads.map((head) => String(head)).sort() : [];
        const headsKey = heads.join("|");
        const versionKey = String(crdt.versionKey || "");
        if (headsKey) {
            return `heads:${headsKey}`;
        }
        if (versionKey) {
            return `version:${versionKey}`;
        }
        return "";
    }

    updateMarkdownCrdtEditRevision(crdt = {}) {
        const revision = this.getMarkdownCrdtRevision(crdt);
        if (!revision) {
            return;
        }
        const fileExplorer = this.getFileExplorerPresenter();
        if (fileExplorer) {
            fileExplorer.markdownCrdtEditRevision = revision;
            if (fileExplorer.markdownCrdtEditPending?.revision === revision) {
                fileExplorer.markdownCrdtEditPending = null;
            }
        }
        this.remoteMarkdownRevision = revision;
    }

    async applyPendingRemoteMarkdownIfReady() {
        if (this.hasBlockingLocalEdit()) {
            return false;
        }
        const fileExplorer = this.getFileExplorerPresenter();
        if (typeof fileExplorer?.applyPendingMarkdownCrdtEdit !== "function") {
            return false;
        }
        return fileExplorer.applyPendingMarkdownCrdtEdit();
    }

    async applyRemoteMarkdownDocument(nextDocument, options = {}) {
        if (!nextDocument || this.hasBlockingLocalEdit()) {
            return false;
        }
        const scrollTop = this.element.scrollTop;
        const synced = this.syncRenderedMarkdownDocument(nextDocument);
        if (!synced) {
            return false;
        }
        this.remoteMarkdownRevision = options.revision || '';
        this.element.scrollTop = scrollTop;
        try {
            await this.refreshVariables();
            this.notifyObservers("variables");
        } catch (error) {
            console.warn("Failed to refresh variables after remote Markdown CRDT update", error);
        }
        return true;
    }

    parseToolJson(result) {
        const blocks = Array.isArray(result?.blocks) ? result.blocks : (Array.isArray(result?.raw?.content) ? result.raw.content : []);
        const text = typeof result?.text === "string"
            ? result.text
            : blocks.find((block) => block?.type === "text" && typeof block.text === "string")?.text;
        if (result?.isError || result?.raw?.isError) {
            throw new Error(text || "Explorer tool execution failed.");
        }
        if (result?.json && typeof result.json === "object") {
            return result.json;
        }
        const jsonBlock = blocks.find((block) => block?.type === "json" && block.json !== undefined);
        if (jsonBlock) {
            return jsonBlock.json;
        }
        if (text) {
            try {
                return JSON.parse(text);
            } catch (_) {
                if (/^(MCP error|Error:)/i.test(text.trim())) {
                    throw new Error(text.trim());
                }
                return {};
            }
        }
        return {};
    }

    async callExplorerTool(toolName, args = {}) {
        const appServices = assistOS?.appServices || window.webSkel?.appServices || null;
        if (typeof appServices?.callTool !== "function") {
            throw new Error("Explorer tool service is not available.");
        }
        return this.parseToolJson(await appServices.callTool("explorer", toolName, args));
    }

    isMarkdownCrdtDocument() {
        return String(this._document?.path || assistOS.workspace.currentDocumentPath || "").toLowerCase().endsWith(".md");
    }

    updateMarkdownDocumentModel(nextDocument) {
        const previousPath = this._document?.path || assistOS.workspace.currentDocumentPath || null;
        this._document = {
            ...this.normalizeRemoteMarkdownDocument(nextDocument),
            path: nextDocument.path || previousPath
        };
        this.syncWorkspaceDocumentContext();
        assistOS.workspace.currentMarkdownCrdtDocument = {
            ...(assistOS.workspace.currentMarkdownCrdtDocument || {}),
            documentId: assistOS.workspace.currentDocumentMetadataId,
            path: this._document.path || null,
            model: this._document
        };
        return this._document;
    }

    getMarkdownChangeTarget(change = {}, documentModel = this._document) {
        if (change.type === "updateParagraph") {
            const chapter = documentModel?.chapters?.find((item) => item.id === change.chapterId);
            return chapter?.paragraphs?.find((item) => item.id === change.paragraphId) || null;
        }
        if (change.type === "updateChapter") {
            return documentModel?.chapters?.find((item) => item.id === change.chapterId) || null;
        }
        if (change.type === "updateDocument") {
            return documentModel || null;
        }
        return null;
    }

    valuesEqual(left, right) {
        return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
    }

    shouldRefreshVariablesForMarkdownChange(change = {}, previousDocument = this._document) {
        if (change.refreshVariables === true) {
            return true;
        }
        const metadata = change.metadata || change.patch?.metadata || {};
        const target = this.getMarkdownChangeTarget(change, previousDocument);
        const currentCommands = target?.commands ?? target?.metadata?.commands ?? "";
        const nextCommands = Object.prototype.hasOwnProperty.call(change, "commands")
            ? change.commands
            : Object.prototype.hasOwnProperty.call(change.patch || {}, "commands")
                ? change.patch.commands
                : Object.prototype.hasOwnProperty.call(metadata, "commands")
                    ? metadata.commands
                    : undefined;
        if (nextCommands !== undefined && String(nextCommands ?? "") !== String(currentCommands ?? "")) {
            return true;
        }
        const currentVariables = target?.variables ?? target?.metadata?.variables ?? [];
        const nextVariables = Object.prototype.hasOwnProperty.call(change.patch || {}, "variables")
            ? change.patch.variables
            : Object.prototype.hasOwnProperty.call(metadata, "variables")
                ? metadata.variables
                : undefined;
        return nextVariables !== undefined && !this.valuesEqual(nextVariables, currentVariables);
    }

    async refreshVariablesAfterMarkdownChange(change = {}, previousDocument = this._document) {
        if (!this.shouldRefreshVariablesForMarkdownChange(change, previousDocument)) {
            return;
        }
        try {
            await this.refreshVariables();
            this.notifyObservers("variables");
        } catch (error) {
            console.warn("Failed to refresh variables after Markdown CRDT change", error);
        }
    }

    async applyMarkdownDocumentChange(change = {}, options = {}) {
        if (!this.isMarkdownCrdtDocument()) {
            return null;
        }
        const path = this._document?.path || assistOS.workspace.currentDocumentPath || "";
        let documentId = String(this._document?.documentId || this._document?.metadata?.id || "");
        if (!documentId) {
            const opened = await this.callExplorerTool("open_markdown_crdt_document", { path });
            documentId = String(opened?.documentId || "");
        }
        if (!documentId) {
            throw new Error("Markdown CRDT document id is not available.");
        }
        const previousDocument = this._document;
        const applied = await this.callExplorerTool("apply_markdown_crdt_change", {
            documentId,
            operation: change.type,
            change,
            changeJson: JSON.stringify(change)
        });
        const saved = await this.callExplorerTool("save_markdown_crdt_document", {
            documentId: String(applied?.documentId || documentId),
            path
        });
        if (applied?.model) {
            if (options.sync === false || this.hasBlockingLocalEdit()) {
                this.updateMarkdownDocumentModel(applied.model);
            } else {
                const synced = this.syncRenderedMarkdownDocument(applied.model);
                if (!synced) {
                    this.updateMarkdownDocumentModel(applied.model);
                }
            }
            await this.refreshVariablesAfterMarkdownChange(change, previousDocument);
        }
        this.updateMarkdownCrdtEditRevision(saved?.heads ? saved : applied);
        if (assistOS.workspace.currentMarkdownCrdtDocument) {
            assistOS.workspace.currentMarkdownCrdtDocument = {
                ...assistOS.workspace.currentMarkdownCrdtDocument,
                heads: saved?.heads || applied?.heads || assistOS.workspace.currentMarkdownCrdtDocument.heads,
                versionKey: saved?.versionKey || applied?.versionKey || assistOS.workspace.currentMarkdownCrdtDocument.versionKey
            };
        }
        return applied;
    }

    async updateParagraphModel(chapterId, paragraphId, patch = {}) {
        if (this.isMarkdownCrdtDocument()) {
            return this.applyMarkdownDocumentChange({
                type: "updateParagraph",
                chapterId,
                paragraphId,
                ...patch
            });
        }
        const chapter = this._document?.chapters?.find((item) => item.id === chapterId);
        const paragraph = chapter?.paragraphs?.find((item) => item.id === paragraphId);
        return documentModule.updateParagraph(
            chapterId,
            paragraphId,
            patch.text ?? paragraph?.text ?? "",
            patch.commands ?? paragraph?.commands ?? "",
            patch.comments ?? paragraph?.comments ?? { messages: [] }
        );
    }

    async updateDocumentModel(patch = {}) {
        if (this.isMarkdownCrdtDocument()) {
            return this.applyMarkdownDocumentChange({
                type: "updateDocument",
                ...patch
            });
        }
        return documentModule.updateDocument(
            this._document.id,
            patch.title ?? this._document.title,
            patch.docId ?? this._document.docId,
            patch.infoText ?? this._document.infoText,
            patch.commands ?? this._document.commands,
            patch.comments ?? this._document.comments
        );
    }

    async updateChapterModel(chapterId, patch = {}) {
        if (this.isMarkdownCrdtDocument()) {
            return this.applyMarkdownDocumentChange({
                type: "updateChapter",
                chapterId,
                ...patch
            });
        }
        const chapter = this._document?.chapters?.find((item) => item.id === chapterId);
        return documentModule.updateChapter(
            chapterId,
            patch.title ?? chapter?.title ?? "",
            patch.commands ?? chapter?.commands ?? "",
            patch.comments ?? chapter?.comments ?? { messages: [] }
        );
    }

    async reorderChapterModel(chapterId, position) {
        if (this.isMarkdownCrdtDocument()) {
            return this.applyMarkdownDocumentChange({
                type: "reorderChapter",
                chapterId,
                position
            }, { sync: false });
        }
        return documentModule.changeChapterOrder(this._document.id, chapterId, position);
    }

    async addChapterModel(title, position) {
        if (this.isMarkdownCrdtDocument()) {
            const applied = await this.applyMarkdownDocumentChange({
                type: "addChapter",
                position,
                chapter: {
                    title,
                    metadata: { title },
                    heading: { level: 2, text: title },
                    paragraphs: []
                }
            }, { sync: false });
            return applied?.model?.chapters?.[position] || null;
        }
        return documentModule.addChapter(this._document.id, title, null, null, position);
    }

    async deleteChapterModel(chapterId) {
        if (this.isMarkdownCrdtDocument()) {
            return this.applyMarkdownDocumentChange({
                type: "deleteChapter",
                chapterId
            }, { sync: false });
        }
        return documentModule.deleteChapter(this._document.id, chapterId);
    }

    async addParagraphModel(chapterId, position) {
        if (this.isMarkdownCrdtDocument()) {
            const applied = await this.applyMarkdownDocumentChange({
                type: "addParagraph",
                chapterId,
                position,
                paragraph: {
                    text: "",
                    metadata: {
                        type: "markdown",
                        comments: { messages: [] }
                    }
                }
            }, { sync: false });
            const chapter = applied?.model?.chapters?.find((item) => item.id === chapterId);
            return chapter?.paragraphs?.[position] || null;
        }
        return documentModule.addParagraph(chapterId, "", null, null, position);
    }

    async deleteParagraphModel(chapterId, paragraphId) {
        if (this.isMarkdownCrdtDocument()) {
            return this.applyMarkdownDocumentChange({
                type: "deleteParagraph",
                chapterId,
                paragraphId
            }, { sync: false });
        }
        return documentModule.deleteParagraph(chapterId, paragraphId);
    }

    async reorderParagraphModel(chapterId, paragraphId, position) {
        if (this.isMarkdownCrdtDocument()) {
            return this.applyMarkdownDocumentChange({
                type: "reorderParagraph",
                chapterId,
                paragraphId,
                position
            }, { sync: false });
        }
        return documentModule.changeParagraphOrder(chapterId, paragraphId, position);
    }

    normalizeRemoteMarkdownDocument(nextDocument) {
        const normalizeComments = (comments = {}, defaults = {}) => ({
            messages: Array.isArray(comments?.messages) ? comments.messages : [],
            ...defaults,
            ...(comments && typeof comments === "object" ? comments : {})
        });
        const normalizeParagraph = (paragraph) => {
            const normalized = {
                ...paragraph,
                commands: paragraph.commands ?? paragraph.metadata?.commands ?? "",
                comments: normalizeComments(paragraph.comments)
            };
            normalized.metadata = {
                ...(normalized.metadata || {}),
                commands: normalized.commands,
                comments: normalized.comments
            };
            updateParagraphMediaState(normalized);
            return normalized;
        };
        const normalizeChapter = (chapter) => {
            const normalized = {
                ...chapter,
                commands: chapter.commands ?? chapter.metadata?.commands ?? "",
                comments: normalizeComments(chapter.comments),
                paragraphs: (chapter.paragraphs || []).map(normalizeParagraph)
            };
            normalized.metadata = {
                ...(normalized.metadata || {}),
                commands: normalized.commands,
                comments: normalized.comments
            };
            updateChapterMediaState(normalized);
            return normalized;
        };
        return {
            ...nextDocument,
            commands: nextDocument.commands ?? nextDocument.metadata?.commands ?? "",
            docId: nextDocument.docId || nextDocument.documentId || nextDocument.metadata?.id || nextDocument.id || "",
            infoText: nextDocument.infoText ?? nextDocument.metadata?.infoText ?? "",
            comments: normalizeComments(nextDocument.comments, { infoTextTitle: "Document Info" }),
            chapters: (nextDocument.chapters || []).map(normalizeChapter)
        };
    }

    syncRenderedMarkdownDocument(nextDocument) {
        nextDocument = this.normalizeRemoteMarkdownDocument(nextDocument);
        const chapterElements = Array.from(this.element.querySelectorAll("chapter-item[data-chapter-id]"));
        if (chapterElements.length !== nextDocument.chapters.length) {
            return false;
        }
        for (const chapter of nextDocument.chapters) {
            const chapterElement = this.element.querySelector(`chapter-item[data-chapter-id="${chapter.id}"]`);
            if (!chapterElement?.webSkelPresenter) {
                return false;
            }
            const paragraphElements = Array.from(chapterElement.querySelectorAll("paragraph-item[data-paragraph-id]"));
            if (paragraphElements.length !== chapter.paragraphs.length) {
                return false;
            }
            for (const paragraph of chapter.paragraphs) {
                if (!chapterElement.querySelector(`paragraph-item[data-paragraph-id="${paragraph.id}"]`)?.webSkelPresenter) {
                    return false;
                }
            }
        }

        const previousPath = this._document?.path || assistOS.workspace.currentDocumentPath || null;
        this._document = {
            ...nextDocument,
            path: nextDocument.path || previousPath
        };
        this.syncWorkspaceDocumentContext();
        assistOS.workspace.currentMarkdownCrdtDocument = {
            ...(assistOS.workspace.currentMarkdownCrdtDocument || {}),
            documentId: assistOS.workspace.currentDocumentMetadataId,
            path: this._document.path || null,
            model: this._document
        };
        this.renderDocumentTitle();
        this.renderInfoText();
        UIUtils.changeCommentIndicator(this.element, this._document.comments.messages);
        UIUtils.displayCurrentStatus(this.element, this._document.comments, "infoText");

        for (const chapter of nextDocument.chapters) {
            const chapterElement = this.element.querySelector(`chapter-item[data-chapter-id="${chapter.id}"]`);
            const chapterPresenter = chapterElement.webSkelPresenter;
            chapterPresenter._document = nextDocument;
            chapterPresenter.chapter = chapter;
            chapterPresenter.renderChapterTitle?.();
            UIUtils.changeCommentIndicator(chapterElement, chapter.comments.messages);
            UIUtils.displayCurrentStatus(chapterElement, chapter.comments, "chapter");

            for (const paragraph of chapter.paragraphs) {
                const paragraphElement = chapterElement.querySelector(`paragraph-item[data-paragraph-id="${paragraph.id}"]`);
                const paragraphPresenter = paragraphElement.webSkelPresenter;
                paragraphPresenter._document = nextDocument;
                paragraphPresenter.chapter = chapter;
                paragraphPresenter.paragraph = paragraph;
                const paragraphText = paragraphElement.querySelector(".paragraph-text");
                if (paragraphText) {
                    paragraphText.innerHTML = paragraph.text;
                    paragraphText.value = assistOS.UI.unsanitize(paragraph.text || "");
                    paragraphText.style.height = "auto";
                    paragraphText.style.height = `${paragraphText.scrollHeight}px`;
                }
                UIUtils.changeCommentIndicator(paragraphElement, paragraph.comments.messages);
                UIUtils.displayCurrentStatus(paragraphElement, paragraph.comments, "paragraph");
                paragraphPresenter.renderInfoIcons?.();
            }
        }
        return true;
    }

    async beforeRender() {
        if (window.assistOS.stylePreferenceCache) {
            this.stylePreferences = window.assistOS.stylePreferenceCache
        } else {
            this.stylePreferences = await documentModule.getStylePreferences(assistOS.user.email);
        }
        this.documentFontSize = assistOS.constants.fontSizeMap[this.stylePreferences["document-title-font-size"]] || "24px";
        this.documentFontFamily = assistOS.constants.fontFamilyMap[this.stylePreferences["document-font-family"]] || "Arial";
        this.chapterFontSize = assistOS.constants.fontSizeMap[this.stylePreferences["chapter-title-font-size"]] || "20px"
        this.infoTextFontFamily = this.documentFontFamily
        this.infoTextFontSize = assistOS.constants.fontSizeMap[this.stylePreferences["infoText-font-size"]] || "16px";
        const textFontSize = this.stylePreferences["document-font-size"] ?? 16;
        this.fontSize = assistOS.constants.fontSizeMap[textFontSize]
        this.chaptersContainer = "";
        this.docTitle = this._document.title;
        if (this._document.chapters.length > 0) {
            this._document.chapters.forEach((item) => {
                this.chaptersContainer += `<chapter-item data-chapter-id="${item.id}" data-presenter="chapter-item"></chapter-item>`;
            });
        }
        document.documentElement.style.setProperty('--document-font-color', localStorage.getItem("document-font-color") || "#646464");
        this.variables = [];
    }

    renderDocumentTitle() {
   /*     let documentTitle = this.element.querySelector(".document-title");
        documentTitle.value = unescapeHtmlEntities(this._document.title);*/
    }

    renderInfoText() {
        let infoText = this.element.querySelector(".document-infoText");
        infoText.innerHTML = this._document.infoText || "";
        infoText.style.height = "auto";
        infoText.style.height = infoText.scrollHeight + 'px';
        infoText.addEventListener("paste", async () => {
            setTimeout(() => {
                infoText.style.height = infoText.scrollHeight + 'px';
            }, 0)
        });
        let infoTextTitle = this.element.querySelector("#info-text-title");
        infoTextTitle.value = assistOS.UI.unsanitize(this._document.comments.infoTextTitle) || "Document Info";
    }

    async afterRender() {
        if (this.element.getAttribute('reducePadding')) {
            this.element.querySelector('.document-editor-container').style.padding = "0px";
        }
        let documentPluginsContainer = this.element.querySelector(".document-plugins-container");
        await pluginUtils.renderPluginIcons(documentPluginsContainer, "document");
        let infoTextPluginsContainer = this.element.querySelector(".infoText-plugins-container");
        await pluginUtils.renderPluginIcons(infoTextPluginsContainer, "infoText");
        this.renderDocumentTitle();
        this.renderInfoText();
        if (this._document.comments.toc) {
            this.showTableOfContents();
        }
        if (this._document.comments.tor) {
            this.showTableOfReferences();
        }
        if (assistOS.workspace.currentChapterId) {
            let chapter = this.element.querySelector(`chapter-item[data-chapter-id="${assistOS.workspace.currentChapterId}"]`);
            if (chapter) {
                chapter.click();
                chapter.scrollIntoView({behavior: "smooth", block: "center"});
            }
        }
        if (!this.boundRemoveFocusHandler) {
            this.boundRemoveFocusHandler = this.removeFocusHandler.bind(this);
            document.addEventListener("click", this.boundRemoveFocusHandler);
        }
        this.documentEditor = this.element.querySelector(".document-editor");
        this.disabledMask = this.element.querySelector(".disabled-mask");
        //this.undoButton = this.element.querySelector(".undo-button");
        //this.redoButton = this.element.querySelector(".redo-button");
        //let tasksMenu = this.element.querySelector(".tasks-menu");
        //let snapshotsButton = this.element.querySelector(".document-snapshots-modal");
        this.tableOfContents = this.element.querySelector(".table-of-contents");
        this.tableOfReferences = this.element.querySelector(".table-of-references");
        let scriptArgs = this.element.querySelector(".script-modal");
        let buildIcon = this.element.querySelector(".build-document");
        let commentsIcon = this.element.querySelector(".comments-icon-container");
        let actionsMenu = this.element.querySelector(".document-menu-container");
        this.tableOfContents.title = "Table of Contents";
        this.tableOfContents.setAttribute("aria-label", "Table of Contents");
        this.tableOfReferences.title = "References";
        this.tableOfReferences.setAttribute("aria-label", "References");
        commentsIcon.title = "Add Comment";
        commentsIcon.setAttribute("aria-label", "Add Comment");
        buildIcon.title = "Build Document";
        buildIcon.setAttribute("aria-label", "Build Document");
        actionsMenu.title = "More Actions";
        actionsMenu.setAttribute("aria-label", "More Actions");
        if (this.viewMode === "demo") {
            this.element.querySelector('.document-page-header')?.remove();
        }
        UIUtils.changeCommentIndicator(this.element, this._document.comments.messages);
        UIUtils.displayCurrentStatus(this.element, this._document.comments, "infoText");
        this.refreshVariables()
            .then(() => this.notifyObservers("variables"))
            .catch((error) => console.warn("Failed to refresh variables after render", error));
        delete this.currentPlugin;
    }

    async updateStatus(status, type, pluginName, autoPin, persist = true) {
        UIUtils.changeStatusIcon(this.element, status, type, pluginName, autoPin);
        if(status === this._document.comments.status && pluginName === this._document.comments.plugin){
            return; // No change in status or plugin
        }
        this._document.comments.status = status;
        this._document.comments.plugin = pluginName;
        if (!persist) {
            return;
        }
        await this.updateDocumentModel({
            title: this._document.title,
            docId: this._document.docId,
            infoText: this._document.infoText,
            commands: this._document.commands,
            comments: this._document.comments
        });
    }
    async openSnapshotsModal(targetElement) {
        await assistOS.UI.showModal("document-snapshots-modal");
    }

    async changeDocInfoDisplay(arrow) {
        let documentInfo = this.element.querySelector(".document-infoText");
        if (documentInfo.classList.contains("hidden")) {
            documentInfo.classList.remove("hidden");
            arrow.classList.remove("rotate");
        } else {
            documentInfo.classList.add("hidden");
            arrow.classList.add("rotate");
        }
    }

    async removeFocusHandler(event) {
        let closestContainer = event.target.closest(".document-editor");
        if (!closestContainer && !event.target.closest(".maintain-focus")) {
            if (this.currentElement) {
                this.currentElement.element.removeAttribute("id");
                await this.currentElement.focusoutFunction(this.currentElement.element);
                await this.stopTimer(true);
                this.clearAutoSaveInputListener();
                this.currentElement = null;
                await this.applyPendingRemoteMarkdownIfReady();
            }
        }
    }

    async moveChapter(targetElement, direction) {
        const currentChapterElement = assistOS.UI.reverseQuerySelector(targetElement, "chapter-item");
        const currentChapterId = currentChapterElement.getAttribute('data-chapter-id');
        const currentChapterIndex = this._document.chapters.findIndex((chapter => chapter.id === currentChapterId));

        const getNewPosition = (index, chapters) => {
            if (direction === "up") {
                return index === 0 ? chapters.length - 1 : index - 1;
            } else {
                return index === chapters.length - 1 ? 0 : index + 1;
            }
        };

        const position = getNewPosition(currentChapterIndex, this._document.chapters);
        await this.reorderChapterModel(currentChapterId, position);
        this.changeChapterOrder(currentChapterId, position);
    }

    async openScriptModal() {
        await assistOS.UI.showModal("run-script");
    }

    async saveInfoText(infoTextElement) {
        let infoText = assistOS.UI.sanitize(infoTextElement.value);
        if (infoText !== this._document.infoText) {
            this._document.infoText = infoText;
            await this.updateDocumentModel({
                title: this._document.title,
                docId: this._document.docId,
                infoText,
                commands: this._document.commands,
                comments: this._document.comments
            });
        }
    }

    async saveInfoTextTitle(input) {
        let infoTextTitle = assistOS.UI.sanitize(input.value);
        if (infoTextTitle !== this._document.comments.infoTextTitle) {
            this._document.comments.infoTextTitle = infoTextTitle;
            await this.updateDocumentModel({
                title: this._document.title,
                docId: this._document.docId,
                infoText: this._document.infoText,
                commands: this._document.commands,
                comments: this._document.comments
            });
        }
    }

    async addChapter(targetElement, direction) {
        let position = this._document.chapters.length;
        if (assistOS.workspace.currentChapterId) {
            if (direction === "above") {
                position = this._document.chapters.findIndex(
                    (chapter) => chapter.id === assistOS.workspace.currentChapterId);

            } else {
                position = this._document.chapters.findIndex(
                    (chapter) => chapter.id === assistOS.workspace.currentChapterId) + 1;
            }

        }
        let chapterTitle = assistOS.UI.sanitize("New Chapter");
        let chapter = await this.addChapterModel(chapterTitle, position);
        if (!chapter) {
            return;
        }
        assistOS.workspace.currentChapterId = chapter.id;
        await this.insertNewChapter(chapter.id, position);
        this.updateChapterOrdering();
        this.refreshTableOfContents();
    }

    updateChapterOrdering() {
        const seenIds = new Set();
        const chapterElements = Array.from(this.element.querySelectorAll("chapter-item"));
        chapterElements.forEach((chapterElement) => {
            const chapterId = chapterElement.getAttribute("data-chapter-id");
            if (seenIds.has(chapterId)) {
                chapterElement.remove();
                return;
            }
            seenIds.add(chapterId);
            const chapterIndex = this._document.chapters.findIndex((chapter) => chapter.id === chapterId);
            const presenter = chapterElement.webSkelPresenter;
            if (chapterIndex === -1) {
                chapterElement.remove();
                return;
            }
            if (presenter && chapterIndex !== -1) {
                const chapterData = this._document.chapters[chapterIndex];
                presenter.chapter = chapterData;
                presenter._document = this._document;
                presenter.updateChapterNumber();
                presenter.changeChapterDeleteAvailability();
                presenter.displayChapterContent();
            } else {
                const label = chapterElement.querySelector(".data-chapter-number");
                if (label) {
                    label.innerHTML = `${chapterIndex + 1}.`;
                }
            }
            chapterElement.setAttribute("data-chapter-number", `${chapterIndex + 1}`);
        });
    }

    async saveTitle(textElement) {
        let titleText = assistOS.UI.sanitize(textElement.value);
        if (titleText !== this._document.title && titleText !== "") {
            this._document.title = titleText;
            await this.updateDocumentModel({
                title: titleText,
                docId: this._document.docId,
                infoText: this._document.infoText,
                commands: this._document.commands,
                comments: this._document.comments
            });
        }
    }

    async changeCurrentElement(element, focusoutFunction) {
        if (this.currentElement) {
            this.currentElement.element.removeAttribute("id");
            await this.currentElement.focusoutFunction(this.currentElement.element);
            await this.stopTimer(true);
        }
        element.setAttribute("id", "current-selection");
        this.currentElement = {
            element: element,
            focusoutFunction: focusoutFunction,
        };
    }


    async titleKeyDownHandler(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
        }
    };

    async resetTimer() {
        this.scheduleAutoSave();
    }

    async stopTimer(executeFn) {
        if (this.autoSaveTimeout) {
            clearTimeout(this.autoSaveTimeout);
            this.autoSaveTimeout = null;
        }
        if (executeFn) {
            await this.runAutoSaveNow();
        } else if (this.autoSavePromise) {
            await this.autoSavePromise;
            this.autoSavePromise = null;
        }
    }

    async flushPendingEdit() {
        await this.stopTimer(true);
        if (!this.currentElement) {
            await this.applyPendingRemoteMarkdownIfReady();
            return;
        }
        const { element, focusoutFunction } = this.currentElement;
        if (typeof focusoutFunction === "function" && element?.closest("body")) {
            await focusoutFunction(element);
        }
        element?.removeAttribute("id");
        this.clearAutoSaveInputListener();
        this.currentElement = null;
        await this.applyPendingRemoteMarkdownIfReady();
    }

    scheduleAutoSave(delay = 500) {
        if (typeof this.autoSaveFunction !== "function") {
            return;
        }
        if (this.autoSaveTimeout) {
            clearTimeout(this.autoSaveTimeout);
        }
        this.autoSaveTimeout = setTimeout(() => {
            this.autoSaveTimeout = null;
            this.autoSavePromise = Promise.resolve()
                .then(() => this.autoSaveFunction?.())
                .catch((error) => {
                    console.error(error);
                    assistOS.showToast?.(error?.message || "Autosave failed.", "error");
                })
                .finally(async () => {
                    this.autoSavePromise = null;
                    await this.applyPendingRemoteMarkdownIfReady();
                });
        }, delay);
    }

    async runAutoSaveNow() {
        if (this.autoSaveTimeout) {
            clearTimeout(this.autoSaveTimeout);
            this.autoSaveTimeout = null;
        }
        try {
            if (this.autoSavePromise) {
                await this.autoSavePromise;
            }
            if (typeof this.autoSaveFunction === "function") {
                this.autoSavePromise = Promise.resolve().then(() => this.autoSaveFunction());
                await this.autoSavePromise;
            }
        } finally {
            this.autoSavePromise = null;
        }
        await this.applyPendingRemoteMarkdownIfReady();
    }

    clearAutoSaveInputListener() {
        if (this.autoSaveInputElement && this.autoSaveInputHandler) {
            this.autoSaveInputElement.removeEventListener("input", this.autoSaveInputHandler);
        }
        this.autoSaveInputElement = null;
        this.autoSaveInputHandler = null;
    }

    async focusOutHandler(element) {
        await this.focusOutHandlerTitle(element);
        element.removeEventListener('keydown', this.boundControlInfoTextHeight);
        this.changeToolbarView(element, "off");
        let pluginContainer = this.element.querySelector(`.infoText-plugin-container`);
        let pluginElement = pluginContainer.firstElementChild;
        if (!pluginElement) {
            return;
        }
        if (pluginElement.classList.contains("pinned")) {
            return;
        }
        await this.closePlugin("", "infoText", true);
    }

    async focusOutHandlerTitle(element) {
        let container = element.closest(".container-element");
        container.classList.remove("focused");
        element.removeEventListener('keydown', this.titleKeyDownHandler);
        element.classList.remove("focused");
        await this.stopTimer(true);
    }

    async controlInfoTextHeight(infoText) {
        infoText.style.height = "auto";
        infoText.style.height = infoText.scrollHeight + 'px';
    }

    changeToolbarView(targetElement, mode) {
        let containerElement = targetElement.closest(".container-element");
        let toolbar = containerElement.querySelector(".right-section");
        if (!toolbar) {
            return;
        }
        mode === "on" ? toolbar.style.display = "flex" : toolbar.style.display = "none";
    }

    async highlightInfoText(targetElement) {
        if (!this.boundControlInfoTextHeight) {
            this.boundControlInfoTextHeight = this.controlInfoTextHeight.bind(this, targetElement);
        }
        targetElement.addEventListener('keydown', this.boundControlInfoTextHeight);
        await this.changeCurrentElement(targetElement, this.focusOutHandler.bind(this, targetElement));
        let containerElement = targetElement.closest(".container-element");
        containerElement.classList.add("focused");
        targetElement.classList.add("focused")
        this.changeToolbarView(targetElement, "on");
        if (this.currentPlugin) {
            await this.openPlugin("", "infoText", this.currentPlugin);
        }
    }

    async highlightInfoTextTitle(targetElement) {
        await this.changeCurrentElement(targetElement, this.focusOutHandler.bind(this, targetElement));
        let containerElement = targetElement.closest(".container-element");
        containerElement.classList.add("focused");
        targetElement.classList.add("focused")
        this.changeToolbarView(targetElement, "on");
        if (this.currentPlugin) {
            await this.openPlugin("", "infoText", this.currentPlugin);
        }
    }

    async editItem(targetElement, type) {
        if (targetElement.getAttribute("id") === "current-selection") {
            return;
        }
        if (type === "paragraph") {
            let chapterPresenter = targetElement.closest("chapter-item").webSkelPresenter;
            let paragraphItem = targetElement.closest("paragraph-item");
            let paragraphText = paragraphItem.querySelector(".paragraph-text");
            let paragraphPresenter = paragraphItem.webSkelPresenter;
            await this.changeCurrentElement(paragraphItem, paragraphPresenter.focusOutHandler.bind(paragraphPresenter, paragraphText));
            await paragraphPresenter.highlightParagraph();
            await chapterPresenter.highlightChapter();
            return;
        }else if (type === "infoTextSection") {
            await this.changeCurrentElement(targetElement, this.focusOutHandler.bind(this, targetElement, this.infoTextId));
            let containerElement = targetElement.closest(".container-element");
            containerElement.classList.add("focused");
            this.changeToolbarView(targetElement, "on");
            if (this.currentPlugin) {
                await this.openPlugin("", "infoText", this.currentPlugin);
            }
            return;
        } else if (type === "chapterHeader") {
            let chapterPresenter = targetElement.closest("chapter-item").webSkelPresenter;
            await this.changeCurrentElement(targetElement, chapterPresenter.focusOutHandlerTitle.bind(chapterPresenter, targetElement));
            await chapterPresenter.highlightChapter();
            await chapterPresenter.highlightChapterHeader();
            return;
        }
        let saveFunction;
        let resetTimerFunction = this.resetTimer.bind(this);
        if (type === "title") {
            targetElement.classList.add("focused");
            let containerElement = targetElement.closest(".container-element");
            containerElement.classList.add("focused");
            await this.changeCurrentElement(targetElement, this.focusOutHandlerTitle.bind(this, targetElement, this.titleId));
            targetElement.addEventListener('keydown', this.titleKeyDownHandler);
            saveFunction = this.saveTitle.bind(this, targetElement);
        } else if (type === "infoText") {
            await this.highlightInfoText(targetElement);
            saveFunction = this.saveInfoText.bind(this, targetElement);
        } else if (type === "infoTextTitle") {
            await this.highlightInfoTextTitle(targetElement);
            saveFunction = this.saveInfoTextTitle.bind(this, targetElement);
        } else if (type === "chapterTitle") {
            targetElement.classList.add("focused")
            let chapterPresenter = targetElement.closest("chapter-item").webSkelPresenter;
            saveFunction = chapterPresenter.saveTitle.bind(chapterPresenter, targetElement);
            await this.changeCurrentElement(targetElement, chapterPresenter.focusOutHandlerTitle.bind(chapterPresenter, targetElement));
            await chapterPresenter.highlightChapter();
            await chapterPresenter.highlightChapterHeader();
            targetElement.addEventListener('keydown', this.titleKeyDownHandler.bind(this, targetElement));
        } else if (type === "paragraphText") {
            let chapterPresenter = targetElement.closest("chapter-item").webSkelPresenter;
            let paragraphItem = targetElement.closest("paragraph-item");
            let paragraphPresenter = paragraphItem.webSkelPresenter;
            await this.changeCurrentElement(targetElement, paragraphPresenter.focusOutHandler.bind(paragraphPresenter, targetElement));
            await chapterPresenter.highlightChapter();
            await paragraphPresenter.highlightParagraph();
            saveFunction = paragraphPresenter.saveParagraph.bind(paragraphPresenter, targetElement);
            resetTimerFunction = paragraphPresenter.resetTimer.bind(paragraphPresenter, targetElement);
        }
        targetElement.focus();
        await this.stopTimer(true);
        this.clearAutoSaveInputListener();
        this.autoSaveFunction = saveFunction;
        this.autoSaveInputElement = targetElement;
        this.autoSaveInputHandler = resetTimerFunction;
        targetElement.addEventListener("input", resetTimerFunction);
    }

    async exportDocument(targetElement) {
        await assistOS.UI.showModal("export-document-modal", {id: this._document.id, title: this._document.title});
    }

    hideActionsMenu(controller, container, event) {
        let clickInsideMenu = event.target.closest(`#actions-menu`);
        if (!clickInsideMenu) {
            this.element.querySelector(`#actions-menu`).style.display = "none";
            container.setAttribute("data-local-action", `showActionsMenu off`);
            controller.abort();
        }
    }

    async showActionsMenu(targetElement, mode) {
        if (mode === "off") {
            let menu = this.element.querySelector(`#actions-menu`);
            menu.style.display = "flex";
            let controller = new AbortController();
            document.addEventListener("click", this.hideActionsMenu.bind(this, controller, targetElement), {signal: controller.signal});
            targetElement.setAttribute("data-local-action", `showActionsMenu on`);
        }
    }

    // toggleEditingState(isEditable) {
    //     if (!isEditable) {
    //         this.disabledMask.style.display = "block";
    //         this.documentEditor.classList.add("disabled-editor");
    //         this.undoButton.classList.add("disabled");
    //         this.redoButton.classList.add("disabled");
    //     } else {
    //         this.documentEditor.classList.remove("disabled-editor");
    //         this.disabledMask.style.display = "none";
    //         this.undoButton.classList.remove("disabled");
    //         this.redoButton.classList.remove("disabled");
    //     }
    // }

    async openTasksModal(targetElement) {
        let newTasksBadge = this.element.querySelector(".new-tasks-badge");
        if (newTasksBadge) {
            newTasksBadge.remove();
        }
        const appPlugins = window.assistOS?.workspace?.appPlugins;
        const tasksEnabled = appPlugins && typeof appPlugins === 'object' && !Array.isArray(appPlugins)
            ? Object.values(appPlugins)
                .flatMap((bucket) => Array.isArray(bucket) ? bucket : [])
                .some((plugin) => plugin?.id === 'tasks')
            : false;
        if (!tasksEnabled) {
            await assistOS?.showToast?.('Tasks plugin is disabled.', 'info', 2500);
            return;
        }
        await assistOS.UI.showModal("document-tasks-modal", {["document-id"]: this._document.id});
    }

    renderNewTasksBadge() {
        let newTasksBadge = this.element.querySelector(".new-tasks-badge");
        if (newTasksBadge) {
            return;
        }
        newTasksBadge = `<div class="new-tasks-badge"></div>`;
        const tasksMenu = this.element.querySelector(".tasks-menu");
        tasksMenu.insertAdjacentHTML("beforeend", newTasksBadge);
    }

    async openCommentModal() {
        let comment = await assistOS.UI.showModal("add-comment", {}, true);
        if (comment !== undefined) {
            this._document.comments.messages.push(comment);
            UIUtils.changeCommentIndicator(this.element, this._document.comments.messages);
            await this.updateDocumentModel({
                title: this._document.title,
                docId: this._document.docId,
                infoText: this._document.infoText,
                commands: this._document.commands,
                comments: this._document.comments
            });
        }
    }
    showComments(iconContainer){
        assistOS.UI.createElement("comments-section", iconContainer, {
                comments: this._document.comments.messages,
                documentId: this._document.id,
            })
    }
    async updateComments(comments) {
        this._document.comments.messages = comments;
            await this.updateDocumentModel({
                title: this._document.title,
                docId: this._document.docId,
                infoText: this._document.infoText,
                commands: this._document.commands,
                comments: this._document.comments
            });
        if(this._document.comments.messages.length === 0){
            this.closeComments();
            UIUtils.changeCommentIndicator(this.element, this._document.comments.messages);
        }
    }
    closeComments(){
        let iconContainer = this.element.querySelector(".comment-icon-container");
        let commentsSection = iconContainer.querySelector("comments-section");
        commentsSection.remove();
    }

    async afterUnload() {
    }

    async translateDocument() {
        await assistOS.UI.showModal("translate-document-modal", {id: this._document.id});
    }

    async openPlugin(targetElement, type, pluginName, autoPin) {
        let pluginContainer = this.element.querySelector(`.${type}-plugin-container`);
        let pluginElement = pluginContainer.firstElementChild;
        if (pluginElement && pluginElement.tagName.toLowerCase() === pluginName) {
            return;
        }
        if (type === "document") {
            let context = {
                documentId: this._document.id
            }
            await pluginUtils.openPlugin(pluginName, "document", context, this);
        } else if (type === "infoText") {
            let context = {
                infoText: ""
            }
            await pluginUtils.openPlugin(pluginName, "infoText", context, this, autoPin);
        }
    }

    async closePlugin(targetElement, type, focusoutClose) {
        delete this.currentPlugin;
        let pluginContainer = this.element.querySelector(`.${type}-plugin-container`);
        pluginContainer.classList.remove("plugin-open");
        let pluginElement = pluginContainer.firstElementChild;
        if (!pluginElement) {
            return;
        }
        let pluginName = pluginElement.tagName.toLowerCase();
        pluginElement.remove();
        pluginUtils.removeHighlightPlugin("infoText", this);
        if (focusoutClose) {
            return pluginName;
        }
    }

    // async undoOperation(targetElement) {
    //     this.toggleEditingState(false);
    //     let success = await documentModule.undoOperation(this._document.id);
    //     if (success) {
    //         assistOS.showToast("Undo successful.", "success");
    //     } else {
    //         assistOS.showToast("Nothing to undo.", "info");
    //         this.toggleEditingState(true);
    //     }
    // }
    //
    // async redoOperation(targetElement) {
    //     this.toggleEditingState(false);
    //     let success = await documentModule.redoOperation(this._document.id);
    //     if (success) {
    //         assistOS.showToast("Redo successful.", "success");
    //     } else {
    //         assistOS.showToast("Nothing to redo.", "info");
    //         this.toggleEditingState(true);
    //     }
    // }

    async buildForDocument(button) {
        button.classList.add("disabled");
        try {
            await workspaceModule.buildForDocument(this._document.docId);
            await assistOS.showToast("Build successful", "success", 5000);
        } catch (e) {
            await assistOS.showToast("Build failed", "error", 5000);
        } finally {
            button.classList.remove("disabled");
            await this.refreshVariables();
            this.notifyObservers("variables")
        }
    }

    observeChange(elementId, callback, callbackAsyncParamFn) {
        let obj = {elementId: elementId, callback: callback, param: callbackAsyncParamFn};
        callback.refferenceObject = obj;
        this.observers.push(new WeakRef(obj));
    }

    notifyObservers(prefix) {
        this.observers = this.observers.reduce((accumulator, item) => {
            if (item.deref()) {
                accumulator.push(item);
            }
            return accumulator;
        }, []);
        for (const observerRef of this.observers) {
            const observer = observerRef.deref();
            if (observer && observer.elementId.startsWith(prefix)) {
                observer.callback(observer.param);
            }
        }
    }

    async openToc(){
        this.showTableOfContents();
        this._document.comments.toc = {
            collapsed: false
        };
        await this.updateDocumentModel({
            title: this._document.title,
            docId: this._document.docId,
            infoText: this._document.infoText,
            commands: this._document.commands,
            comments: this._document.comments
        });
    }
    showTableOfContents() {
        let contentsTable = this.element.querySelector("contents-table");
        if (contentsTable) {
            return;
        }
        const infoTextSection = this.element.querySelector('.infoText-section');
        infoTextSection.insertAdjacentHTML('afterend', `<contents-table data-presenter="contents-table"></contents-table>`);
    }

    async openTor(){
        this.showTableOfReferences();
        this._document.comments.tor = {
            collapsed: false,
            references: []
        };
        await this.updateDocumentModel({
            title: this._document.title,
            docId: this._document.docId,
            infoText: this._document.infoText,
            commands: this._document.commands,
            comments: this._document.comments
        });
    }

    showTableOfReferences() {
        let refsTable = this.element.querySelector("references-table");
        if (refsTable) {
            return;
        }
        const documentEditor = this.element.querySelector(".document-editor");
        documentEditor.insertAdjacentHTML("beforeend", `<references-table data-presenter="references-table"></references-table>`);
    }

}
