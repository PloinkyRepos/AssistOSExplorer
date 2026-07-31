import {
    applyMarkdownCrdtChange,
    computeTextDelta,
    openMarkdownCrdtDocument
} from "../../../services/crdt/markdownCrdtClient.js";
import { callExplorerTool, ensureSuccess } from "../../../services/infrastructure/explorerApi.js";
import { isDpuVirtualPath } from "../../pages/file-exp/file-exp-dpu-provider.js";
import {
    buildMarkdownLink,
    buildMarkdownImageTarget,
    escapeMarkdownLabel,
    formatMarkdownDestination,
    getEditorSelection,
    getSelectedEditorText,
    insertMarkdownAtSelection,
    validateMarkdownImage
} from "./markdown-editor-media.js";

const TINY_MDE_SCRIPT = "/explorer/assets/vendor/tiny-mde/tiny-mde.min.js";
const CRDT_CHANGE_DEBOUNCE_MS = 350;
const MARKDOWN_COMMANDS = [
    "bold", "italic", "strikethrough", "|", "code", "|", "h1", "h2", "|",
    "ul", "ol", "|", "blockquote", "hr", "|", "undo", "redo", "|"
];
let tinyMdePromise = null;

function loadTinyMde() {
    if (window.TinyMDE?.Editor) {
        return Promise.resolve(window.TinyMDE);
    }
    if (tinyMdePromise) {
        return tinyMdePromise;
    }
    tinyMdePromise = new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${TINY_MDE_SCRIPT}"]`);
        if (existing) {
            existing.addEventListener("load", () => resolve(window.TinyMDE), { once: true });
            existing.addEventListener("error", () => reject(new Error("Failed to load TinyMDE.")), { once: true });
            return;
        }
        const script = document.createElement("script");
        script.src = TINY_MDE_SCRIPT;
        script.async = true;
        script.onload = () => resolve(window.TinyMDE);
        script.onerror = () => reject(new Error("Failed to load TinyMDE."));
        document.head.appendChild(script);
    });
    return tinyMdePromise;
}

export class MarkdownEditor {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.path = this.element.dataset.filePath || "";
        this.state = {
            editorContent: "Loading..."
        };
        this.editor = null;
        this.commandBar = null;
        this.textarea = null;
        this.toolbarHost = null;
        this.imageInput = null;
        this.pendingImageInsertion = null;
        this.initVersion = 0;
        this.crdtDocumentId = "";
        this.lastSyncedContent = "";
        this.pendingChange = Promise.resolve();
        this.pendingContent = null;
        this.flushTimer = null;
        this.boundHandleChange = this.handleChange.bind(this);
        this.boundHandleDrop = this.handleDrop.bind(this);
        this.boundHandleImageSelection = this.handleImageSelection.bind(this);
        this.invalidate();
    }

    getFileExpPresenter() {
        return this.element.closest("file-exp")?.webSkelPresenter || null;
    }

    async beforeRender() {
        if (this.state.editorContent !== "Loading...") return;
        try {
            if (isDpuVirtualPath(this.path)) {
                const fileExp = this.getFileExpPresenter();
                this.state.editorContent = String(fileExp?.state?.fileContent ?? "");
            } else {
                const crdt = await openMarkdownCrdtDocument(this.path);
                this.crdtDocumentId = String(crdt?.documentId || "");
                this.state.editorContent = String(crdt?.markdown ?? "");
                this.lastSyncedContent = this.state.editorContent;
                const fileExp = this.getFileExpPresenter();
                if (fileExp && crdt?.versionKey) {
                    fileExp.setPreviewState?.({
                        selectedFileVersionKey: String(crdt.versionKey || ''),
                        fileContent: this.state.editorContent
                    }, { invalidate: false });
                }
            }
            this.invalidate();
        } catch (error) {
            console.error(error);
            this.state.editorContent = "Error loading file.";
            this.invalidate();
        }
    }

    async afterRender() {
        this.textarea = this.element.querySelector(".code-input");
        this.toolbarHost = this.element.querySelector("#markdownCommandBar");
        this.imageInput = this.element.querySelector(".markdown-image-input");
        if (this.imageInput) {
            this.imageInput.onchange = this.boundHandleImageSelection;
        }
        if (!this.textarea || !this.toolbarHost) return;

        if (this.editor?.e?.isConnected && this.element.contains(this.editor.e)) return;

        this.textarea.value = this.state.editorContent;
        this.toolbarHost.replaceChildren();
        this.editor = null;
        this.commandBar = null;
        const initVersion = ++this.initVersion;

        const TinyMDE = await loadTinyMde();
        if (!this.element.isConnected || initVersion !== this.initVersion) return;

        this.textarea = this.element.querySelector(".code-input");
        this.toolbarHost = this.element.querySelector("#markdownCommandBar");
        if (!this.textarea || !this.toolbarHost || initVersion !== this.initVersion) return;

        this.textarea.value = this.state.editorContent;
        this.toolbarHost.replaceChildren();
        this.editor = new TinyMDE.Editor({
            textarea: this.textarea
        });
        this.commandBar = new TinyMDE.CommandBar({
            element: this.toolbarHost,
            editor: this.editor,
            commands: [
                ...MARKDOWN_COMMANDS,
                {
                    name: "insertLink",
                    title: "Insert link",
                    action: (editor) => this.insertLink(editor)
                },
                {
                    name: "insertImage",
                    title: "Upload image",
                    action: (editor) => this.selectImage(editor)
                }
            ]
        });
        this.editor.addEventListener("change", this.boundHandleChange);
        this.editor.addEventListener("drop", this.boundHandleDrop);
        this.syncContent(this.editor.getContent());
    }

    async insertLink(editor) {
        const selection = getEditorSelection(editor);
        const selectedText = getSelectedEditorText(editor, selection);
        try {
            const result = await window.assistOS?.UI?.showModal?.("markdown-link-modal", {
                label: selectedText
            }, true);
            if (!result) return;
            const markdown = buildMarkdownLink(result);
            insertMarkdownAtSelection(editor, selection, markdown);
        } catch (error) {
            this.reportMediaError(error);
        }
    }

    selectImage(editor) {
        if (isDpuVirtualPath(this.path)) {
            this.reportMediaError(new Error("Image upload is not available for Confidential Markdown files."));
            return;
        }
        if (!this.imageInput) {
            this.reportMediaError(new Error("Image picker is not available."));
            return;
        }
        const selection = getEditorSelection(editor);
        this.pendingImageInsertion = {
            editor,
            selection,
            selectedText: getSelectedEditorText(editor, selection)
        };
        this.imageInput.value = "";
        this.imageInput.click();
    }

    handleDrop(event) {
        const files = Array.from(event?.dataTransfer?.files || []);
        const image = files.find((file) => String(file?.type || '').startsWith('image/'));
        if (!image || !this.editor) return;
        if (isDpuVirtualPath(this.path)) {
            this.reportMediaError(new Error("Image upload is not available for Confidential Markdown files."));
            return;
        }
        const selection = getEditorSelection(this.editor);
        void this.uploadAndInsertImage(image, {
            editor: this.editor,
            selection,
            selectedText: getSelectedEditorText(this.editor, selection)
        });
    }

    async handleImageSelection(event) {
        const file = event?.target?.files?.[0] || null;
        const insertion = this.pendingImageInsertion;
        this.pendingImageInsertion = null;
        if (!file || !insertion) return;
        await this.uploadAndInsertImage(file, insertion);
    }

    async uploadAndInsertImage(file, insertion) {
        const fileExp = this.getFileExpPresenter();
        try {
            validateMarkdownImage(file);
            const uniqueId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const target = buildMarkdownImageTarget(this.path, file, uniqueId);
            ensureSuccess(await callExplorerTool(
                "create_directory",
                { path: target.assetDirectory },
                { raw: true, withLoader: false }
            ));
            const response = await fetch(`/upload?path=${encodeURIComponent(target.targetPath)}`, {
                method: "POST",
                headers: {
                    "Content-Type": file.type
                },
                body: file
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload?.ok === false) {
                throw new Error(payload?.error || `Image upload failed (${response.status}).`);
            }
            const altText = String(insertion.selectedText || target.altText || "image").trim();
            const markdown = `![${escapeMarkdownLabel(altText)}](${formatMarkdownDestination(target.markdownPath)})`;
            insertMarkdownAtSelection(insertion.editor, insertion.selection, markdown);
            fileExp?.bumpWorkspaceVersion?.();
            fileExp?.caches?.dirListing?.invalidate?.(fileExp, target.assetDirectory);
            fileExp?.showStatus?.(`Uploaded ${file.name}.`, false);
            window.assistOS?.showToast?.("Image uploaded.", "success");
        } catch (error) {
            this.reportMediaError(error);
        } finally {
            if (this.imageInput) this.imageInput.value = "";
        }
    }

    reportMediaError(error) {
        console.error("[markdown-editor] Media action failed", error);
        const message = error?.message || "Markdown media action failed.";
        this.getFileExpPresenter()?.showStatus?.(message, true);
        window.assistOS?.showToast?.(message, "error");
    }

    handleChange(event) {
        if (!this.editor || !this.textarea) return;
        const content = event?.content ?? this.editor.getContent();
        this.syncContent(content);
        this.queueCrdtChange(content);
    }

    syncContent(content) {
        if (!this.textarea) return;
        this.textarea.value = content;
        this.state.editorContent = content;
        const fileExp = this.getFileExpPresenter();
        if (fileExp && typeof fileExp.setHasUnsavedChanges === "function") {
            fileExp.setHasUnsavedChanges(content !== String(fileExp.state?.fileContent ?? ""));
            fileExp.handleEditorBufferChange?.();
        }
    }

    queueCrdtChange(nextContent) {
        if (!this.crdtDocumentId || isDpuVirtualPath(this.path)) return;
        this.pendingContent = String(nextContent ?? "");
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
        }
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            void this.flushPendingCrdtChange().catch(() => {});
        }, CRDT_CHANGE_DEBOUNCE_MS);
    }

    flushPendingCrdtChange() {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        if (this.pendingContent === null) {
            return this.pendingChange;
        }
        const queuedContent = this.pendingContent;
        this.pendingContent = null;
        this.pendingChange = this.pendingChange
            .catch(() => {})
            .then(async () => {
                const delta = computeTextDelta(this.lastSyncedContent, queuedContent);
                if (!delta) return;
                const result = await applyMarkdownCrdtChange(this.crdtDocumentId, delta);
                if (result?.documentId) {
                    this.crdtDocumentId = String(result.documentId);
                }
                if (typeof result?.markdown === "string") {
                    this.lastSyncedContent = result.markdown;
                } else {
                    this.lastSyncedContent = queuedContent;
                }
            })
            .catch((error) => {
                console.error("[markdown-editor] Failed to apply CRDT change", error);
                if (this.pendingContent === null) {
                    this.pendingContent = queuedContent;
                }
                const fileExp = this.getFileExpPresenter();
                fileExp?.showStatus?.(error?.message || "Failed to apply Markdown CRDT change.", true);
                throw error;
            });
        return this.pendingChange;
    }

    discardPendingCrdtChange() {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        this.pendingContent = null;
        return this.pendingChange.catch(() => {});
    }

    afterUnload() {
        this.initVersion += 1;
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        this.editor = null;
        this.commandBar = null;
        this.textarea = null;
        this.toolbarHost = null;
        this.imageInput = null;
        this.pendingImageInsertion = null;
        this.crdtDocumentId = "";
        this.pendingContent = null;
    }
}
