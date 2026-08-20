#!/usr/bin/env node
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import { createDpuResearchPlannerTools, executeDpuResearchTool } from '../lib/dpu-research-tools.mjs';
import { verifyWebchatInvocation } from '../lib/webchat-invocation.mjs';

const SYSTEM_PROMPT = `You are the DPU research-data agent. Use the DPU MCP tools as the only authority for resources, sources, jobs, permissions, confirmations, audit and provenance.
Never invent provider facts. Never include credentials, secret values or physical DPU storage paths. Separate providerFacts, evidence, recommendation and proposedActions in a JSON object.
External effects require a DpuActionProposal and explicit confirmation through dpu_action_confirm. Never accept Hugging Face terms automatically. Explain pending and blocked states.
Recommend local or remote execution from the resource restrictions. Do not claim secure or federated execution is available unless an active backend capability is returned by DPU tools.
For every DPU tool decision, put the arguments in exactly one fenced \`\`\`json Markdown block in the prompt section, with no surrounding text. The fence must contain one JSON object that matches the declared tool schema.
For dpu_research_search, omit sourceIds unless exact source IDs were returned by a DPU tool. Never use a provider type, provider name or guessed value as a source ID.
When a DPU tool returns recoverable=true, follow its retry instruction exactly. Do not repeat rejected arguments.`;

function parseJson(text) {
  try { return JSON.parse(String(text || '').trim()); } catch { return null; }
}

function normalizeAgentResult(raw) {
  const text = String(raw?.result ?? raw ?? '').trim();
  const parsed = parseJson(text.replace(/^```json\s*|\s*```$/g, ''));
  if (parsed && typeof parsed === 'object') return parsed;
  return { providerFacts: [], evidence: [], recommendation: text, proposedActions: [] };
}

export async function createDpuResearchAgent({
  MainAgentClass = null,
  mainAgentOptions = {},
  verifyInvocation = verifyWebchatInvocation,
  executeTool = executeDpuResearchTool
} = {}) {
  const MainAgent = MainAgentClass || (await import('achillesAgentLib')).MainAgent;
  const codeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const mainAgent = new MainAgent({ startDir: codeRoot, ...mainAgentOptions });
  let activeAuthInfo = null;
  const baseBuildTools = typeof mainAgent._buildToolsForSession === 'function'
    ? mainAgent._buildToolsForSession.bind(mainAgent)
    : () => ({});
  const researchTools = createDpuResearchPlannerTools({
    getAuthInfo: () => activeAuthInfo,
    executeTool
  });
  mainAgent._buildToolsForSession = () => ({ ...baseBuildTools(), ...researchTools });
  return {
    mainAgent,
    async handleMessage({
      message,
      workspace = {},
      selection = null,
      invocationToken = '',
      references = [],
      attachments = [],
      presentation = { visible: true },
      sourceTabId = '',
      sourcePageInstanceId = ''
    } = {}) {
      const request = String(message || '').trim();
      if (!request) throw new Error('A research request is required.');
      activeAuthInfo = await verifyInvocation({
        invocationToken,
        message: request,
        attachments,
        references,
        presentation,
        sourceTabId,
        sourcePageInstanceId
      });
      const prompt = [
        'User research request:', request,
        'Workspace context:', JSON.stringify(workspace || {}),
        'Current Explorer selection:', JSON.stringify(selection || null)
      ].join('\n');
      try {
        const execution = await mainAgent.executePrompt(prompt, {
          systemPrompt: SYSTEM_PROMPT,
          reasoningEffort: 'low',
          context: {
            workspace,
            selection,
            webchatReferences: Array.isArray(references) ? references : []
          }
        });
        return normalizeAgentResult(execution);
      } finally {
        activeAuthInfo = null;
      }
    }
  };
}

function parseArguments(argv) {
  const options = {
    once: false,
    json: false,
    message: '',
    workspaceDir: '',
    pageInstanceId: '',
    forwardEnvelope: false
  };
  const positional = [];
  for (const value of argv) {
    if (value === '-mcp') options.once = true;
    else if (value === '--json') options.json = true;
    else if (value.startsWith('--dir=')) options.workspaceDir = value.slice('--dir='.length).trim();
    else if (value.startsWith('--pageInstanceId=')) options.pageInstanceId = value.slice('--pageInstanceId='.length).trim();
    else if (value.startsWith('--forward-envelope=')) options.forwardEnvelope = /^(1|true|yes|on)$/i.test(value.slice('--forward-envelope='.length).trim());
    else if (value.startsWith('--forwardEnvelope=')) options.forwardEnvelope = /^(1|true|yes|on)$/i.test(value.slice('--forwardEnvelope='.length).trim());
    else if (value === '-h' || value === '--help') options.help = true;
    else positional.push(value);
  }
  options.message = positional.join(' ').trim();
  return options;
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  process.stdin.setEncoding('utf8');
  let value = '';
  for await (const chunk of process.stdin) value += chunk;
  return value;
}

function parseEnvelope(raw, { workspace = {} } = {}) {
  const parsed = parseJson(raw);
  const input = parsed?.input && typeof parsed.input === 'object' ? parsed.input : parsed;
  if (!input || typeof input !== 'object') {
    return {
      message: String(raw || '').trim(),
      workspace,
      selection: null,
      invocationToken: '',
      references: [],
      attachments: [],
      sourceTabId: '',
      sourcePageInstanceId: '',
      presentation: { visible: true }
    };
  }
  const references = Array.isArray(input.references) ? input.references : [];
  return {
    message: String(input.message || input.prompt || input.query || input.text || '').trim(),
    workspace: input.workspace && typeof input.workspace === 'object' ? input.workspace : workspace,
    selection: input.selection ?? (references.length ? { references } : null),
    invocationToken: String(input.invocation?.token || input.invocationToken || '').trim(),
    references,
    attachments: Array.isArray(input.attachments) ? input.attachments : [],
    sourceTabId: String(input.sourceTabId || '').trim(),
    sourcePageInstanceId: String(input.sourcePageInstanceId || '').trim(),
    presentation: { visible: input.presentation?.visible !== false }
  };
}

async function runTurn(agent, input, { output = process.stdout } = {}) {
  const result = await agent.handleMessage(input);
  output.write(`${JSON.stringify(result, null, 2)}\n`);
}

function handleWebChatCommand(turn, output) {
  if (!turn.message.startsWith('/')) return false;
  if (/^\/tasks(?:\s|$)/.test(turn.message)) {
    output.write(`${JSON.stringify({
      __webchatTask: 1,
      version: 1,
      event: 'list',
      tasks: []
    })}\n`);
    return true;
  }
  if (turn.presentation.visible) {
    output.write('This command is not supported by DPU Research.\n');
  }
  return true;
}

async function runWebChat(agent, {
  input = process.stdin,
  output = process.stdout,
  workspace = {}
} = {}) {
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    const raw = line.trim();
    if (!raw) continue;
    const turn = parseEnvelope(raw, { workspace });
    if (!turn.message || handleWebChatCommand(turn, output)) continue;
    try {
      await runTurn(agent, turn, { output });
    } catch {
      if (turn.presentation.visible) {
        output.write('The DPU research request could not be completed. You can send another request.\n');
      }
    }
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write('Usage: dpuAgent [-mcp] [--json] [--dir=<workspace>] "research request"\n');
    return;
  }
  const workspace = options.workspaceDir ? { root: options.workspaceDir } : {};
  const webChatMode = Boolean(options.pageInstanceId || options.forwardEnvelope);
  if (webChatMode) {
    const agent = await createDpuResearchAgent();
    await runWebChat(agent, { workspace });
    return;
  }
  const stdin = await readStdin();
  const envelope = parseEnvelope(stdin, { workspace });
  const initial = { ...envelope, message: options.message || envelope.message };
  if ((options.once || !process.stdin.isTTY) && !initial.message) throw new Error('MCP mode requires a research request.');
  const agent = await createDpuResearchAgent();
  if (options.once || !process.stdin.isTTY || initial.message) {
    await runTurn(agent, initial);
    if (options.once || !process.stdin.isTTY) return;
  }
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'dpu> ' });
  terminal.prompt();
  for await (const line of terminal) {
    const message = line.trim();
    if (['exit', 'quit', ':q'].includes(message)) break;
    if (message) {
      const turn = parseEnvelope(message, { workspace: envelope.workspace });
      await runTurn(agent, turn);
    }
    terminal.prompt();
  }
}

export { parseArguments, parseEnvelope, runWebChat };

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    process.stderr.write(`${error?.message || String(error)}\n`);
    process.exitCode = 1;
  });
}
