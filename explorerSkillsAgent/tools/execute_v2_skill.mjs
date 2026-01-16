#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

function safeParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function stringifyResult(payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload ?? '');
  return JSON.stringify({
    content: [{ type: 'text', text: JSON.stringify({ ok: true, message: text }) }]
  });
}

function stringifyError(message) {
  return JSON.stringify({
    content: [{ type: 'text', text: JSON.stringify({ ok: false, message: '', error: message }) }]
  });
}

async function pathExists(candidate) {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function resolveWorkspaceRoot() {
  const envCandidates = [
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

  const moduleSuffix = path.join('node_modules', 'achillesAgentLib', 'index.mjs');

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

  return envCandidates[0] || process.cwd();
}

async function loadAchillesModule() {
  try {
    return await import('achillesAgentLib');
  } catch {
    // fall through
  }

  const workspaceRoot = await resolveWorkspaceRoot();
  const modulePath = path.join(workspaceRoot, 'node_modules', 'achillesAgentLib', 'index.mjs');
  if (!await pathExists(modulePath)) {
    throw new Error(`achillesAgentLib not found at ${modulePath}`);
  }
  return import(pathToFileURL(modulePath).href);
}

function listSkillKeys(agent) {
  if (agent?.skills && typeof agent.skills === 'object') return Object.keys(agent.skills);
  if (agent?.skillRecords && typeof agent.skillRecords === 'object') return Object.keys(agent.skillRecords);
  if (agent?._skills && typeof agent._skills === 'object') return Object.keys(agent._skills);
  if (agent?.registry?.skills && typeof agent.registry.skills === 'object') return Object.keys(agent.registry.skills);
  return [];
}

function resolveSkillKey(agent, requested) {
  const keys = listSkillKeys(agent);
  if (!keys.length) return requested;
  if (keys.includes(requested)) return requested;
  const normalized = String(requested || '').toLowerCase();
  const exact = keys.find((key) => key.toLowerCase() === normalized);
  if (exact) return exact;
  const candidates = keys.filter((key) => key.toLowerCase().includes(normalized));
  if (!candidates.length) return requested;
  const preferred = candidates.find((key) => key.toLowerCase().endsWith('-code'))
    || candidates.find((key) => key.toLowerCase().includes('-code'))
    || candidates[0];
  return preferred;
}

async function main() {
  const raw = await fs.readFile(0, 'utf8').catch(() => '');
  const envelope = raw && raw.trim() ? safeParseJson(raw) : null;
  const inputData = envelope?.input && typeof envelope.input === 'object' ? envelope.input : {};
  const action = String(inputData.action || 'execute').trim();

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const agentRoot = path.resolve(__dirname, '..');

  let RecursiveSkilledAgent;
  let llmAgentRegistry;
  try {
    const lib = await loadAchillesModule();
    RecursiveSkilledAgent = lib.RecursiveSkilledAgent;
    llmAgentRegistry = lib.llmAgentRegistry;
  } catch (error) {
    process.stdout.write(stringifyError(`Failed to load achillesAgentLib: ${error?.message || error}`));
    return;
  }

  const llmAgent = llmAgentRegistry?.registerDefault ? llmAgentRegistry.registerDefault({ name: 'ExplorerSkills-LLM' }) : null;
  const agent = new RecursiveSkilledAgent({
    llmAgent,
    startDir: agentRoot,
    logger: {
      log: () => {},
      warn: () => {},
      error: () => {}
    }
  });

  if (action === 'list') {
    const keys = listSkillKeys(agent);
    process.stdout.write(stringifyResult(JSON.stringify(keys)));
    return;
  }

  const skillName = String(inputData.skillName || '').trim();
  if (!skillName) {
    process.stdout.write(stringifyError('skillName is required.'));
    return;
  }

  const resolved = resolveSkillKey(agent, skillName);
  const payload = inputData.input ?? {};
  const prompt = typeof payload === 'string' ? payload : JSON.stringify(payload);

  try {
    const result = await agent.executePrompt(prompt, {
      skillName: resolved,
      context: {
        workspaceRoot: process.env.WORKSPACE_ROOT || process.env.ASSISTOS_FS_ROOT || '',
        user: inputData.user || null,
        task: inputData.task || null,
        metadata: inputData.metadata || null
      }
    });

    const output = result?.result?.output ?? result?.output ?? result?.result ?? result;
    process.stdout.write(stringifyResult(output));
  } catch (error) {
    process.stdout.write(stringifyError(error?.message || String(error)));
  }
}

main();
