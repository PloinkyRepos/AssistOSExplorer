#!/usr/bin/env node
import { createExplorerToolRuntime } from '../utils/server/tool-runtime.mjs';

const EMPTY_TEXT_SENTINEL = '__ASSISTOS_EXPLORER_EMPTY_TEXT__';

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  process.stdin.setEncoding('utf8');
  let data = '';
  for await (const chunk of process.stdin) {
    data += chunk;
  }
  return data;
}

function normalizeEnvelope(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  let args = {};
  if (input.input && typeof input.input === 'object') {
    args = input.input;
  } else if (input.arguments && typeof input.arguments === 'object') {
    args = input.arguments;
  } else if (input.params?.arguments && typeof input.params.arguments === 'object') {
    args = input.params.arguments;
  } else if (input.params?.input && typeof input.params.input === 'object') {
    args = input.params.input;
  } else {
    const {
      id,
      jsonrpc,
      metadata,
      method,
      params,
      tool,
      ...directArgs
    } = input;
    args = directArgs;
  }
  return {
    toolName: String(input.tool || process.env.TOOL_NAME || '').trim(),
    args,
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {}
  };
}

function writeToolResult(result) {
  const blocks = Array.isArray(result?.content) ? result.content : [];
  if (blocks.length === 1 && blocks[0]?.type === 'text' && typeof blocks[0].text === 'string') {
    process.stdout.write(blocks[0].text.length ? blocks[0].text : EMPTY_TEXT_SENTINEL);
    return;
  }
  process.stdout.write(JSON.stringify(result ?? {}));
}

async function main() {
  const raw = await readStdin();
  const { toolName, args, metadata } = normalizeEnvelope(safeParseJson(raw));
  if (!toolName) {
    throw new Error('Explorer tool name is missing.');
  }
  const runtime = await createExplorerToolRuntime();
  const result = await runtime.callTool(toolName, args, metadata);
  writeToolResult(result);
}

main().catch((error) => {
  process.stderr.write(`${error?.message || String(error)}\n`);
  process.exitCode = 1;
});
