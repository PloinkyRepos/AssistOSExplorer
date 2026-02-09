import { callAgentTool } from "./infrastructure/explorerApi.js";

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
    const raw = await callAgentTool('llmAssistant', 'llm_autocomplete', payload, { raw: true });
    const parsed = parseJsonToolResult(raw) || raw;

    if (parsed && typeof parsed === 'object') {
        if (parsed.ok === false) {
            throw new Error(parsed.error || 'LLM autocomplete failed.');
        }
        const candidate = parsed.content || parsed.message || parsed.result;
        if (typeof candidate === 'string' && candidate.trim()) {
            return candidate;
        }
    }

    if (typeof parsed === 'string' && parsed.trim()) {
        return parsed;
    }

    throw new Error('LLM autocomplete returned an empty response.');
}
