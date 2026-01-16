import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function safeParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
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

function collectModelNames(value, results) {
  if (!value) return;
  if (typeof value === 'string') {
    results.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectModelNames(item, results));
    return;
  }
  if (typeof value === 'object') {
    if (typeof value.model === 'string') results.add(value.model);
    if (typeof value.modelName === 'string') results.add(value.modelName);
    if (typeof value.name === 'string') results.add(value.name);
    if (value.models) collectModelNames(value.models, results);
    if (value.availableModels) collectModelNames(value.availableModels, results);
    if (value.providers) collectModelNames(value.providers, results);
  }
}

async function loadConfigFromFile(filePath) {
  if (!filePath) return null;
  if (!await pathExists(filePath)) return null;
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') {
    const raw = await fs.readFile(filePath, 'utf8');
    return safeParseJson(raw);
  }
  if (ext === '.mjs' || ext === '.js') {
    const mod = await import(pathToFileURL(filePath).href);
    return mod?.default || mod?.config || mod?.llmConfig || mod?.models || mod;
  }
  return null;
}

async function tryLoadFromKnownPaths(moduleBase) {
  const candidates = [
    'LLMAgents/config.json',
    'LLMAgents/config.mjs',
    'LLMAgents/llm-config.json',
    'LLMAgents/llmConfig.json',
    'LLMAgents/models.json',
    'LLMAgents/providers.json',
    'config/llm-config.json',
    'config/llmConfig.json',
    'config/models.json',
    'llm-config.json',
    'models.json'
  ];
  for (const relative of candidates) {
    const full = path.join(moduleBase, relative);
    const loaded = await loadConfigFromFile(full);
    if (loaded) return loaded;
  }
  return null;
}

async function tryLoadFromModule(workspaceRoot) {
  const modulePath = path.join(workspaceRoot, 'node_modules', 'achillesAgentLib', 'LLMAgents', 'index.mjs');
  if (!await pathExists(modulePath)) return null;
  const mod = await import(pathToFileURL(modulePath).href);
  if (typeof mod.getAvailableModels === 'function') {
    try {
      return await mod.getAvailableModels();
    } catch {
      // ignore
    }
  }
  if (typeof mod.listModels === 'function') {
    try {
      return await mod.listModels();
    } catch {
      // ignore
    }
  }
  if (mod.availableModels) return mod.availableModels;
  if (mod.models) return mod.models;
  if (typeof mod.getDefaultLLMAgent === 'function') {
    try {
      const agent = mod.getDefaultLLMAgent();
      if (agent?.listModels) return await agent.listModels();
      if (agent?.getAvailableModels) return await agent.getAvailableModels();
    } catch {
      // ignore
    }
  }
  return null;
}

export default async function llmModels(_input, context = {}) {
  const workspaceRoot = await resolveWorkspaceRoot(context);
  const moduleBase = path.join(workspaceRoot, 'node_modules', 'achillesAgentLib');

  const results = new Set();

  const config = await tryLoadFromKnownPaths(moduleBase);
  if (config) {
    collectModelNames(config, results);
  }

  if (!results.size) {
    const modData = await tryLoadFromModule(workspaceRoot);
    if (modData) {
      collectModelNames(modData, results);
    }
  }

  if (!results.size) {
    throw new Error('No models found in achillesAgentLib configuration.');
  }

  return JSON.stringify(Array.from(results).sort());
}
