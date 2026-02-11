import { parseMarkdownDocument, serializeMarkdownDocument } from './markdownDocumentParser.js';
import { callToolWithLoader } from '../../utils/globalLoader.js';
import { callExplorerTool } from '../infrastructure/explorerApi.js';

const resolveAppServices = (appServices) => {
    if (appServices && typeof appServices.callTool === 'function') {
        return appServices;
    }
    return null;
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

    async callExplorer(name, args) {
        // Keep compatibility with explicit injected appServices (tests/custom hosts),
        // otherwise use the centralized explorerApi path.
        if (this.explorer) {
            return callToolWithLoader('explorer', name, args, this.explorer);
        }
        return callExplorerTool(name, args, { raw: true });
    }

    async readRaw(path) {
        if (!path) {
            throw new Error('DocumentFsService.readRaw requires a file path.');
        }

        const result = await this.callExplorer('read_text_file', { path });
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

        await this.callExplorer('write_file', {
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
