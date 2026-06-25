#!/usr/bin/env node
import { getDefaultLLMAgent, registerDefaultLLMAgent } from 'achillesAgentLib/LLMAgents';

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
    if (current.arguments && typeof current.arguments === 'object') {
      current = current.arguments;
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

function normalizeArgs(input) {
  const args = normalizeInput(input);
  if (typeof args.path !== 'string') {
    throw new Error('llm_autocomplete requires a "path" string.');
  }
  if (typeof args.content !== 'string') {
    throw new Error('llm_autocomplete requires a "content" string.');
  }
  if (typeof args.cursorOffset !== 'number') {
    throw new Error('llm_autocomplete requires a "cursorOffset" number.');
  }
  return {
    path: args.path,
    content: args.content,
    cursorOffset: args.cursorOffset,
    language: typeof args.language === 'string' ? args.language : ''
  };
}

async function generateLlmAutocomplete({ path, content, cursorOffset, language }) {
  const maxOffset = content.length;
  const offset = Math.max(0, Math.min(maxOffset, Number.isFinite(cursorOffset) ? cursorOffset : maxOffset));
  const prefix = content.slice(0, offset);
  const suffix = content.slice(offset);
  const prompt = buildPrompt({
    path,
    language,
    prefix: prefix.slice(-MAX_PREFIX_CHARS),
    suffix: suffix.slice(0, MAX_SUFFIX_CHARS),
    focus: buildFocusSnippet(content, offset)
  });

  const agent = getDefaultAgent();
  if (!agent) {
    throw new Error('No default LLM agent available.');
  }

  const raw = await agent.executePrompt(prompt, { model: 'fast', responseShape: 'text' });
  const completion = stripFences(raw);
  if (!completion) {
    throw new Error('LLM returned an empty completion.');
  }
  return completion;
}

async function main() {
  try {
    const raw = await readStdinFallback();
    const payload = normalizeArgs(safeParseJson(raw) || {});
    const content = await generateLlmAutocomplete(payload);
    writeJson({ ok: true, content });
  } catch (error) {
    writeJson({ ok: false, error: error?.message || String(error) });
    process.exitCode = 1;
  }
}

await main();
