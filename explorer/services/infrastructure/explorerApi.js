import { callToolWithLoader } from '../../utils/globalLoader.js';

export class ToolError extends Error {
    constructor(code, message, data = null) {
        super(message);
        this.name = 'ToolError';
        this.code = code;
        this.data = data;
    }
}

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

export function parseToolResult(payload) {
    if (!payload) return null;
    if (typeof payload !== 'string') {
        if (Object.prototype.hasOwnProperty.call(payload, 'json')) {
            return payload.json;
        }
        const blocks = Array.isArray(payload.content) ? payload.content : null;
        if (blocks) {
            const jsonBlock = blocks.find((block) => block?.type === 'json' && block.json !== undefined);
            if (jsonBlock) return jsonBlock.json;
            const textBlock = blocks.find((block) => block?.type === 'text' && typeof block.text === 'string');
            if (textBlock?.text) {
                try {
                    return JSON.parse(textBlock.text);
                } catch {
                    return null;
                }
            }
        }
        if (typeof payload.text === 'string') {
            const trimmed = payload.text.trim();
            if (trimmed) {
                try {
                    return JSON.parse(trimmed);
                } catch {
                    return null;
                }
            }
        }
        return payload;
    }

    const trimmed = payload.trim();
    if (!trimmed) return null;
    try {
        return JSON.parse(trimmed);
    } catch {
        return null;
    }
}

export function extractToolText(payload) {
    if (!payload) return '';
    if (typeof payload === 'string') return payload;
    const blocks = Array.isArray(payload.content) ? payload.content : null;
    if (blocks) {
        const textBlock = blocks.find((block) => block?.type === 'text' && typeof block.text === 'string');
        if (textBlock?.text) return textBlock.text;
    }
    if (typeof payload.text === 'string') {
        return payload.text;
    }
    return '';
}

export function ensureSuccess(payload) {
    const text = extractToolText(payload);
    if (isNonEmptyString(text) && text.trim().startsWith('Error:')) {
        throw new ToolError('tool_error', text.trim().replace(/^Error:\s*/i, ''), { payload });
    }
    const parsed = parseToolResult(payload);
    if (parsed && typeof parsed === 'object') {
        const ok = Object.prototype.hasOwnProperty.call(parsed, 'ok') ? parsed.ok : null;
        if (ok === false) {
            const message = isNonEmptyString(parsed.error) ? parsed.error : 'Tool execution failed';
            throw new ToolError('tool_error', message, parsed);
        }
    }
}

export async function callExplorerTool(name, args, { raw = false } = {}) {
    const result = await callToolWithLoader('explorer', name, args);
    ensureSuccess(result);
    return raw ? result : extractToolText(result);
}

export async function callAgentTool(agentName, name, args, { raw = false } = {}) {
    const client = window.webSkel?.appServices?.getClient?.(agentName);
    if (!client || typeof client.callTool !== 'function') {
        throw new ToolError('client_unavailable', `Agent client not available: ${agentName}`);
    }
    const result = await client.callTool(name, args || {});
    ensureSuccess(result);
    return raw ? result : extractToolText(result);
}
