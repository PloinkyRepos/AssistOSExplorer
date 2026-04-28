#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import { createWebAdminAgent } from './WebAdminAgent.mjs';

const SINGLE_LINE_BATCH_MS = 120;
const MULTILINE_PASTE_BATCH_MS = 1800;

function printUsage() {
    process.stdout.write(`Usage:\n  webAdmin/src/index.mjs "message"\n\nOptions:\n  --session-id <id>            Reuse a specific session id\n  --data-dir <dir>             Override data directory\n  --agent-root <dir>           Override agent root directory\n  -h, --help                   Show this help\n`);
}

function generateSessionId() {
    const timestamp = new Date().toISOString().replace(/[-:.]/g, '').replace(/\.\d+Z$/, 'Z');
    const nonce = randomBytes(4).toString('hex');
    return `session-${timestamp}-${nonce}`;
}

function parseArguments(argv) {
    const positionals = [];
    const options = {
        sessionId: '',
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

async function runTurn(agent, { sessionId, message }) {
    const result = await agent.handleMessage({ sessionId, message });
    process.stdout.write(`${result.response}\n`);
}

async function runInteractive(agent, state) {
    process.stdout.write(`Session ID: ${state.sessionId}\n`);
    process.stdout.write('Type exit to leave\n');

    if (state.message) {
        await runTurn(agent, {
            sessionId: state.sessionId,
            message: state.message,
        });
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: 'you> ',
    });
    let isClosing = false;
    let pendingLines = [];
    let flushTimer = null;
    let processingChain = Promise.resolve();

    const flushPendingLines = () => {
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        if (pendingLines.length === 0) {
            return;
        }

        const message = pendingLines.join('\n').trim();
        pendingLines = [];

        processingChain = processingChain.then(async () => {
            if (!message) {
                if (!isClosing) {
                    rl.prompt();
                }
                return;
            }
            if (message === 'exit' || message === 'quit' || message === ':q') {
                isClosing = true;
                rl.close();
                return;
            }
            await runTurn(agent, {
                sessionId: state.sessionId,
                message,
            });
            if (!isClosing) {
                rl.prompt();
            }
        });
    };

    const scheduleFlush = () => {
        if (flushTimer) {
            clearTimeout(flushTimer);
        }
        const batchDelay = pendingLines.length > 1
            ? MULTILINE_PASTE_BATCH_MS
            : SINGLE_LINE_BATCH_MS;
        flushTimer = setTimeout(() => {
            flushPendingLines();
        }, batchDelay);
    };

    rl.on('SIGINT', () => {
        process.stdout.write('\n');
        isClosing = true;
        flushPendingLines();
        rl.close();
        process.exit(130);
    });
    rl.on('line', (line) => {
        pendingLines.push(line);
        scheduleFlush();
    });

    rl.prompt();
    await new Promise((resolve) => rl.once('close', resolve));
    flushPendingLines();
    await processingChain;
}

async function main() {
    const cli = parseArguments(process.argv.slice(2));
    if (cli.help) {
        printUsage();
        return;
    }

    if (!cli.sessionId) {
        cli.sessionId = generateSessionId();
    }

    const agent = await createWebAdminAgent({
        agentRoot: cli.agentRoot || undefined,
        dataDir: cli.dataDir || undefined,
    });

    await runInteractive(agent, cli);
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
    main().catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}

export { createWebAdminAgent } from './WebAdminAgent.mjs';
