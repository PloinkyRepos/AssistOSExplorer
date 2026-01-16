import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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

async function pathExists(candidate) {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function resolveWorkspaceRoot(context = {}) {
  const envCandidates = [
    context.workspaceRoot,
    process.env.WORKSPACE_ROOT,
    process.env.ASSISTOS_FS_ROOT,
    process.env.PLOINKY_WORKSPACE_ROOT
  ].filter((value) => typeof value === 'string' && value.trim());

  const baseCandidates = [
    ...envCandidates,
    '/workspace',
    '/code',
    '/Agent',
    '/',
    process.cwd()
  ];

  const moduleSuffix = path.join('node_modules', 'achillesAgentLib', 'LLMAgents', 'index.mjs');

  for (const base of baseCandidates) {
    const modulePath = path.join(base, moduleSuffix);
    if (await pathExists(modulePath)) {
      return base;
    }
  }

  let current = process.cwd();
  while (current && current !== path.dirname(current)) {
    const modulePath = path.join(current, moduleSuffix);
    if (await pathExists(modulePath)) {
      return current;
    }
    current = path.dirname(current);
  }

  throw new Error('WORKSPACE_ROOT is not set and achillesAgentLib was not found.');
}

async function loadWorkspaceLlmModule(workspaceRoot) {
  if (!workspaceRoot) {
    throw new Error('WORKSPACE_ROOT is not set; cannot locate achillesAgentLib.');
  }
  const modulePath = path.join(workspaceRoot, 'node_modules', 'achillesAgentLib', 'LLMAgents', 'index.mjs');
  try {
    await fs.access(modulePath);
  } catch {
    throw new Error(`LLM library not found at ${modulePath}. Ensure Ploinky dependencies are installed in the workspace.`);
  }
  return import(pathToFileURL(modulePath).href);
}

function buildAnalyzePrompt(backlogContent, context) {
  const ctx = context ? JSON.stringify(context, null, 2) : '{}';
  return [
    'You are generating a step-by-step implementation plan from a backlog.',
    'Return ONLY a JSON array of plan items with this schema:',
    '{"id":"string","description":"string","status":"proposed","filePath":"string?"}',
    'Rules:',
    '- Always include id and description.',
    '- status must be "proposed" by default.',
    '- Use filePath when you can infer the target file; otherwise omit it.',
    '',
    '[Context]',
    ctx,
    '',
    '[Backlog]',
    backlogContent
  ].join('\n');
}

function buildRegeneratePrompt(planItem, feedback) {
  return [
    'You are refining a single plan item based on user feedback.',
    'Return ONLY a JSON object with the same schema as the input item.',
    'Rules:',
    '- Preserve the original id.',
    '- Keep status and filePath unless the feedback requires changes.',
    '',
    '[Plan Item]',
    JSON.stringify(planItem, null, 2),
    '',
    '[User Feedback]',
    feedback
  ].join('\n');
}

function buildReviewPrompt(plan) {
  return [
    'You are validating a plan derived from a backlog.',
    'Return a concise plain-text review with risks or gaps (no JSON).',
    '',
    '[Plan]',
    JSON.stringify(plan, null, 2)
  ].join('\n');
}

function buildExecutePrompt(planItem, fileContent) {
  return [
    'You are implementing a single plan item by editing the given file content.',
    'Return ONLY the full updated file content (no JSON, no markdown fences).',
    '',
    '[Plan Item]',
    JSON.stringify(planItem, null, 2),
    '',
    '[File Content]',
    fileContent
  ].join('\n');
}

async function resolveAgent(llm, modelName) {
  if (modelName && typeof llm.getLLMAgent === 'function') {
    try {
      const agent = await llm.getLLMAgent(modelName);
      if (agent) return agent;
    } catch {
      // ignore and fall back
    }
  }
  const agent = (typeof llm.getDefaultLLMAgent === 'function' && llm.getDefaultLLMAgent())
    || (typeof llm.registerDefaultLLMAgent === 'function' && llm.registerDefaultLLMAgent());
  if (!agent) {
    throw new Error('No default LLM agent available.');
  }
  return agent;
}

function ensurePlanItemIds(items) {
  return items.map((item, index) => {
    const safe = item && typeof item === 'object' ? { ...item } : {};
    if (!safe.id) {
      safe.id = `item-${index + 1}`;
    }
    if (!safe.status) {
      safe.status = 'proposed';
    }
    return safe;
  });
}

function resolveFilePath(filePath, context = {}) {
  if (!filePath || typeof filePath !== 'string') return null;
  if (path.isAbsolute(filePath)) return filePath;
  const base = context.repoRoot || context.basePath || context.workspaceRoot || process.cwd();
  return path.join(base, filePath.replace(/^\/+/, ''));
}

async function executePlanItems({ plan, modelName, context }) {
  const llm = await loadWorkspaceLlmModule(context.workspaceRoot);
  const agent = await resolveAgent(llm, modelName);
  const results = [];

  const items = Array.isArray(plan) ? plan : [];
  for (const item of items) {
    const accepted = item?.status === 'accepted' || item?.accepted === true;
    if (!accepted) continue;

    const targetPath = resolveFilePath(item?.filePath, context);
    if (!targetPath) {
      results.push({ id: item?.id, ok: false, error: 'Missing filePath.' });
      continue;
    }

    let content;
    try {
      content = await fs.readFile(targetPath, 'utf8');
    } catch (error) {
      results.push({ id: item?.id, ok: false, error: `Failed to read ${targetPath}: ${error?.message || error}` });
      continue;
    }

    const prompt = buildExecutePrompt(item, content);
    const raw = await agent.executePrompt(prompt, { mode: 'fast', responseShape: 'text', model: modelName });
    const updated = stripFences(raw);
    if (!updated) {
      results.push({ id: item?.id, ok: false, error: 'LLM returned empty content.' });
      continue;
    }

    try {
      await fs.writeFile(targetPath, updated, 'utf8');
      results.push({ id: item?.id, ok: true, path: targetPath });
    } catch (error) {
      results.push({ id: item?.id, ok: false, error: `Failed to write ${targetPath}: ${error?.message || error}` });
    }
  }

  return results;
}

export default async function backlogSkill(input, context = {}) {
  let payload = input;
  if (typeof payload === 'string') {
    const parsed = safeParseJson(payload.trim());
    if (parsed) payload = parsed;
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid input. Expected an object payload.');
  }

  const action = String(payload.action || '').trim();
  if (!action) {
    throw new Error('Missing action.');
  }

  const workspaceRoot = await resolveWorkspaceRoot(context);
  const llm = await loadWorkspaceLlmModule(workspaceRoot);

  if (action === 'analyze') {
    const backlogContent = String(payload.backlogContent || '').trim();
    if (!backlogContent) {
      throw new Error('backlogContent is required.');
    }
    const agent = await resolveAgent(llm, payload.modelName);
    const prompt = buildAnalyzePrompt(backlogContent, payload.context || {});
    const raw = await agent.executePrompt(prompt, { mode: 'fast', responseShape: 'text', model: payload.modelName });
    const jsonText = stripFences(raw);
    const parsed = safeParseJson(jsonText);
    if (!Array.isArray(parsed)) {
      throw new Error('Analyze must return a JSON array of plan items.');
    }
    return JSON.stringify(ensurePlanItemIds(parsed));
  }

  if (action === 'regenerate_item') {
    const planItem = payload.planItem;
    const feedback = String(payload.userFeedback || '').trim();
    if (!planItem || typeof planItem !== 'object') {
      throw new Error('planItem is required.');
    }
    if (!feedback) {
      throw new Error('userFeedback is required.');
    }
    const agent = await resolveAgent(llm, payload.modelName);
    const prompt = buildRegeneratePrompt(planItem, feedback);
    const raw = await agent.executePrompt(prompt, { mode: 'fast', responseShape: 'text', model: payload.modelName });
    const jsonText = stripFences(raw);
    const parsed = safeParseJson(jsonText);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Regenerate must return a JSON object.');
    }
    parsed.id = planItem.id;
    if (!parsed.status) parsed.status = planItem.status || 'proposed';
    return JSON.stringify(parsed);
  }

  if (action === 'review_plan') {
    const plan = Array.isArray(payload.plan) ? payload.plan : null;
    if (!plan) {
      throw new Error('plan is required.');
    }
    const agent = await resolveAgent(llm, payload.modelName);
    const prompt = buildReviewPrompt(plan);
    const raw = await agent.executePrompt(prompt, { mode: 'fast', responseShape: 'text', model: payload.modelName });
    return stripFences(raw);
  }

  if (action === 'execute_plan') {
    const plan = Array.isArray(payload.plan) ? payload.plan : null;
    if (!plan) {
      throw new Error('plan is required.');
    }
    const results = await executePlanItems({
      plan,
      modelName: payload.modelName,
      context: { ...context, workspaceRoot }
    });
    return JSON.stringify({ ok: true, results });
  }

  throw new Error(`Unsupported action: ${action}`);
}
