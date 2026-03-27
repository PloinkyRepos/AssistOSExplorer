import test from 'node:test';
import assert from 'node:assert/strict';
import { callAgentTool, parseToolResult, ensureSuccess, ToolError } from '../../services/infrastructure/explorerApi.js';

test('parseToolResult handles content json block', () => {
    const payload = {
        content: [{ type: 'json', json: { ok: true, value: 42 } }]
    };
    assert.deepEqual(parseToolResult(payload), { ok: true, value: 42 });
});

test('parseToolResult handles text json', () => {
    const payload = { text: '{"ok":true,"items":[1,2]}' };
    assert.deepEqual(parseToolResult(payload), { ok: true, items: [1, 2] });
});

test('ensureSuccess throws ToolError on Error text', () => {
    const payload = { text: 'Error: something went wrong' };
    assert.throws(() => ensureSuccess(payload), (err) => {
        assert.ok(err instanceof ToolError);
        assert.equal(err.code, 'tool_error');
        return true;
    });
});

test('ensureSuccess throws ToolError on ok false', () => {
    const payload = { text: '{"ok":false,"error":"bad"}' };
    assert.throws(() => ensureSuccess(payload), (err) => {
        assert.ok(err instanceof ToolError);
        assert.equal(err.code, 'tool_error');
        return true;
    });
});
