#!/usr/bin/env node
import { getDefaultLLMAgent, registerDefaultLLMAgent } from 'achillesAgentLib/LLMAgents';

const MAX_CONTEXT_LINE_CHARS = 180;
const AUTOCOMPLETE_TIMEOUT_MS = 12000;
const TOKEN_RE = /[A-Za-z_$][\w$-]*$/;

function safeParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function writeJson(value) {
  process.stdout.write(JSON.stringify(value));
}

function writeJsonAndExit(value) {
  process.stdout.write(JSON.stringify(value), () => {
    process.exit(0);
  });
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

function getTokenBeforeCursor(content, cursorOffset) {
  const beforeCursor = content.slice(0, cursorOffset);
  const lineStart = beforeCursor.lastIndexOf('\n') + 1;
  const linePrefix = beforeCursor.slice(lineStart);
  return linePrefix.match(TOKEN_RE)?.[0] || '';
}

function detectEmbeddedLanguage({ path, content, cursorOffset, language }) {
  const explicit = String(language || '').toLowerCase();
  const filePath = String(path || '').toLowerCase();
  if (!(explicit.includes('html') || /\.html?$/.test(filePath))) {
    return explicit || language || '';
  }

  const prefix = content.slice(0, cursorOffset).toLowerCase();
  const lastStyleOpen = prefix.lastIndexOf('<style');
  const lastStyleClose = prefix.lastIndexOf('</style>');
  if (lastStyleOpen !== -1 && lastStyleOpen > lastStyleClose) {
    return 'css';
  }
  const lastScriptOpen = prefix.lastIndexOf('<script');
  const lastScriptClose = prefix.lastIndexOf('</script>');
  if (lastScriptOpen !== -1 && lastScriptOpen > lastScriptClose) {
    return 'javascript';
  }
  return explicit || 'html';
}

function normalizeCompletion(text) {
  return stripFences(text)
    .replace(/\[END_OF_TEXT\]|\[END\]|<\|endoftext\|>/gi, '')
    .trim();
}

function getDefaultAgent() {
  return (typeof getDefaultLLMAgent === 'function' && getDefaultLLMAgent())
    || (typeof registerDefaultLLMAgent === 'function' && registerDefaultLLMAgent());
}

function buildCurrentLine(content, cursorOffset) {
  const lineStart = content.lastIndexOf('\n', Math.max(0, cursorOffset - 1)) + 1;
  const nextBreak = content.indexOf('\n', cursorOffset);
  const lineEnd = nextBreak === -1 ? content.length : nextBreak;
  const before = content.slice(lineStart, cursorOffset);
  const after = content.slice(cursorOffset, lineEnd);
  return `${before}<CURSOR>${after}`;
}

function buildCurrentLineParts(content, cursorOffset) {
  const lineStart = content.lastIndexOf('\n', Math.max(0, cursorOffset - 1)) + 1;
  const nextBreak = content.indexOf('\n', cursorOffset);
  const lineEnd = nextBreak === -1 ? content.length : nextBreak;
  return {
    before: content.slice(lineStart, cursorOffset),
    after: content.slice(cursorOffset, lineEnd)
  };
}

function clampContextLine(line) {
  const text = String(line || '');
  if (text.length <= MAX_CONTEXT_LINE_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_CONTEXT_LINE_CHARS)}...`;
}

function buildLineContext(content, cursorOffset) {
  const beforeCursor = content.slice(0, cursorOffset);
  const cursorLineIndex = Math.max(0, beforeCursor.split(/\r?\n/).length - 1);
  const lines = content.split(/\r?\n/);
  const beforeStart = Math.max(0, cursorLineIndex - 5);
  const before = lines
    .slice(beforeStart, cursorLineIndex)
    .map(clampContextLine)
    .join('\n');
  const after = lines
    .slice(cursorLineIndex + 1, cursorLineIndex + 3)
    .map(clampContextLine)
    .join('\n');
  return {
    before,
    current: clampContextLine(buildCurrentLine(content, cursorOffset)),
    currentParts: buildCurrentLineParts(content, cursorOffset),
    after
  };
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timeoutId);
  });
}

function buildPrompt({ path, language, tokenPrefix, before, current, currentParts, after }) {
  const prefixTail = `${before ? `${before}\n` : ''}${currentParts?.before || ''}`.slice(-900);
  return [
    'You are an inline autocomplete engine for an editor.',
    'Return the next characters that should appear immediately after DOCUMENT_PREFIX_ENDS_WITH.',
    'The editor appends your response at the cursor. It does not replace existing text.',
    'Return only those next characters. No markdown. No quotes. No explanation.',
    '',
    'Critical rule:',
    'Your first character must be the character that comes immediately after the cursor.',
    'Do not repeat any character that already appears in DOCUMENT_PREFIX_ENDS_WITH.',
    'Do not answer with metadata such as file type, language, or section names.',
    'Do not return the completed line, completed sentence, completed tag, or completed token.',
    'If the prefix ends inside a word, tag, selector, identifier, or sentence, return only the missing suffix.',
    'If the best completion is uncertain, return an empty response.',
    '',
    'Generic examples:',
    'DOCUMENT_PREFIX_ENDS_WITH: "Hello wor" -> response: "ld"',
    'DOCUMENT_PREFIX_ENDS_WITH: "</ti" -> response: "tle>"',
    'DOCUMENT_PREFIX_ENDS_WITH: "</tit" -> response: "le>"',
    'DOCUMENT_PREFIX_ENDS_WITH: "linear-gra" -> response: "dient"',
    'DOCUMENT_PREFIX_ENDS_WITH: "items.ma" -> response: "p"',
    '',
    'Wrong examples:',
    'DOCUMENT_PREFIX_ENDS_WITH: "</ti" -> wrong response: "ti" because it repeats already typed text',
    'DOCUMENT_PREFIX_ENDS_WITH: "</ti" -> wrong response: "</title>" because it repeats already typed text',
    'DOCUMENT_PREFIX_ENDS_WITH: "<title>AxiFace Demo</ti" -> wrong response: "<title>AxiFace Demo</title>" because it repeats the line',
    '',
    `File path for context only: ${path || ''}`,
    `Current token prefix already typed: ${tokenPrefix || '(none)'}`,
    '',
    'DOCUMENT_PREFIX_ENDS_WITH:',
    prefixTail || '(empty)',
    '',
    'TEXT_AFTER_CURSOR_ON_SAME_LINE:',
    currentParts?.after || '(empty)',
    '',
    'Next characters after DOCUMENT_PREFIX_ENDS_WITH:'
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
  const effectiveLanguage = detectEmbeddedLanguage({ path, content, cursorOffset: offset, language });
  const tokenPrefix = getTokenBeforeCursor(content, offset);
  const lineContext = buildLineContext(content, offset);
  const prompt = buildPrompt({
    path,
    language: effectiveLanguage,
    tokenPrefix,
    ...lineContext
  });

  const agent = getDefaultAgent();
  if (!agent) {
    throw new Error('No default LLM agent available.');
  }

  const raw = await withTimeout(
    agent.complete({
      prompt,
      model: 'fast',
      context: { intent: 'code-autocomplete' }
    }),
    AUTOCOMPLETE_TIMEOUT_MS,
    `LLM autocomplete timed out after ${Math.round(AUTOCOMPLETE_TIMEOUT_MS / 1000)}s.`
  );
  if (process.env.LLM_AUTOCOMPLETE_DEBUG === '1') {
    console.error('[llm_autocomplete] raw response:', JSON.stringify(String(raw || '').slice(0, 500)));
  }
  const completion = normalizeCompletion(raw);
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
    writeJsonAndExit({ ok: true, content });
  } catch (error) {
    writeJsonAndExit({ ok: false, error: error?.message || String(error) });
  }
}

await main();
