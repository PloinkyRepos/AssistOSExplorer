import { callExplorerTool } from "../../../services/infrastructure/explorerApi.js";
import { isDpuVirtualPath } from "../../pages/file-exp/file-exp-dpu-provider.js";

const TINY_MDE_SCRIPT = "/explorer/assets/vendor/tiny-mde/tiny-mde.min.js";
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
        this.initVersion = 0;
        this.boundHandleChange = this.handleChange.bind(this);
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
                const content = await callExplorerTool("read_text_file", { path: this.path });
                this.state.editorContent = String(content ?? "");
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
            editor: this.editor
        });
        this.editor.addEventListener("change", this.boundHandleChange);
        this.syncContent(this.editor.getContent());
    }

    handleChange(event) {
        if (!this.editor || !this.textarea) return;
        this.syncContent(event?.content ?? this.editor.getContent());
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

    afterUnload() {
        this.initVersion += 1;
        this.editor = null;
        this.commandBar = null;
        this.textarea = null;
        this.toolbarHost = null;
    }
}
