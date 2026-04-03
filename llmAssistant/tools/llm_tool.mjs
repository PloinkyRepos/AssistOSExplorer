#!/usr/bin/env node
import { getDefaultLLMAgent, registerDefaultLLMAgent } from 'achillesAgentLib/LLMAgents';
import gitCommitMessage from '../lib/git-commit-message.js';
import resolveConflict from '../lib/git-resolve-conflict.js';

const MAX_PREFIX_CHARS = 12000;
const MAX_SUFFIX_CHARS = 6000;
const MAX_FOCUS_CHARS = 2000;

function safeParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function writeJson(value) {
  process.stdout.write(JSON.stringify(value));
}

async function readStdinFallback() {
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

function normalizeInput(envelope) {
  let current = envelope;
  for (let i = 0; i < 4; i += 1) {
    if (!current || typeof current !== 'object') break;
    if (current.input && typeof current.input === 'object') {
      current = current.input;
      continue;
    }
    if (current[arguments] && typeof current[arguments] === 'object') {
      current = current[arguments];
      continue;
    }
    if (current.params?.arguments && typeof current.params.arguments === 'object') {
      current = current.params.arguments;
      continue;
    }
    if (current.params?.input && typeof current.params.input === 'object') {
      current = current.params.input;
      continue;
    }
    break;
  }
  return current && typeof current === 'object' ? current : {};
}

function stripFences(text) {
  return String(text || '')
    .trim()
    .replace(/^\s*```[\s\S]*?\n/, '')
    .replace(/\n```[\s\S]*$/m, '')
    .trim();
}

function getDefaultAgent() {
  return (typeof getDefaultLLMAgent === 'function' && getDefaultLLMAgent())
    || (typeof registerDefaultLLMAgent === 'function' && registerDefaultLLMAgent());
}

function buildFocusSnippet(content, cursorOffset) {
  const lines = content.split(/\r?\n/);
  const prefix = content.slice(0, cursorOffset);
  const lineIndex = Math.max(0, prefix.split(/\r?\n/).length - 1);
  const start = Math.max(0, lineIndex - 1);
  const end = Math.min(lines.length - 1, lineIndex + 1);
  const snippet = [];
  for (let i = start; i <= end; i += 1) {
    const marker = i === lineIndex ? '>>' : '  ';
    snippet.push(`${marker} ${i + 1} | ${lines[i]}`);
  }
  let text = snippet.join('\n');
  if (text.length > MAX_FOCUS_CHARS) {
    text = text.slice(0, MAX_FOCUS_CHARS);
  }
  return text;
}

function buildPrompt({ path, language, prefix, suffix, focus }) {
  return [
    'You are an expert code autocomplete engine.',
    'Return ONLY the text that should be inserted at the cursor.',
    'Do not include markdown fences, explanations, or surrounding quotes.',
    'Avoid repeating text that already exists after the cursor.',
    'Keep the completion concise and consistent with the file style.',
    '',
    `File: ${path || ''}`,
    `Language: ${language || ''}`,
    '',
    'Focus (current line +/- 1):',
    focus || '(no focus)',
    '',
    'Context:',
    '[PREFIX]',
    prefix,
    '<<<CURSOR>>>',
    suffix,
    '[SUFFIX]'
  ].join('\n');
}

function normalizeArgs(toolName, args) {
  const input = args && typeof args === 'object' ? { ...args } : {};
  switch (toolName) {
    case 'llm_autocomplete':
      if (!input.path || typeof input.path !== 'string') {
        throw new Error('llm_autocomplete requires a "path" string.');
      }
      if (typeof input.content !== 'string') {
        throw new Error('llm_autocomplete requires a "content" string.');
      }
      if (!Number.isFinite(input.cursorOffset)) {
        throw new Error('llm_autocomplete requires a "cursorOffset" number.');
      }
      input.language = typeof input.language === 'string' ? input.language : '';
      return input;
    case 'git_commit_message':
      if (!Array.isArray(input.diffs)) {
        throw new Error('git_commit_message requires diffs array.');
      }
      return input;
    case 'llm_resolve_conflict':
      input.base = typeof input.base === 'string' ? input.base : '';
      input.ours = typeof input.ours === 'string' ? input.ours : '';
      input.theirs = typeof input.theirs === 'string' ? input.theirs : '';
      input.source = typeof input.source === 'string' ? input.source : '';
      return input;
    default:
      throw new Error(`Unsupported tool: ${toolName}`);
  }
}

async function llmAutocomplete({ path, content, cursorOffset, language }) {
  const safeContent = typeof content === 'string' ? content : '';
  const maxOffset = safeContent.length;
  let offset = Number.isFinite(cursorOffset) ? cursorOffset : maxOffset;
  offset = Math.max(0, Math.min(maxOffset, offset));

  const prefix = safeContent.slice(0, offset);
  const suffix = safeContent.slice(offset);
  const trimmedPrefix = prefix.slice(-MAX_PREFIX_CHARS);
  const trimmedSuffix = suffix.slice(0, MAX_SUFFIX_CHARS);
  const focus = buildFocusSnippet(safeContent, offset);

  const agent = getDefaultAgent();
  if (!agent) {
    throw new Error('No default LLM agent available.');
  }

  const prompt = buildPrompt({
    path,
    language,
    prefix: trimmedPrefix,
    suffix: trimmedSuffix,
    focus
  });

  const raw = await agent.executePrompt(prompt, { mode: 'fast', responseShape: 'text' });
  const completion = stripFences(raw);
  if (!completion) {
    throw new Error('LLM returned an empty completion.');
  }
  return completion;
}

async function main() {
  let raw = process.argv[2];
  if (!raw) {
    raw = await readStdinFallback();
  }
  const envelope = raw && raw.trim() ? safeParseJson(raw) : null;
  const args = normalizeInput(envelope || {});
  const toolName = process.env.TOOL_NAME
    || process.argv[2]
    || envelope?.tool
    || envelope?.params?.name
    || envelope?.params?.tool_name
    || envelope?.name
    || envelope?.tool_name
    || args?.tool_name
    || args?.name;

  if (!toolName) {
    writeJson({ ok: false, error: 'Missing TOOL_NAME.' });
    return;
  }

  try {
    if (toolName === 'llm_autocomplete') {
      const payload = normalizeArgs(toolName, args);
      const completion = await llmAutocomplete(payload);
      writeJson({ ok: true, content: completion });
      return;
    }
    if (toolName === 'git_commit_message') {
      const payload = normalizeArgs(toolName, args);
      const message = await gitCommitMessage(payload);
      writeJson({ ok: true, message: typeof message === 'string' ? message : String(message ?? '') });
      return;
    }
    if (toolName === 'llm_resolve_conflict') {
      const payload = normalizeArgs(toolName, args);
      const resolved = await resolveConflict(payload);
      writeJson({ ok: true, content: typeof resolved === 'string' ? resolved : String(resolved ?? '') });
      return;
    }
    throw new Error(`Unsupported tool: ${toolName}`);
  } catch (error) {
    const message = error?.message || String(error);
    writeJson({ ok: false, error: message });
  }
}

main();
