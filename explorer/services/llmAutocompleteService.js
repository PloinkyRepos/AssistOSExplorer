import {
    callExplorerTool,
    ensureSuccess,
    extractToolText
} from "./infrastructure/explorerApi.js";
import { emitAuditEvent } from "./audit/auditService.js";

function parseJsonToolResult(toolResultText) {
    if (!toolResultText) return null;

    const extractJson = (payload) => {
        if (!payload || typeof payload !== 'object') {
            return null;
        }

        if (Object.prototype.hasOwnProperty.call(payload, 'json')) {
            return payload.json;
        }

        const blocks = Array.isArray(payload.content) ? payload.content : null;
        if (blocks) {
            const jsonBlock = blocks.find((block) => block?.type === 'json' && block.json !== undefined);
            if (jsonBlock) {
                return jsonBlock.json;
            }
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

        return null;
    };

    const text = extractToolText(toolResultText);
    if (text) {
        try {
            return JSON.parse(text.trim());
        } catch {
            return null;
        }
    }

    if (typeof toolResultText === 'string') {
        const trimmed = toolResultText.trim();
        if (!trimmed) return null;
        try {
            return JSON.parse(trimmed);
        } catch {
            return null;
        }
    }

    return extractJson(toolResultText);
}

export async function requestLlmAutocomplete({ path, content, cursorOffset, language }) {
    const payload = {
        path,
        content,
        cursorOffset,
        language
    };
    void emitAuditEvent('copilot.prompt', {
        path,
        language,
        prompt: content,
        metadata: {
            cursorOffset
        }
    });
    const raw = await callExplorerTool('llm_autocomplete', payload, { raw: true, withLoader: false });
    ensureSuccess(raw);
    const parsed = parseJsonToolResult(raw) || raw;

    if (parsed && typeof parsed === 'object') {
        if (parsed.ok === false) {
            const message = parsed.error || 'LLM autocomplete failed.';
            if (/autocomplete timed out|empty completion/i.test(message)) {
                return '';
            }
            throw new Error(message);
        }
        const candidate = parsed.content || parsed.message || parsed.result;
        if (typeof candidate === 'string' && candidate.trim()) {
            void emitAuditEvent('copilot.response', {
                path,
                language,
                response: candidate,
                metadata: {
                    cursorOffset
                }
            });
            return candidate;
        }
    }

    if (typeof parsed === 'string' && parsed.trim()) {
        void emitAuditEvent('copilot.response', {
            path,
            language,
            response: parsed,
            metadata: {
                cursorOffset
            }
        });
        return parsed;
    }

    throw new Error('LLM autocomplete returned an empty response.');
}
