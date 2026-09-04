import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import vm from 'node:vm';
import {smokeConfig} from './config.mjs';
import {callAgentToolViaRouter} from './mcp.mjs';
import {withWebchatUploadProject} from './webchat.mjs';
import {attachPageDiagnostics} from './fixtures.mjs';

const EMPTY_TEXT_SENTINEL = '__ASSISTOS_EXPLORER_EMPTY_TEXT__';
const EMPTY_DIRECTORY_RESPONSE = {content: [{type: 'text', text: EMPTY_TEXT_SENTINEL}]};
const INERT_DOCUMENT = '/webchat/assets/webchat.css';

function fixture({contents = EMPTY_DIRECTORY_RESPONSE, navigationStatus = 200} = {}) {
    const events = [];
    const calls = [];
    let currentUrl = new URL(INERT_DOCUMENT, smokeConfig.baseURL).toString();
    async function fetchMcp(target, options) {
        assert.equal(options.credentials, 'include');
        if (target === '/auth/token?agent=explorer') {
            assert.equal(options.method, 'GET');
            return {ok: true, json: async () => ({browserMutation: {
                csrfToken: 'fixture-proof', routeKey: 'explorer', origin: new URL(currentUrl).origin,
            }})};
        }
        assert.equal(target, '/explorer/mcp');
        assert.equal(options.method, 'POST');
        assert.equal(options.headers['x-ploinky-browser-csrf-token'], 'fixture-proof');
        const request = JSON.parse(options.body);
        if (request.method === 'initialize') {
            return {
                ok: true,
                headers: {get: name => name === 'mcp-session-id' ? 'fixture-session' : null},
                json: async () => ({result: {protocolVersion: '2025-06-18'}}),
            };
        }
        assert.equal(request.method, 'tools/call');
        assert.equal(options.headers['mcp-session-id'], 'fixture-session');
        assert.equal(options.headers['mcp-protocol-version'], '2025-06-18');
        const call = {tool: request.params.name, args: request.params.arguments};
        assert.match(call.args.path, /^webchat-upload-[a-zA-Z0-9_-]+-[0-9a-f-]{36}$/);
        events.push(call.tool);
        calls.push(call);
        let result;
        if (call.tool === 'create_directory') {
            result = {content: [{type: 'text', text: `Successfully created directory ${call.args.path}`}]};
        } else if (call.tool === 'list_directory') {
            if (contents instanceof Error) throw contents;
            result = contents;
        } else {
            assert.equal(call.tool, 'delete_directory');
            result = {content: [{type: 'text', text: `Successfully deleted directory ${call.args.path}`}]};
        }
        return {ok: true, status: 200, json: async () => ({result})};
    }
    const page = Object.assign(new EventEmitter(), {
        url: () => currentUrl,
        async evaluate(callback, args) {
            // Execute the real browser-side MCP proof, transport and decoder code.
            // Isolated globals prevent this synthetic network from affecting other tests.
            return vm.runInNewContext(`(${callback.toString()})(args)`, {
                args, fetch: fetchMcp, window: {location: {origin: new URL(currentUrl).origin}},
            });
        },
        async goto(target, options) {
            events.push('quiesce');
            assert.equal(target, INERT_DOCUMENT);
            assert.equal(options.waitUntil, 'load');
            currentUrl = new URL(target, smokeConfig.baseURL).toString();
            return {status: () => navigationStatus};
        },
    });
    attachPageDiagnostics(page, {}, 'upload-project-unit');
    const dependencies = {
        async signInFn(target, account, returnTo) {
            events.push('authenticate');
            assert.equal(target, page);
            assert.equal(account, smokeConfig.primaryUser);
            assert.equal(returnTo, INERT_DOCUMENT);
        },
    };
    return {page, dependencies, events, calls};
}

test('upload project accepts the exact empty-text transport sentinel and cleans the same unique directory after quiescing', async () => {
    const directories = [];
    for (let index = 0; index < 2; index += 1) {
        const contents = index ? {...EMPTY_DIRECTORY_RESPONSE, isError: false} : EMPTY_DIRECTORY_RESPONSE;
        const {page, dependencies, events, calls} = fixture({contents});
        await withWebchatUploadProject(page, async directory => {
            directories.push(directory);
            events.push('body');
            assert.equal(directory, calls[0].args.path);
        }, dependencies);
        assert.deepEqual(events, ['authenticate', 'create_directory', 'list_directory', 'body', 'quiesce', 'delete_directory']);
        assert.ok(calls.every(call => call.args.path === directories[index]));
    }
    assert.notEqual(directories[0], directories[1]);
});

for (const [label, contents] of [
    ['non-empty listing', {content: [{type: 'text', text: '[FILE] unexpected.txt'}]}],
    ['ordinary error text', {content: [{type: 'text', text: 'Error: Access denied'}]}],
    ['missing content', {}],
    ['missing result', null],
    ['empty content array', {content: []}],
    ['malformed content object', {content: {type: 'text', text: EMPTY_TEXT_SENTINEL}}],
    ['non-text block', {content: [{type: 'json', json: {rawText: EMPTY_TEXT_SENTINEL}}]}],
    ['malformed text block', {content: [{type: 'text', text: null}]}],
    ['raw empty string instead of the routed sentinel', {content: [{type: 'text', text: ''}]}],
    ['sentinel prefix', {content: [{type: 'text', text: `${EMPTY_TEXT_SENTINEL} extra`}]}],
    ['JSON text masquerading as the sentinel', {content: [{type: 'text', text: JSON.stringify({rawText: EMPTY_TEXT_SENTINEL})}]}],
    ['error envelope with sentinel text', {...EMPTY_DIRECTORY_RESPONSE, isError: true}],
    ['malformed error flag', {...EMPTY_DIRECTORY_RESPONSE, isError: 'true'}],
    ['sentinel followed by non-empty text', {content: [...EMPTY_DIRECTORY_RESPONSE.content, {type: 'text', text: '[FILE] unexpected.txt'}]}],
    ['sentinel followed by empty text', {content: [...EMPTY_DIRECTORY_RESPONSE.content, {type: 'text', text: ''}]}],
    ['sentinel followed by JSON', {content: [...EMPTY_DIRECTORY_RESPONSE.content, {type: 'json', json: {rawText: EMPTY_TEXT_SENTINEL}}]}],
]) {
    test(`upload project rejects ${label} before the body and still cleans up`, async () => {
        const {page, dependencies, events, calls} = fixture({contents});
        await assert.rejects(withWebchatUploadProject(page, async () => {
            assert.fail('invalid directory evidence must not admit the upload body');
        }, dependencies), /exact successful text result/);
        assert.deepEqual(events, ['authenticate', 'create_directory', 'list_directory', 'quiesce', 'delete_directory']);
        assert.equal(calls.at(-1).args.path, calls[0].args.path);
    });
}

test('upload project preserves list and body errors while completing exact-directory cleanup', async () => {
    for (const phase of ['list', 'body']) {
        const failure = new Error(`${phase} fixture failure`);
        const {page, dependencies, events} = fixture({contents: phase === 'list' ? failure : EMPTY_DIRECTORY_RESPONSE});
        await assert.rejects(withWebchatUploadProject(page, async () => {
            events.push('body');
            throw failure;
        }, dependencies), error => error === failure);
        assert.deepEqual(events.slice(-2), ['quiesce', 'delete_directory']);
    }
});

test('upload project does not delete its working directory when quiescent navigation fails', async () => {
    const {page, dependencies, events} = fixture({navigationStatus: 503});
    await assert.rejects(withWebchatUploadProject(page, async () => {}, dependencies), /inert cleanup document must load successfully/);
    assert.deepEqual(events, ['authenticate', 'create_directory', 'list_directory', 'quiesce']);
});

test('the MCP decoder keeps its normal JSON decoding when exact raw text is not requested', async () => {
    const {page} = fixture({contents: {content: [{type: 'text', text: '{"entries":[]}'}, {type: 'text', text: 'details'}]}});
    const result = await callAgentToolViaRouter(page, {
        agent: 'explorer', tool: 'list_directory', args: {path: 'webchat-upload-unit-12345678-1234-1234-1234-123456789012'},
    });
    assert.equal(JSON.stringify(result), '{"entries":[]}');
});
