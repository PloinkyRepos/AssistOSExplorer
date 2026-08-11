import { spawn } from 'node:child_process';

const DIRECT_PROMPT_CHAR_LIMIT = 16_000;
const BATCH_CHAR_LIMIT = 12_000;
const MAX_FILES_PER_BATCH = 10;
const MAX_DIFF_CHARS_PER_FILE = 5_000;
const BATCH_TIMEOUT_MS = 25_000;
const FINAL_MESSAGE_TIMEOUT_MS = 25_000;
const TOTAL_TIMEOUT_MS = 90_000;

const CATEGORY_ORDER = ['runtime', 'ui', 'configuration', 'tests', 'documentation', 'source'];

function safeParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function stripFences(text) {
  return String(text || '')
    .trim()
    .replace(/^\s*```[^\n]*\n/, '')
    .replace(/\n```\s*$/m, '')
    .trim();
}

async function getDefaultAgent() {
  const { getDefaultLLMAgent, registerDefaultLLMAgent } = await import('achillesAgentLib/LLMAgents');
  return (typeof getDefaultLLMAgent === 'function' && getDefaultLLMAgent())
    || (typeof registerDefaultLLMAgent === 'function' && registerDefaultLLMAgent());
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

function getRepoName(repoPath) {
  const parts = normalizePath(repoPath).split('/').filter(Boolean);
  return parts.at(-1) || '';
}

function displayPath(item) {
  const filePath = normalizePath(item?.filePath);
  const repoName = getRepoName(item?.repoPath);
  return repoName ? `${repoName}/${filePath}` : filePath;
}

function truncateText(text, maxChars) {
  const value = String(text || '');
  if (value.length <= maxChars) return value;
  const half = Math.max(300, Math.floor((maxChars - 80) / 2));
  return `${value.slice(0, half)}\n[diff truncated]\n${value.slice(-half)}`;
}

function categorizePath(filePath) {
  const value = normalizePath(filePath).toLowerCase();
  const segments = value.split('/').filter(Boolean);
  const fileName = segments.at(-1) || '';

  if (segments.some((part) => part === 'test' || part === 'tests' || part === '__tests__')
    || /(?:^|[._-])(test|spec)\.[^.]+$/.test(fileName)) return 'tests';
  if (segments.includes('docs') || /\.(md|mdx|rst|adoc)$/.test(fileName)) return 'documentation';
  if (segments.includes('ide-plugins') || segments.includes('web-components')
    || value.includes('/shared/ui/') || /\.(css|scss|sass|less|html)$/.test(fileName)) return 'ui';
  if (fileName === 'manifest.json' || fileName === 'package.json' || fileName === 'package-lock.json'
    || /(?:^|[._-])(config|settings)(?:[._-]|$)/.test(fileName)
    || /\.(ya?ml|toml|ini)$/.test(fileName)) return 'configuration';
  if (segments.some((part) => ['runtime', 'services', 'server', 'lib', 'tools'].includes(part))) return 'runtime';
  return 'source';
}

function renderDiffItem(item, maxDiffChars = MAX_DIFF_CHARS_PER_FILE) {
  return [
    `FILE: ${displayPath(item)}`,
    'DIFF:',
    truncateText(item?.diff, maxDiffChars) || '[no textual diff available]',
  ].join('\n');
}

function renderAllDiffs(diffs, maxDiffChars = MAX_DIFF_CHARS_PER_FILE) {
  return diffs.map((item) => renderDiffItem(item, maxDiffChars)).join('\n\n');
}

function buildDirectPrompt(diffs) {
  return [
    'Write one complete Git commit message for the supplied changes.',
    'Return only the commit message: an imperative subject line, then a blank line and concise body bullets when multiple substantive changes exist.',
    'Describe the dominant shared behavior first and include important secondary behavior. Treat tests and documentation as support for the implementation, not as the dominant feature.',
    'Do not invent behavior, include labels, use Markdown headings, or enumerate files mechanically.',
    '',
    'CHANGES_START',
    renderAllDiffs(diffs),
    'CHANGES_END',
  ].join('\n');
}

function buildSemanticBatches(diffs, options = {}) {
  const charLimit = options.charLimit || BATCH_CHAR_LIMIT;
  const fileLimit = options.fileLimit || MAX_FILES_PER_BATCH;
  const groups = new Map(CATEGORY_ORDER.map((category) => [category, []]));
  for (const item of diffs) {
    groups.get(categorizePath(item?.filePath)).push(item);
  }

  const batches = [];
  for (const category of CATEGORY_ORDER) {
    const items = groups.get(category);
    if (!items.length) continue;
    let current = [];
    let currentChars = 0;
    for (const item of items) {
      const renderedLength = renderDiffItem(item).length + 2;
      if (current.length && (current.length >= fileLimit || currentChars + renderedLength > charLimit)) {
        batches.push({ category, items: current });
        current = [];
        currentChars = 0;
      }
      current.push(item);
      currentChars += renderedLength;
    }
    if (current.length) batches.push({ category, items: current });
  }

  const categoryParts = new Map();
  return batches.map((batch) => {
    const part = (categoryParts.get(batch.category) || 0) + 1;
    categoryParts.set(batch.category, part);
    const totalParts = batches.filter((candidate) => candidate.category === batch.category).length;
    return {
      ...batch,
      label: totalParts > 1 ? `${batch.category} ${part}/${totalParts}` : batch.category,
    };
  });
}

function buildBatchPrompt(batch) {
  return [
    `Summarize this ${batch.label} change batch for a Git commit message.`,
    'Return only 2-6 concise lines, one substantive behavior per line, without headings or labels.',
    'Connect related files into shared behavior. Mention tests or documentation only as supporting coverage. Do not invent behavior and do not merely repeat file names.',
    '',
    'BATCH_CHANGES_START',
    renderAllDiffs(batch.items),
    'BATCH_CHANGES_END',
  ].join('\n');
}

function summaryLines(text) {
  const seen = new Set();
  const lines = [];
  for (const rawLine of stripFences(text).split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^[-*]\s+/, '').replace(/^\d+[.)]\s+/, '').trim();
    if (!line || /^(summary|changes|commit message):?$/i.test(line)) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  return lines.slice(0, 6);
}

function renderFileInventory(diffs) {
  const grouped = new Map();
  for (const item of diffs) {
    const category = categorizePath(item?.filePath);
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category).push(displayPath(item));
  }
  return CATEGORY_ORDER
    .filter((category) => grouped.has(category))
    .map((category) => `${category}: ${grouped.get(category).join(', ')}`)
    .join('\n');
}

function buildFinalPrompt(summaries, diffs) {
  return [
    'Write one complete Git commit message by synthesizing the available batch summaries and complete file inventory.',
    'Return only the commit message. Use an imperative subject of at most 72 characters, followed by a blank line and 2-7 concise bullets when the change needs a body.',
    'The subject must describe the dominant shared capability. The body must cover important secondary behavior across implementation, UI, configuration, tests, and documentation when present.',
    'Do not let tests or documentation overshadow the implementation. Do not invent behavior, add labels, use Markdown headings, or mechanically list files.',
    '',
    'BATCH_SUMMARIES_START',
    ...summaries.map((item) => `[${item.label}]\n${item.lines.map((line) => `- ${line}`).join('\n')}`),
    'BATCH_SUMMARIES_END',
    '',
    'COMPLETE_FILE_INVENTORY_START',
    renderFileInventory(diffs),
    'COMPLETE_FILE_INVENTORY_END',
  ].join('\n');
}

function buildFileFallbackMessage(diffs) {
  const files = diffs.map((item) => displayPath(item)).filter(Boolean);
  if (files.length === 1) return `Update ${files[0]}`;
  const shown = files.slice(0, 10);
  const remainder = files.length - shown.length;
  return [
    'Update project files',
    '',
    ...shown.map((file) => `- ${file}`),
    ...(remainder > 0 ? [`- Include ${remainder} additional changed files`] : []),
  ].join('\n');
}

function normalizeSubject(line) {
  return String(line || '')
    .replace(/^(commit message|subject|summary):\s*/i, '')
    .replace(/\.$/, '')
    .trim();
}

function buildMessageFromBatchSummaries(summaries, diffs) {
  const lines = summaries.flatMap((item) => item.lines).filter(Boolean);
  if (!lines.length) return buildFileFallbackMessage(diffs);
  const subject = normalizeSubject(lines[0]);
  const bullets = [...new Set(lines.map((line) => line.trim()))]
    .filter((line) => normalizeSubject(line).toLowerCase() !== subject.toLowerCase())
    .slice(0, 7);
  if (!bullets.length) return subject;
  return [subject, '', ...bullets.map((line) => `- ${line}`)].join('\n');
}

async function executePromptWithTimeout(agent, prompt, timeoutMs) {
  void agent;
  const childCode = `
    import { getDefaultLLMAgent, registerDefaultLLMAgent } from 'achillesAgentLib/LLMAgents';
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    try {
      const payload = JSON.parse(input || '{}');
      const agent = (typeof getDefaultLLMAgent === 'function' && getDefaultLLMAgent())
        || (typeof registerDefaultLLMAgent === 'function' && registerDefaultLLMAgent());
      if (!agent) throw new Error('No default LLM agent available.');
      const text = await agent.executePrompt(String(payload.prompt || ''), { model: 'fast', responseShape: 'text' });
      process.stdout.write(JSON.stringify({ ok: true, text: String(text ?? '') }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ ok: false, error: error?.message || String(error) }));
      process.exitCode = 1;
    }
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', childCode], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('llm_timeout'));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', () => {
      clearTimeout(timer);
      const parsed = safeParseJson(stdout.trim());
      if (parsed?.ok) {
        resolve(parsed.text || '');
        return;
      }
      reject(new Error(parsed?.error || stderr.trim() || 'llm_request_failed'));
    });
    child.stdin.end(JSON.stringify({ prompt }));
  });
}

async function summarizeBatch(agent, batch, execute, deadline) {
  if (Date.now() >= deadline) return null;
  try {
    const timeoutMs = Math.max(1_000, Math.min(BATCH_TIMEOUT_MS, deadline - Date.now()));
    const raw = await execute(agent, buildBatchPrompt(batch), timeoutMs);
    const lines = summaryLines(raw);
    return lines.length ? { label: batch.label, lines } : null;
  } catch {
    return null;
  }
}

export default async function gitCommitMessage(input, context = {}) {
  let payload = input;
  if (typeof payload === 'string') {
    const parsed = safeParseJson(payload.trim());
    if (parsed) payload = parsed;
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid input. Expected { diffs: [...] }.');
  }

  const diffs = Array.isArray(payload.diffs) ? payload.diffs : [];
  if (!diffs.length) throw new Error('No diffs provided.');

  const agent = context.llmAgent || await getDefaultAgent();
  if (!agent) throw new Error('No default LLM agent available.');
  const execute = typeof context.executePromptWithTimeout === 'function'
    ? context.executePromptWithTimeout
    : executePromptWithTimeout;
  const directPromptCharLimit = context.directPromptCharLimit ?? DIRECT_PROMPT_CHAR_LIMIT;
  const batchCharLimit = context.batchCharLimit ?? BATCH_CHAR_LIMIT;
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;

  const directPrompt = buildDirectPrompt(diffs);
  if (directPrompt.length <= directPromptCharLimit) {
    try {
      const direct = stripFences(await execute(agent, directPrompt, BATCH_TIMEOUT_MS));
      if (direct) return direct;
    } catch {
      // Continue with batch synthesis so a partial provider failure does not discard the operation.
    }
  }

  const batches = buildSemanticBatches(diffs, { charLimit: batchCharLimit });
  const summaries = [];
  for (const batch of batches) {
    const summary = await summarizeBatch(agent, batch, execute, deadline);
    if (summary) summaries.push(summary);
  }
  if (!summaries.length) return buildFileFallbackMessage(diffs);

  try {
    const timeoutMs = Math.max(1_000, Math.min(FINAL_MESSAGE_TIMEOUT_MS, deadline - Date.now()));
    const finalMessage = stripFences(await execute(agent, buildFinalPrompt(summaries, diffs), timeoutMs));
    if (finalMessage) return finalMessage;
  } catch {
    // The valid batch summaries are sufficient for a deterministic commit message.
  }
  return buildMessageFromBatchSummaries(summaries, diffs);
}
