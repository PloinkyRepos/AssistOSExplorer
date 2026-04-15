import crypto from 'node:crypto';

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeMultilineText(value) {
  const normalized = String(value || '').replace(/\r\n/g, '\n');
  return normalized.replace(/^\n+|\n+$/g, '').trim();
}

function normalizeTaskId(value) {
  return normalizeString(value).toUpperCase();
}

function splitLines(text) {
  return String(text || '').replace(/\r\n/g, '\n').split('\n');
}

function joinLines(lines) {
  return lines.join('\n').replace(/\s+$/g, '').trimEnd();
}

function ensureTaskId(value, fallbackIndex = 1) {
  const normalized = normalizeTaskId(value);
  if (normalized) {
    return normalized;
  }
  return `TASK-${String(fallbackIndex).padStart(3, '0')}`;
}

function normalizeTask(task, fallbackIndex = 1) {
  const rawOptions = Array.isArray(task?.options) ? task.options : [];
  const options = rawOptions
    .map((option) => normalizeMultilineText(option))
    .filter(Boolean);
  return {
    id: ensureTaskId(task?.id, fallbackIndex),
    description: normalizeMultilineText(task?.description),
    options,
    resolution: normalizeMultilineText(task?.resolution)
  };
}

function renderSection(title, bodyLines = []) {
  const lines = [`#### ${title}`];
  if (bodyLines.length) {
    lines.push(...bodyLines);
  }
  return lines;
}

function serializeOptions(options) {
  const normalized = Array.isArray(options)
    ? options.map((option) => normalizeMultilineText(option)).filter(Boolean)
    : [];
  if (!normalized.length) {
    return [];
  }
  const lines = [];
  normalized.forEach((option, index) => {
    if (lines.length) {
      lines.push('');
    }
    lines.push(`##### Option ${index + 1}`);
    lines.push(...splitLines(option));
  });
  return lines;
}

function extractTaskBlocks(markdown) {
  const text = String(markdown || '').replace(/\r\n/g, '\n');
  const tasksIndex = text.indexOf('\n## Tasks');
  const body = tasksIndex >= 0 ? text.slice(tasksIndex + 1) : text;
  const pattern = /^### Task ([^\n]+)\n/gm;
  const matches = [];
  let match;
  while ((match = pattern.exec(body)) !== null) {
    matches.push({
      id: normalizeTaskId(match[1]),
      start: match.index,
      contentStart: pattern.lastIndex
    });
  }
  const blocks = [];
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const next = matches[index + 1];
    const content = body.slice(current.contentStart, next ? next.start : body.length);
    blocks.push({
      id: current.id,
      content
    });
  }
  return blocks;
}

function extractSection(blockContent, title) {
  const text = String(blockContent || '');
  const pattern = new RegExp(`(?:^|\\n)#### ${title}\\n`, 'g');
  const match = pattern.exec(text);
  if (!match) {
    return '';
  }
  const sectionStart = match.index + match[0].length;
  const nextPattern = /(?:^|\n)#### [^\n]+\n/g;
  nextPattern.lastIndex = sectionStart;
  const next = nextPattern.exec(text);
  const raw = text.slice(sectionStart, next ? next.index : text.length);
  return raw.replace(/^\n+|\n+$/g, '');
}

function parseOptionsSection(sectionText) {
  const text = String(sectionText || '').replace(/\r\n/g, '\n');
  const pattern = /^##### Option \d+\n/gm;
  const matches = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    matches.push({
      start: match.index,
      contentStart: pattern.lastIndex
    });
  }
  const options = [];
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const next = matches[index + 1];
    const raw = text.slice(current.contentStart, next ? next.start : text.length);
    const normalized = normalizeMultilineText(raw);
    if (normalized) {
      options.push(normalized);
    }
  }
  return options;
}

function parseTaskBlock(block, fallbackIndex) {
  const description = normalizeMultilineText(extractSection(block.content, 'Description'));
  const resolution = normalizeMultilineText(extractSection(block.content, 'Resolution'));
  const options = parseOptionsSection(extractSection(block.content, 'Options'));
  return normalizeTask({
    id: block.id,
    description,
    options,
    resolution
  }, fallbackIndex);
}

function serializeTaskDocument(title, tasks) {
  const normalizedTasks = Array.isArray(tasks)
    ? tasks.map((task, index) => normalizeTask(task, index + 1))
    : [];
  const lines = [`# ${title}`, '', '## Tasks'];
  normalizedTasks.forEach((task) => {
    lines.push('');
    lines.push(`### Task ${task.id}`);
    lines.push('');
    lines.push(...renderSection('Description', splitLines(task.description)));
    lines.push('');
    lines.push(...renderSection('Options', serializeOptions(task.options)));
    lines.push('');
    lines.push(...renderSection('Resolution', splitLines(task.resolution)));
  });
  lines.push('');
  return `${joinLines(lines)}\n`;
}

function parseTaskDocument(markdown) {
  const blocks = extractTaskBlocks(markdown);
  return blocks.map((block, index) => parseTaskBlock(block, index + 1));
}

function taskHash(task) {
  const normalized = normalizeTask(task);
  const payload = {
    id: normalized.id,
    description: normalized.description,
    options: normalized.options,
    resolution: normalized.resolution
  };
  return crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex');
}

export function createEmptyBacklogMarkdown() {
  return serializeBacklogMarkdown([]);
}

export function createEmptyHistoryMarkdown() {
  return serializeHistoryMarkdown([]);
}

export function parseBacklogMarkdown(markdown) {
  return parseTaskDocument(markdown);
}

export function serializeBacklogMarkdown(tasks) {
  return serializeTaskDocument('Backlog', tasks);
}

export function parseHistoryMarkdown(markdown) {
  return parseTaskDocument(markdown);
}

export function serializeHistoryMarkdown(tasks) {
  return serializeTaskDocument('History', tasks);
}

export function decorateBacklogTask(task, sourcePath, index) {
  const normalized = normalizeTask(task, index + 1);
  const position = Number.isFinite(index) ? index : 0;
  const status = normalized.resolution ? 'approved' : 'new';
  return {
    ...normalized,
    order: position + 1,
    status,
    sourcePath,
    taskHash: taskHash(normalized)
  };
}

export function decorateHistoryTask(task, sourcePath, index) {
  const normalized = normalizeTask(task, index + 1);
  const position = Number.isFinite(index) ? index : 0;
  return {
    ...normalized,
    order: position + 1,
    status: 'done',
    sourcePath,
    taskHash: taskHash(normalized)
  };
}

export function createNextTaskId(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  let maxValue = 0;
  for (const task of list) {
    const match = /^TASK-(\d+)$/i.exec(normalizeTaskId(task?.id));
    if (!match) {
      continue;
    }
    const numeric = Number.parseInt(match[1], 10);
    if (Number.isFinite(numeric) && numeric > maxValue) {
      maxValue = numeric;
    }
  }
  return `TASK-${String(maxValue + 1).padStart(3, '0')}`;
}
