#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import { createWebAssistAgent } from './WebAssistAgent.mjs';

function printUsage() {
    process.stdout.write(`Usage:\n  webAssist/src/index.mjs "message"\n  webAssist/src/index.mjs -mcp "message"\n\nOptions:\n  -mcp                         Run a single request and exit\n  --session-id <id>            Reuse a specific session id\n  --json                       Print JSON output from runtime\n  --data-dir <dir>             Override data directory\n  --agent-root <dir>           Override agent root directory\n  -h, --help                   Show this help\n`);
}

function generateSessionId() {
    const timestamp = new Date().toISOString().replace(/[-:.]/g, '').replace(/\.\d+Z$/, 'Z');
    const nonce = randomBytes(4).toString('hex');
    return `session-${timestamp}-${nonce}`;
}

function parseArguments(argv) {
    const positionals = [];
    const options = {
        mode: 'interactive',
        sessionId: '',
        json: false,
        dataDir: '',
        agentRoot: '',
        help: false,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];

        if (token === '--') {
            for (let cursor = index + 1; cursor < argv.length; cursor += 1) {
                positionals.push(argv[cursor]);
            }
            break;
        }

        if (token === '-mcp') {
            options.mode = 'mcp';
            continue;
        }

        if (token === '--json') {
            options.json = true;
            continue;
        }

        if (token === '-h' || token === '--help') {
            options.help = true;
            continue;
        }

        if (token.startsWith('--session-id=')) {
            options.sessionId = token.slice('--session-id='.length);
            continue;
        }

        if (token === '--session-id') {
            const value = argv[index + 1];
            if (!value) {
                throw new Error('Missing value for --session-id');
            }
            options.sessionId = value;
            index += 1;
            continue;
        }

        if (token.startsWith('--data-dir=')) {
            options.dataDir = token.slice('--data-dir='.length);
            continue;
        }

        if (token === '--data-dir') {
            const value = argv[index + 1];
            if (!value) {
                throw new Error('Missing value for --data-dir');
            }
            options.dataDir = value;
            index += 1;
            continue;
        }

        if (token.startsWith('--agent-root=')) {
            options.agentRoot = token.slice('--agent-root='.length);
            continue;
        }

        if (token === '--agent-root') {
            const value = argv[index + 1];
            if (!value) {
                throw new Error('Missing value for --agent-root');
            }
            options.agentRoot = value;
            index += 1;
            continue;
        }

        if (token.startsWith('-')) {
            throw new Error(`Unknown option: ${token}`);
        }

        positionals.push(token);
    }

    return {
        ...options,
        message: positionals.join(' ').trim(),
    };
}

function parseMcpPayload(rawInput) {
    const trimmed = String(rawInput ?? '').trim();
    if (!trimmed) {
        return null;
    }

    try {
        const envelope = JSON.parse(trimmed);
        if (!envelope || typeof envelope !== 'object') {
            return null;
        }

        const input = envelope.input && typeof envelope.input === 'object'
            ? envelope.input
            : envelope;

        const messageCandidates = [
            input.message,
            input.prompt,
            input.promptText,
            input.text,
            input.query,
        ];

        const message = messageCandidates
            .find((value) => typeof value === 'string' && value.trim())
            ?.trim() || '';

        return {
            isEnvelope: Boolean(envelope.input),
            message,
            sessionId: typeof input.sessionId === 'string' ? input.sessionId.trim() : '',
            json: input.json === true,
            dataDir: typeof input.dataDir === 'string' ? input.dataDir.trim() : '',
            agentRoot: typeof input.agentRoot === 'string' ? input.agentRoot.trim() : '',
        };
    } catch {
        return null;
    }
}

async function readStdin() {
    if (process.stdin.isTTY) {
        return '';
    }

    process.stdin.setEncoding('utf8');
    let data = '';
    for await (const chunk of process.stdin) {
        data += chunk;
    }
    return data;
}

async function runTurn(agent, {
    sessionId,
    message,
    jsonOutput,
    mcpOutput = false,
}) {
    const result = await agent.handleMessage({ sessionId, message });
    if (mcpOutput) {
        const payload = {
            sessionId: String(result.sessionId ?? sessionId ?? '').trim(),
            message: String(result.response ?? '').trim(),
        };
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        return;
    }
    if (jsonOutput) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
    }
    process.stdout.write(`${result.response}\n`);
}

async function runInteractive(agent, state) {
    if (!state.json) {
        process.stdout.write(`Session ID: ${state.sessionId}\n`);
        process.stdout.write('Type exit to leave\n');
    }

    if (state.message) {
        await runTurn(agent, {
            sessionId: state.sessionId,
            message: state.message,
            jsonOutput: state.json,
        });
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: 'you> ',
    });

    rl.on('SIGINT', () => {
        process.stdout.write('\n');
        rl.close();
        process.exit(130);
    });

    rl.prompt();
    for await (const line of rl) {
        const text = line.trim();
        if (!text) {
            rl.prompt();
            continue;
        }

        if (text === 'exit' || text === 'quit' || text === ':q') {
            rl.close();
            break;
        }

        await runTurn(agent, {
            sessionId: state.sessionId,
            message: text,
            jsonOutput: state.json,
        });
        rl.prompt();
    }
}

async function main() {
    const cli = parseArguments(process.argv.slice(2));
    if (cli.help) {
        printUsage();
        return;
    }

    const stdinRaw = await readStdin();

    const effective = {
        mode: cli.mode,
        sessionId: cli.sessionId,
        json: cli.json,
        dataDir: cli.dataDir,
        agentRoot: cli.agentRoot,
        message: cli.message,
    };

    if (effective.mode === 'mcp') {
        const mcpPayload = parseMcpPayload(stdinRaw);
        if (mcpPayload) {
            if (!effective.message && mcpPayload.message) {
                effective.message = mcpPayload.message;
            }
            if (!effective.sessionId && mcpPayload.sessionId) {
                effective.sessionId = mcpPayload.sessionId;
            }
            if (!effective.dataDir && mcpPayload.dataDir) {
                effective.dataDir = mcpPayload.dataDir;
            }
            if (!effective.agentRoot && mcpPayload.agentRoot) {
                effective.agentRoot = mcpPayload.agentRoot;
            }
            if (!cli.json && mcpPayload.json) {
                effective.json = true;
            }
        } else if (!effective.message && stdinRaw) {
            effective.message = stdinRaw.trim();
        }
    }

    if (!effective.sessionId) {
        effective.sessionId = generateSessionId();
    }

    if (effective.mode === 'mcp' && !effective.message) {
        throw new Error('MCP mode requires a message.');
    }

    const agent = await createWebAssistAgent({
        agentRoot: effective.agentRoot || undefined,
        dataDir: effective.dataDir || undefined,
    });

    if (effective.mode === 'mcp') {
        await runTurn(agent, {
            sessionId: effective.sessionId,
            message: effective.message,
            jsonOutput: effective.json,
            mcpOutput: true,
        });
        return;
    }

    await runInteractive(agent, effective);
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
    main().catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}

export { createWebAssistAgent } from './WebAssistAgent.mjs';
