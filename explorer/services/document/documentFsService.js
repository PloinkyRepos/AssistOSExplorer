import { parseMarkdownDocument, serializeMarkdownDocument } from './markdownDocumentParser.js';
import { callToolWithLoader } from '../../utils/globalLoader.js';
import { callAgentTool, callExplorerTool, extractToolText, parseToolResult, ToolError } from '../infrastructure/explorerApi.js';
import {
    applyMarkdownCrdtChange,
    openMarkdownCrdtDocument,
    saveMarkdownCrdtDocument
} from '../crdt/markdownCrdtClient.js';
import {
    DPU_MY_SPACE_PATH,
    DPU_SHARED_PATH,
    isDpuSecretPath,
    isDpuVirtualPath,
    normalizeDpuPath,
    resolveDpuSecretKey
} from '../dpu/dpuPaths.js';
import { resolveDpuConfidentialNodeAtPath } from '../dpu/dpuPathResolver.js';
import { isDpuFileType } from '../dpu/dpuTypes.js';

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
        this.markdownOperationQueues = new Map();
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

    async callDpu(name, args = {}) {
        const raw = await callAgentTool('dpuAgent', name, args, { raw: true });
        const parsed = parseToolResult(raw);
        if (!parsed || typeof parsed !== 'object') {
            throw new ToolError('invalid_dpu_response', `Invalid DPU response for ${name}.`);
        }
        if (parsed.ok === false) {
            throw new ToolError('dpu_error', parsed.error || `DPU call failed: ${name}`, parsed);
        }
        return parsed;
    }

    async resolveDpuConfidentialNode(path) {
        const normalizedPath = normalizeDpuPath(path);
        if (normalizedPath === DPU_MY_SPACE_PATH) {
            const roots = await this.callDpu('dpu_workspace_roots');
            return {
                id: roots?.roots?.mySpace?.id || '',
                type: 'folder',
                name: 'My Space'
            };
        }

        if (normalizedPath === DPU_SHARED_PATH) {
            return {
                id: '',
                type: 'folder',
                name: 'Shared with me'
            };
        }
        return resolveDpuConfidentialNodeAtPath(normalizedPath, {
            getRoots: async () => (await this.callDpu('dpu_workspace_roots'))?.roots || {},
            listConfidential: async (args) => this.callDpu('dpu_confidential_list', args)
        });
    }

    async readRaw(path) {
        if (!path) {
            throw new Error('DocumentFsService.readRaw requires a file path.');
        }

        if (isDpuVirtualPath(path)) {
            if (isDpuSecretPath(path)) {
                const secretKey = resolveDpuSecretKey(path);
                if (!secretKey) {
                    throw new Error(`DPU secret path is invalid: ${path}`);
                }
                const parsed = await this.callDpu('dpu_secret_get', { key: secretKey });
                const secret = parsed.secret || {};
                if (!secret.valueVisible) {
                    throw new Error(`DPU secret is not readable: ${path}`);
                }
                return String(secret.value ?? '');
            }

            const node = await this.resolveDpuConfidentialNode(path);
            if (!node?.id) {
                throw new Error(`DPU confidential file not found: ${path}`);
            }
            const parsed = await this.callDpu('dpu_confidential_get', { id: node.id });
            const objectRecord = parsed.object || {};
            if (!isDpuFileType(objectRecord.type, node.type)) {
                throw new Error(`DPU path is not a file: ${path}`);
            }
            if (!objectRecord.contentVisible) {
                throw new Error(`DPU confidential file is not readable: ${path}`);
            }
            return String(objectRecord.content ?? '');
        }

        const result = await this.callExplorer('read_text_file', { path });
        ensureSuccess(result, path);
        return extractToolText(result);
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

    enqueueMarkdownOperation(path, operation) {
        const key = String(path || '');
        const previous = this.markdownOperationQueues.get(key) || Promise.resolve();
        const run = previous
            .catch(() => {})
            .then(operation);
        const tracked = run.finally(() => {
            if (this.markdownOperationQueues.get(key) === tracked) {
                this.markdownOperationQueues.delete(key);
            }
        });
        this.markdownOperationQueues.set(key, tracked);
        return tracked;
    }

    async waitForPendingMarkdownChanges(path) {
        const pending = this.markdownOperationQueues.get(String(path || ''));
        if (pending) {
            await pending;
        }
    }

    async applyMarkdownChange(path, change, { save = true } = {}) {
        if (!path) {
            throw new Error('DocumentFsService.applyMarkdownChange requires a file path.');
        }
        if (isDpuVirtualPath(path) || !String(path || '').toLowerCase().endsWith('.md')) {
            throw new Error('DocumentFsService.applyMarkdownChange only supports workspace Markdown files.');
        }
        return this.enqueueMarkdownOperation(path, async () => {
            const crdt = await openMarkdownCrdtDocument(path);
            const documentId = String(crdt?.documentId || '');
            const result = await applyMarkdownCrdtChange(documentId, change);
            if (save) {
                await saveMarkdownCrdtDocument({ documentId: String(result?.documentId || documentId), path });
            }
            return result;
        });
    }

    async writeRaw(path, content) {
        if (!path) {
            throw new Error('DocumentFsService.writeRaw requires a file path.');
        }

        if (isDpuVirtualPath(path)) {
            if (isDpuSecretPath(path)) {
                const secretKey = resolveDpuSecretKey(path);
                if (!secretKey) {
                    throw new Error(`DPU secret path is invalid: ${path}`);
                }
                await this.callDpu('dpu_secret_put', {
                    key: secretKey,
                    value: content ?? ''
                });
                return;
            }

            const node = await this.resolveDpuConfidentialNode(path);
            if (!node?.id) {
                throw new Error(`DPU confidential file not found: ${path}`);
            }
            await this.callDpu('dpu_confidential_update', {
                id: node.id,
                content: content ?? ''
            });
            return;
        }

        if (String(path || '').toLowerCase().endsWith('.md')) {
            await this.applyMarkdownChange(path, {
                type: 'replaceDocumentFromMarkdown',
                markdown: content ?? ''
            });
            return;
        }

        await this.callExplorer('write_file', { path, content: content ?? '' });
    }

    async writeDocument(path, documentOrContent) {
        if (
            !isDpuVirtualPath(path)
            && String(path || '').toLowerCase().endsWith('.md')
            && documentOrContent
            && typeof documentOrContent === 'object'
        ) {
            await this.applyMarkdownChange(path, {
                type: 'replaceDocumentModel',
                model: documentOrContent
            });
            return serializeMarkdownDocument(documentOrContent);
        }

        const content = typeof documentOrContent === 'string'
            ? documentOrContent
            : serializeMarkdownDocument(documentOrContent);

        await this.writeRaw(path, content);
        return content;
    }
}
