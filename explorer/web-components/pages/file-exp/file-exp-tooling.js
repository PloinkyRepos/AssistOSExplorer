import { callExplorerTool, parseToolResult } from "../../../services/infrastructure/explorerApi.js";

export function createFileExpTooling() {
    const callTextTool = (name, args) => callExplorerTool(name, args);

    return {
        async readTextFile(path) {
            const text = await callTextTool('read_text_file', { path });
            return { text };
        },
        async listDirectoryDetailed(path) {
            const raw = await callExplorerTool('list_directory_detailed', { path }, { raw: true });
            const parsed = parseToolResult(raw);
            if (typeof parsed === 'string') {
                return { text: parsed };
            }
            return { text: JSON.stringify(parsed ?? []) };
        },
        writeFile(path, content) {
            return callTextTool('write_file', { path, content });
        }
    };
}
