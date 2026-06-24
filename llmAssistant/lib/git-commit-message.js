import { getDefaultLLMAgent, registerDefaultLLMAgent } from 'achillesAgentLib/LLMAgents';
import { spawn } from 'node:child_process';

const MAX_FILES = 20;
const MAX_DIFF_CHARS_PER_FILE = 600;
const MAX_DIFF_CHARS_PER_FILE_SMALL_BATCH = 4_000;
const FILE_SUMMARY_TIMEOUT_MS = 12_000;
const FILE_SUMMARY_TIMEOUT_MS_SMALL_BATCH = 25_000;
const FILE_SUMMARY_CONCURRENCY = 2;
const FILE_SUMMARY_CONCURRENCY_SMALL_BATCH = 1;
const FINAL_MESSAGE_TIMEOUT_MS = 12_000;
const FINAL_MESSAGE_TIMEOUT_MS_SMALL_BATCH = 25_000;
const FILE_SUMMARY_TOTAL_TIMEOUT_MS = 60_000;

function safeParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
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

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

function getRepoName(repoPath) {
  const parts = normalizePath(repoPath).split('/').filter(Boolean);
  return parts.at(-1) || 'repository';
}

function truncateText(text, maxChars) {
  const value = String(text || '');
  if (value.length <= maxChars) return value;
  const half = Math.max(300, Math.floor((maxChars - 80) / 2));
  return `${value.slice(0, half)}\n[diff truncated]\n${value.slice(-half)}`;
}

function buildFileSummaryPrompt(item, maxDiffChars = MAX_DIFF_CHARS_PER_FILE) {
  const filePath = normalizePath(item?.filePath);
  return [
    `File: ${filePath}`,
    'Diff:',
    truncateText(item?.diff, maxDiffChars),
    '',
    'Write one short commit-message sentence for this file.',
    'Return only that sentence. No labels. No raw diff lines.'
  ].join('\n');
}

function buildFinalPrompt(summaries) {
  return [
    'Write one Git commit message by synthesizing these per-file change summaries.',
    '',
    'Per-file summaries:',
    ...summaries.map((item) => `- ${item.filePath}: ${item.summary}`),
    '',
    'Return only the commit message text that should be saved.',
    'Do not write labels such as "Commit Message:", "Message:", or "Summary:".',
    'Do not include explanations, markdown headings, or numbered sections.',
    'First line: one imperative sentence about the shared capability or behavior changed.',
    'The first line must start with the real action, not with a generic file phrase.',
    'Bad first lines:',
    '- Update files',
    '- Update selected files',
    '- Update project files',
    '- Update files Add validation and error handling',
    'Good first lines:',
    '- Improve GitHub repository creation and cloning',
    '- Add GitHub repository picker validation',
    'After the first line, always add a blank line and concise bullet list.',
    'Use the per-file summaries as the bullet content.',
    'Cover the combined change across the summaries, not just the first file.',
    'Do not repeat the same idea.'
  ].join('\n');
}

function buildTimeoutMessage(diffs) {
  const files = diffs
    .map((item) => normalizePath(item?.filePath))
    .filter(Boolean);
  if (files.length === 1) {
    return `Update ${files[0]}`;
  }
  return [
    'Update project files',
    '',
    ...files.slice(0, 10).map((file) => `- ${file}`)
  ].join('\n');
}

function buildMessageFromSummaries(summaries) {
  const cleanSummaries = summaries
    .map((item) => String(item?.summary || '').trim())
    .filter(Boolean);
  if (!cleanSummaries.length) {
    return 'Update selected files';
  }
  const firstSpecificSummary = cleanSummaries.find((summary) => !/^Updated\s+\S+/i.test(summary)) || cleanSummaries[0];
  const subject = firstSpecificSummary
    .replace(/\.$/, '')
    .replace(/^(Add|Fix|Update|Improve|Refactor|Implement)\b/i, (match) => match[0].toUpperCase() + match.slice(1).toLowerCase());
  return [
    subject,
    '',
    ...cleanSummaries.slice(0, 5).map((summary) => `- ${summary}`)
  ].join('\n');
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

async function summarizeFile(agent, item, deadline, options = {}) {
  const filePath = normalizePath(item?.filePath);
  if (Date.now() >= deadline) {
    return { filePath, summary: `Updated ${filePath}` };
  }
  try {
    const baseTimeoutMs = options.timeoutMs || FILE_SUMMARY_TIMEOUT_MS;
    const maxDiffChars = options.maxDiffChars || MAX_DIFF_CHARS_PER_FILE;
    const timeoutMs = Math.max(1_000, Math.min(baseTimeoutMs, deadline - Date.now()));
    const raw = await executePromptWithTimeout(agent, buildFileSummaryPrompt(item, maxDiffChars), timeoutMs);
    const summary = stripFences(raw).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] || '';
    return { filePath, summary: summary || `Updated ${filePath}` };
  } catch {
    return { filePath, summary: `Updated ${filePath}` };
  }
}

async function mapWithConcurrency(items, limit, mapper) {
  const out = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(Number(limit) || 1, items.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      out[index] = await mapper(items[index], index);
    }
  }));
  return out;
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
  if (!diffs.length) {
    throw new Error('No diffs provided.');
  }

  const agent = getDefaultAgent();
  if (!agent) {
    throw new Error('No default LLM agent available.');
  }

  const selectedDiffs = diffs.slice(0, MAX_FILES);
  const fileSummaryDeadline = Date.now() + FILE_SUMMARY_TOTAL_TIMEOUT_MS;
  const smallBatch = selectedDiffs.length <= 5;
  const summaryOptions = {
    timeoutMs: smallBatch ? FILE_SUMMARY_TIMEOUT_MS_SMALL_BATCH : FILE_SUMMARY_TIMEOUT_MS,
    maxDiffChars: smallBatch ? MAX_DIFF_CHARS_PER_FILE_SMALL_BATCH : MAX_DIFF_CHARS_PER_FILE
  };
  const summaries = await mapWithConcurrency(
    selectedDiffs,
    smallBatch ? FILE_SUMMARY_CONCURRENCY_SMALL_BATCH : FILE_SUMMARY_CONCURRENCY,
    (item) => summarizeFile(agent, item, fileSummaryDeadline, summaryOptions)
  );
  if (summaries.length === 1) {
    return summaries[0]?.summary || buildTimeoutMessage(selectedDiffs);
  }

  let raw = '';
  try {
    const finalTimeoutMs = smallBatch ? FINAL_MESSAGE_TIMEOUT_MS_SMALL_BATCH : FINAL_MESSAGE_TIMEOUT_MS;
    raw = await executePromptWithTimeout(agent, buildFinalPrompt(summaries), finalTimeoutMs);
  } catch (error) {
    if (error?.message === 'llm_timeout') {
      return buildMessageFromSummaries(summaries);
    }
    throw error;
  }
  const message = stripFences(raw);
  if (!message) {
    throw new Error('AI returned an empty commit message.');
  }
  return message;
}
