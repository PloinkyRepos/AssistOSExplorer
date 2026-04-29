import { callExplorerTool, ensureSuccess, parseToolResult } from "../../../services/infrastructure/explorerApi.js";

export function createFileExpTooling() {
    const callTextTool = (name, args) => callExplorerTool(name, args);

    return {
        async readTextFile(path) {
            const text = await callTextTool('read_text_file', { path });
            return { text };
        },
        async listDirectoryDetailed(path) {
            const raw = await callExplorerTool('list_directory_detailed', { path }, { raw: true });
            ensureSuccess(raw);
            const parsed = parseToolResult(raw);
            if (typeof parsed === 'string') {
                return { text: parsed };
            }
            if (!Array.isArray(parsed)) {
                throw new Error('Invalid directory listing payload.');
            }
            return { text: JSON.stringify(parsed ?? []) };
        },
        async getFileInfo(path) {
            const raw = await callExplorerTool('get_file_info', { path }, { raw: true, withLoader: false });
            ensureSuccess(raw);
            const parsed = parseToolResult(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('Invalid file info payload.');
            }
            return parsed;
        },
        writeFile(path, content) {
            return callTextTool('write_file', { path, content });
        }
    };
}
