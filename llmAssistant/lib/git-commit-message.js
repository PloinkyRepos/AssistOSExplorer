import { getDefaultLLMAgent, registerDefaultLLMAgent } from 'achillesAgentLib/LLMAgents';

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

function getPathParts(filePath) {
  return normalizePath(filePath).split('/').filter(Boolean);
}

function getComponentName(filePath) {
  const parts = getPathParts(filePath);
  const componentIndex = parts.lastIndexOf('components');
  if (componentIndex >= 0 && parts[componentIndex + 1]) {
    return parts[componentIndex + 1];
  }
  const agentIndex = parts.findIndex((part) => /Agent$/i.test(part));
  if (agentIndex >= 0 && parts[agentIndex]) {
    return parts[agentIndex];
  }
  return parts.length > 1 ? parts.at(-2) : (parts[0] || 'code');
}

function actionFromPath(filePath) {
  const path = normalizePath(filePath).toLowerCase();
  if (path.includes('/test') || path.endsWith('.test.js') || path.endsWith('.test.mjs')) return 'tests';
  if (path.endsWith('.html')) return 'markup';
  if (path.endsWith('.css')) return 'styles';
  if (path.endsWith('.md')) return 'docs';
  return 'logic';
}

function diffLines(diffText) {
  return String(diffText || '').split(/\r?\n/);
}

function collectChangedLines(diffText, prefix) {
  return diffLines(diffText)
    .filter((line) => line.startsWith(prefix) && !line.startsWith(`${prefix}${prefix}${prefix}`))
    .map((line) => line.slice(1).trim())
    .filter(Boolean);
}

function summarizeChangedTerms(lines, limit = 10) {
  const ignored = new Set([
    'const', 'let', 'var', 'return', 'function', 'export', 'import', 'from', 'this',
    'true', 'false', 'null', 'undefined', 'if', 'else', 'for', 'while', 'async',
    'await', 'string', 'number', 'boolean', 'object'
  ]);
  const counts = new Map();
  for (const line of lines) {
    for (const token of line.match(/[A-Za-z][A-Za-z0-9_]{2,}/g) || []) {
      const normalized = token.replace(/^webmeet/i, 'WebMeet');
      const key = normalized.toLowerCase();
      if (ignored.has(key)) continue;
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term]) => term);
}

function summarizeDiffItem(item) {
  const filePath = normalizePath(item?.filePath || '');
  const added = collectChangedLines(item?.diff, '+');
  const removed = collectChangedLines(item?.diff, '-');
  return {
    filePath,
    component: getComponentName(filePath),
    area: actionFromPath(filePath),
    addedLines: added.length,
    removedLines: removed.length,
    addedTerms: summarizeChangedTerms(added),
    removedTerms: summarizeChangedTerms(removed)
  };
}

function buildDiffSummary(diffs) {
  const summaries = diffs.map(summarizeDiffItem);
  const components = [...new Set(summaries.map((item) => item.component).filter(Boolean))];
  const areas = [...new Set(summaries.map((item) => item.area).filter(Boolean))];
  const files = summaries.map((item) => {
    const addedTerms = item.addedTerms.length ? ` added terms: ${item.addedTerms.join(', ')}` : '';
    const removedTerms = item.removedTerms.length ? ` removed terms: ${item.removedTerms.join(', ')}` : '';
    return `- ${item.filePath}: ${item.addedLines} added, ${item.removedLines} removed; area=${item.area}; component=${item.component}.${addedTerms}${removedTerms}`;
  });
  return [
    `Changed files: ${summaries.length}`,
    `Likely components: ${components.join(', ') || 'unknown'}`,
    `Change areas: ${areas.join(', ') || 'unknown'}`,
    'Per-file extracted facts:',
    ...files
  ].join('\n');
}

function buildFallbackMessage(diffs) {
  const summaries = diffs.map(summarizeDiffItem);
  const components = [...new Set(summaries.map((item) => item.component).filter(Boolean))];
  const areas = [...new Set(summaries.map((item) => item.area).filter(Boolean))];
  const component = components[0] || 'project';
  const subjectArea = areas.includes('tests') && areas.length === 1 ? 'tests' : 'behavior';
  const subject = `Update ${component} ${subjectArea}`;
  const bullets = summaries.slice(0, 4).map((item) => (
    `- Update ${item.area} in ${item.filePath}`
  ));
  return [subject, '', ...bullets].join('\n').trim();
}

function looksLikeCode(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const codeLineCount = lines.filter((line) => (
    /[{};]/.test(line)
    || /^(const|let|var|function|class|export|import|if|for|while|return)\b/.test(line)
    || /^<\/?[A-Za-z][^>]*>$/.test(line)
  )).length;
  return codeLineCount >= 2 || /^\s*(function|const|let|var|export|import)\b/.test(value);
}

function buildPrompt(diffs) {
  const header = [
    'You are generating a Git commit message from code diffs.',
    'Your job is to READ the diffs and SUMMARIZE the developer intent.',
    'Do not copy code from the diff. Do not output function bodies, imports, constants, HTML, CSS, or raw diff lines.',
    'Use added lines (+) and removed lines (-) as evidence, then describe the behavior change in plain English.',
    'Return ONLY the commit message text (no markdown fences, no explanations, no labels).',
    'Rules:',
    '- First line: imperative mood, <= 72 chars.',
    '- Optional blank line then bullet list (max 6 bullets).',
    '- Be specific: mention key parts touched.',
    '- If unsure, write a conservative summary of the affected files and behavior.',
    '',
    'Commit message examples:',
    'Improve participant audio volume handling',
    '',
    '- Default participant playback to 100%',
    '- Apply manual volume as a factor over speaker volume',
    '- Cover participant audio behavior with unit tests',
    '',
    'Extracted facts from the diffs:',
    buildDiffSummary(diffs),
    '',
    'Raw diffs for evidence only. Do not copy text from this section:'
  ].join('\n');

  const MAX_CHARS_PER_DIFF = 12_000;
  const MAX_TOTAL_CHARS = 120_000;

  let prompt = header;
  for (const item of diffs) {
    if (prompt.length >= MAX_TOTAL_CHARS) break;
    const diffText = String(item?.diff || '').slice(0, MAX_CHARS_PER_DIFF);
    const segment = `\n\n[repo] ${item?.repoPath || ''}\n[file] ${item?.filePath || ''}\n[diff]\n${diffText}\n[/diff]`;
    if (prompt.length + segment.length > MAX_TOTAL_CHARS) break;
    prompt += segment;
  }
  return prompt;
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

  const prompt = buildPrompt(diffs);
  const raw = await agent.executePrompt(prompt, { model: 'fast', responseShape: 'text' });
  const message = stripFences(raw);
  if (!message || looksLikeCode(message)) {
    const fallback = buildFallbackMessage(diffs);
    if (fallback) return fallback;
    throw new Error('AI returned an empty commit message.');
  }
  return message;
}
