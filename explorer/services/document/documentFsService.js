import { parseMarkdownDocument, serializeMarkdownDocument } from './markdownDocumentParser.js';

const EXPLORER_AGENT_ID = 'explorer';

const resolveAppServices = (appServices) => {
    if (appServices && typeof appServices.callTool === 'function') {
        return appServices;
    }

    if (typeof window !== 'undefined'
        && window.webSkel?.appServices
        && typeof window.webSkel.appServices.callTool === 'function') {
        return window.webSkel.appServices;
    }

    throw new Error('DocumentFsService: Unable to resolve appServices.');
};

const ensureSuccess = (result, path) => {
    const text = result?.text ?? '';
    if (typeof text === 'string' && text.startsWith('Error:')) {
        throw new Error(`DocumentFsService: Operation failed for ${path}: ${text.replace('Error:', '').trim()}`);
    }
    return result;
};

export default class DocumentFsService {
    constructor(appServices) {
        this.appServices = appServices;
    }

    get explorer() {
        return resolveAppServices(this.appServices);
    }

    async readRaw(path) {
        if (!path) {
            throw new Error('DocumentFsService.readRaw requires a file path.');
        }

        const result = await this.explorer.callTool(EXPLORER_AGENT_ID, 'read_text_file', { path });
        ensureSuccess(result, path);
        return result.text ?? '';
    }

    async readDocument(path) {
        const raw = await this.readRaw(path);
        const document = parseMarkdownDocument(raw);
        return {
            path,
            raw,
            document
        };
    }

    async writeRaw(path, content) {
        if (!path) {
            throw new Error('DocumentFsService.writeRaw requires a file path.');
        }

        await this.explorer.callTool(EXPLORER_AGENT_ID, 'write_file', {
            path,
            content: content ?? ''
        });
    }

    async writeDocument(path, documentOrContent) {
        const content = typeof documentOrContent === 'string'
            ? documentOrContent
            : serializeMarkdownDocument(documentOrContent);

        await this.writeRaw(path, content);
        return content;
    }
}
