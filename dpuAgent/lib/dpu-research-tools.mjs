import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { appendToolAudit, assertInvocationScopeFor } from './dpu-store.mjs';
import {
  acquireResource,
  cancelJob,
  compareResearch,
  confirmAction,
  getAction,
  getJob,
  getResource,
  getResourceProvenance,
  getSource,
  listJobs,
  listComputeBackends,
  listResources,
  listResourceFiles,
  listSources,
  registerResource,
  readResourceFile,
  rejectAction,
  revokeResource,
  removeSource,
  proposeFederatedExperiment,
  proposeSecureExecution,
  resolveResourceAccess,
  searchResearch,
  setSourceEnabled,
  setComputeBackendEnabled,
  shareResource,
  proposeOutputRelease,
  statResourceFile,
  testSource,
  testComputeBackend,
  updateResourceUse,
  upsertComputeBackend,
  upsertSource
} from './dpu-research.mjs';

const RESEARCH_TOOL_PATTERN = /^(dpu_resource_|dpu_source_|dpu_research_|dpu_job_|dpu_action_|dpu_compute_|dpu_federated_|dpu_secure_)/;
const DPU_RECORD_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const RESEARCH_PROVIDER_TYPES = new Set(['huggingface', 'edc']);
const agentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export class DpuPlannerInputError extends Error {
  constructor(message, { code = 'invalid_planner_input', retryArgs = null, autoRetry = false } = {}) {
    super(message);
    this.name = 'DpuPlannerInputError';
    this.code = code;
    this.retryArgs = retryArgs;
    this.autoRetry = autoRetry;
  }
}

function providerType(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (normalized === 'huggingface') return 'huggingface';
  if (normalized === 'edc') return 'edc';
  return '';
}

function loadResearchToolDefinitions() {
  const config = JSON.parse(fs.readFileSync(path.join(agentRoot, 'mcp-config.json'), 'utf8'));
  return (Array.isArray(config.tools) ? config.tools : [])
    .filter((entry) => RESEARCH_TOOL_PATTERN.test(String(entry?.name || '')))
    .map((entry) => ({
      name: String(entry.name),
      title: String(entry.title || entry.name),
      description: String(entry.description || entry.title || entry.name),
      inputSchema: entry.inputSchema && typeof entry.inputSchema === 'object' ? entry.inputSchema : {}
    }));
}

export const DPU_RESEARCH_TOOL_DEFINITIONS = Object.freeze(loadResearchToolDefinitions());

export function isDpuResearchTool(toolName) {
  return RESEARCH_TOOL_PATTERN.test(String(toolName || ''));
}

function requireString(toolName, input, name) {
  if (typeof input[name] !== 'string' || !input[name].trim()) {
    throw new DpuPlannerInputError(`${toolName} requires a "${name}" string.`);
  }
}

export function normalizeDpuResearchToolArgs(toolName, args) {
  const input = args && typeof args === 'object' && !Array.isArray(args) ? { ...args } : {};
  switch (toolName) {
    case 'dpu_resource_list':
    case 'dpu_source_list':
    case 'dpu_job_list':
    case 'dpu_compute_backend_list':
      return input;
    case 'dpu_resource_get':
    case 'dpu_resource_file_list':
    case 'dpu_resource_resolve_access':
    case 'dpu_resource_get_provenance':
    case 'dpu_source_get':
    case 'dpu_source_test':
    case 'dpu_source_remove':
    case 'dpu_job_get':
    case 'dpu_job_cancel':
    case 'dpu_action_get':
    case 'dpu_action_confirm':
    case 'dpu_action_reject':
    case 'dpu_compute_backend_test':
      requireString(toolName, input, 'id');
      return input;
    case 'dpu_resource_file_stat':
    case 'dpu_resource_file_read':
      requireString(toolName, input, 'id');
      requireString(toolName, input, 'path');
      return input;
    case 'dpu_resource_register':
      requireString(toolName, input, 'provider');
      requireString(toolName, input, 'externalId');
      return input;
    case 'dpu_resource_update_use':
    case 'dpu_resource_acquire':
      requireString(toolName, input, 'id');
      return input;
    case 'dpu_resource_share':
      requireString(toolName, input, 'id');
      requireString(toolName, input, 'principal');
      requireString(toolName, input, 'role');
      return input;
    case 'dpu_resource_revoke':
      requireString(toolName, input, 'id');
      requireString(toolName, input, 'principal');
      return input;
    case 'dpu_resource_release_output':
      requireString(toolName, input, 'id');
      requireString(toolName, input, 'destination');
      return input;
    case 'dpu_source_upsert':
      requireString(toolName, input, 'type');
      return input;
    case 'dpu_compute_backend_upsert':
      requireString(toolName, input, 'type');
      return input;
    case 'dpu_compute_backend_set_enabled':
      requireString(toolName, input, 'id');
      if (typeof input.enabled !== 'boolean') throw new DpuPlannerInputError('dpu_compute_backend_set_enabled requires an "enabled" boolean.');
      return input;
    case 'dpu_federated_experiment_propose':
      for (const field of ['backendId', 'templateId', 'modelId', 'modelRevision', 'strategy']) requireString(toolName, input, field);
      if (!Array.isArray(input.participantResourceIds)) throw new DpuPlannerInputError('dpu_federated_experiment_propose requires a "participantResourceIds" array.');
      return input;
    case 'dpu_secure_execution_propose':
      for (const field of ['backendId', 'workloadId']) requireString(toolName, input, field);
      if (!Array.isArray(input.resourceIds)) throw new DpuPlannerInputError('dpu_secure_execution_propose requires a "resourceIds" array.');
      return input;
    case 'dpu_source_set_enabled':
      requireString(toolName, input, 'id');
      if (typeof input.enabled !== 'boolean') {
        throw new DpuPlannerInputError('dpu_source_set_enabled requires an "enabled" boolean.');
      }
      return input;
    case 'dpu_research_search':
      requireString(toolName, input, 'query');
      if (input.providerTypes !== undefined) {
        if (!Array.isArray(input.providerTypes)
          || input.providerTypes.some((type) => !RESEARCH_PROVIDER_TYPES.has(String(type || '').trim().toLowerCase()))) {
          throw new DpuPlannerInputError('dpu_research_search requires "providerTypes" to contain only supported provider types: huggingface or edc.');
        }
        input.providerTypes = [...new Set(input.providerTypes.map((type) => String(type).trim().toLowerCase()))];
      }
      if (input.sourceIds !== undefined) {
        if (!Array.isArray(input.sourceIds)
          || input.sourceIds.some((id) => typeof id !== 'string' || !DPU_RECORD_ID_PATTERN.test(id))) {
          const retryArgs = { ...input };
          const submittedSourceIds = Array.isArray(input.sourceIds) ? input.sourceIds : [];
          const exactSourceIds = submittedSourceIds.filter((id) => typeof id === 'string' && DPU_RECORD_ID_PATTERN.test(id));
          const invalidSourceIds = submittedSourceIds.filter((id) => typeof id !== 'string' || !DPU_RECORD_ID_PATTERN.test(id));
          const recoveredProviderTypes = invalidSourceIds.map(providerType).filter(Boolean);
          const hasUnknownLabel = invalidSourceIds.some((id) => !providerType(id));
          if (exactSourceIds.length) retryArgs.sourceIds = exactSourceIds;
          else delete retryArgs.sourceIds;
          if (recoveredProviderTypes.length) {
            retryArgs.providerTypes = [...new Set([...(retryArgs.providerTypes || []), ...recoveredProviderTypes])];
          }
          throw new DpuPlannerInputError(
            'dpu_research_search requires "sourceIds" to contain only exact DPU source UUIDs returned by DPU tools. Provider types and names are not source IDs.',
            { code: 'invalid_source_ids', retryArgs, autoRetry: recoveredProviderTypes.length > 0 && !hasUnknownLabel }
          );
        }
      }
      return input;
    case 'dpu_research_compare':
      if (!Array.isArray(input.ids)) {
        throw new DpuPlannerInputError('dpu_research_compare requires an "ids" array.');
      }
      return input;
    default:
      throw new DpuPlannerInputError(`Unsupported DPU research tool: ${toolName || '<missing>'}`);
  }
}

async function dispatchDpuResearchTool(toolName, authInfo, args) {
  switch (toolName) {
    case 'dpu_resource_list': return listResources(authInfo, args);
    case 'dpu_resource_get': return getResource(authInfo, args);
    case 'dpu_resource_file_list': return listResourceFiles(authInfo, args);
    case 'dpu_resource_file_stat': return statResourceFile(authInfo, args);
    case 'dpu_resource_file_read': return readResourceFile(authInfo, args);
    case 'dpu_resource_register': return registerResource(authInfo, args);
    case 'dpu_resource_update_use': return updateResourceUse(authInfo, args);
    case 'dpu_resource_resolve_access': return resolveResourceAccess(authInfo, args);
    case 'dpu_resource_acquire': return acquireResource(authInfo, args);
    case 'dpu_resource_share': return shareResource(authInfo, args);
    case 'dpu_resource_revoke': return revokeResource(authInfo, args);
    case 'dpu_resource_release_output': return proposeOutputRelease(authInfo, args);
    case 'dpu_resource_get_provenance': return getResourceProvenance(authInfo, args);
    case 'dpu_source_list': return listSources(authInfo);
    case 'dpu_source_get': return getSource(authInfo, args);
    case 'dpu_source_upsert': return upsertSource(authInfo, args);
    case 'dpu_source_test': return testSource(authInfo, args);
    case 'dpu_source_set_enabled': return setSourceEnabled(authInfo, args);
    case 'dpu_source_remove': return removeSource(authInfo, args);
    case 'dpu_compute_backend_list': return listComputeBackends(authInfo);
    case 'dpu_compute_backend_upsert': return upsertComputeBackend(authInfo, args);
    case 'dpu_compute_backend_test': return testComputeBackend(authInfo, args);
    case 'dpu_compute_backend_set_enabled': return setComputeBackendEnabled(authInfo, args);
    case 'dpu_federated_experiment_propose': return proposeFederatedExperiment(authInfo, args);
    case 'dpu_secure_execution_propose': return proposeSecureExecution(authInfo, args);
    case 'dpu_research_search': return searchResearch(authInfo, args);
    case 'dpu_research_compare': return compareResearch(authInfo, args);
    case 'dpu_job_list': return listJobs(authInfo, args);
    case 'dpu_job_get': return getJob(authInfo, args);
    case 'dpu_job_cancel': return cancelJob(authInfo, args);
    case 'dpu_action_get': return getAction(authInfo, args);
    case 'dpu_action_confirm': return confirmAction(authInfo, args);
    case 'dpu_action_reject': return rejectAction(authInfo, args);
    default: throw new Error(`Unsupported DPU research tool: ${toolName || '<missing>'}`);
  }
}

export async function executeDpuResearchTool(toolName, authInfo, rawArgs = {}) {
  const args = normalizeDpuResearchToolArgs(toolName, rawArgs);
  try {
    assertInvocationScopeFor(toolName, authInfo);
    const result = await dispatchDpuResearchTool(toolName, authInfo, args);
    const status = result?.ok === false ? 'error' : 'ok';
    const error = status === 'error' ? String(result?.message || result?.error || `${toolName} failed.`) : '';
    await appendToolAudit(authInfo, toolName, args, status, error);
    return result;
  } catch (error) {
    await appendToolAudit(authInfo, toolName, args, 'error', error?.message || String(error)).catch(() => {});
    throw error;
  }
}

export function parsePlannerArguments(raw) {
  const text = String(raw || '').replace(/\r\n?/g, '\n').trim();
  const fenced = text.match(/^```json[ \t]*\n([\s\S]*?)\n```[ \t]*$/);
  if (!fenced) {
    throw new DpuPlannerInputError('DPU tool input must be exactly one JSON object in a fenced ```json Markdown block, with no surrounding text.');
  }
  try {
    const parsed = JSON.parse(fenced[1]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (_) {}
  throw new DpuPlannerInputError('DPU tool input fence must contain one valid JSON object matching the declared input schema.');
}

function plannerRecoveryResult(toolName, error) {
  const retry = error.retryArgs && typeof error.retryArgs === 'object'
    ? {
        tool: toolName,
        arguments: error.retryArgs,
        instruction: 'Retry the same tool with exactly these arguments in one fenced json block. Do not restore rejected fields.'
      }
    : {
        tool: toolName,
        instruction: 'Correct the tool input using its declared schema and retry it in one fenced json block.'
      };
  return {
    ok: false,
    recoverable: true,
    code: error.code,
    error: error.message,
    retry
  };
}

export function createDpuResearchPlannerTools({ getAuthInfo, executeTool = executeDpuResearchTool } = {}) {
  if (typeof getAuthInfo !== 'function') {
    throw new Error('DPU planner tools require a verified auth context provider.');
  }
  return Object.fromEntries(DPU_RESEARCH_TOOL_DEFINITIONS.map((definition) => [
    definition.name,
    {
      description: `${definition.description}\nInput JSON schema: ${JSON.stringify(definition.inputSchema)}`,
      handler: async (_agent, promptText) => {
        const authInfo = getAuthInfo();
        if (!authInfo) throw new Error('Verified WebChat invocation is required for DPU tools.');
        try {
          const args = normalizeDpuResearchToolArgs(definition.name, parsePlannerArguments(promptText));
          const result = await executeTool(definition.name, authInfo, args);
          return typeof result === 'string' ? result : JSON.stringify(result);
        } catch (error) {
          if (!(error instanceof DpuPlannerInputError)) throw error;
          if (error.autoRetry && error.retryArgs) {
            const args = normalizeDpuResearchToolArgs(definition.name, error.retryArgs);
            return JSON.stringify(await executeTool(definition.name, authInfo, args));
          }
          return JSON.stringify(plannerRecoveryResult(definition.name, error));
        }
      }
    }
  ]));
}
