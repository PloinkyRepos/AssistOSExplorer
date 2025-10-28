import markdownDocumentService from "./markdownDocumentService.js";

class DocumentService {
    constructor() {
        this.appServices = null;
    }

    registerAppServices(appServices) {
        this.appServices = appServices;
    }

    ensureAppServices() {
        if (!this.appServices) {
            if (window?.webSkel?.appServices) {
                this.appServices = window.webSkel.appServices;
            } else {
                throw new Error("DocumentService is not initialised with app services.");
            }
        }
        return this.appServices;
    }

    getSidecarPath(path) {
        if (!path) {
            throw new Error("Cannot determine sidecar path for empty path.");
        }
        return `${path}.assistdoc.json`;
    }

    async loadDocument(path) {
        if (!path) {
            throw new Error("Path is required to load a document.");
        }

        const appServices = this.ensureAppServices();
        const fileName = path.split("/").pop();
        const markdown = await this.readTextFile(appServices, path, { defaultValue: "" });

        const sidecarPath = this.getSidecarPath(path);
        const sidecar = await this.readJSONFile(appServices, sidecarPath, { optional: true }) ?? {};

        const document = markdownDocumentService.parse(markdown, sidecar, { path, fileName });
        document.path = path;
        document.sidecarPath = sidecarPath;
        document.markdown = markdown;
        document.sidecar = sidecar;
        document.lastSavedAt = new Date();
        return document;
    }

    async saveDocument(document) {
        if (!document?.path) {
            throw new Error("Document path is required for saving.");
        }

        const appServices = this.ensureAppServices();
        const { markdown, sidecar } = markdownDocumentService.serialize(document);

        await this.writeTextFile(appServices, document.path, markdown);
        const sidecarPath = document.sidecarPath || this.getSidecarPath(document.path);
        await this.writeJSONFile(appServices, sidecarPath, sidecar);

        document.sidecarPath = sidecarPath;
        document.markdown = markdown;
        document.sidecar = sidecar;
        document.lastSavedAt = new Date();
        return { markdown, sidecar };
    }

    async readTextFile(appServices, path, { defaultValue = null } = {}) {
        if (!path) {
            throw new Error("readTextFile requires a path.");
        }
        const result = await appServices.callTool("explorer", "read_text_file", { path });
        if (typeof result?.text === "string" && result.text.startsWith("Error:")) {
            if (defaultValue !== null) {
                return defaultValue;
            }
            throw new Error(result.text.replace(/^Error:\s*/, "") || `Unable to read "${path}"`);
        }
        return result?.text ?? "";
    }

    async writeTextFile(appServices, path, content) {
        if (!path) {
            throw new Error("writeTextFile requires a path.");
        }
        await appServices.callTool("explorer", "write_file", {
            path,
            content: content ?? ""
        });
    }

    async readJSONFile(appServices, path, { optional = false } = {}) {
        try {
            const content = await this.readTextFile(appServices, path, { defaultValue: null });
            if (content === null) {
                return optional ? null : {};
            }
            if (!content.trim()) {
                return {};
            }
            return JSON.parse(content);
        } catch (error) {
            if (optional) {
                return null;
            }
            throw error;
        }
    }

    async writeJSONFile(appServices, path, data) {
        const content = `${JSON.stringify(data ?? {}, null, 2)}\n`;
        await this.writeTextFile(appServices, path, content);
    }
}

const documentService = new DocumentService();
export default documentService;
