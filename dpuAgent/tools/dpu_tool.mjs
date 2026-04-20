#!/usr/bin/env node
import {
  getAuditConfig,
  setAuditConfig,
  listAuditEntries,
  getAuditEntry,
  appendAuditClientEvent,
  getWhoAmI,
  getWorkspaceRoots,
  listSecrets,
  getSecretByKey,
  putSecret,
  deleteSecret,
  grantSecret,
  revokeSecret,
  listConfidential,
  getConfidentialById,
  createConfidential,
  updateConfidential,
  deleteConfidential,
  addConfidentialComment,
  deleteConfidentialComment,
  grantConfidential,
  revokeConfidential,
  accessCheck
} from '../lib/dpu-store.mjs';
import { authInfoFromInvocation } from '../../shared/invocation-auth.mjs';

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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

function extractAuthInfo(envelope) {
  const metadata = envelope && typeof envelope === 'object' ? envelope.metadata : null;
  const authInfo = metadata && typeof metadata === 'object' ? metadata.authInfo : null;
  return authInfo && typeof authInfo === 'object' ? authInfo : null;
}

function extractInvocationGrant(envelope) {
  const metadata = envelope && typeof envelope === 'object' ? envelope.metadata : null;
  const grant = metadata && typeof metadata === 'object' ? metadata.invocation : null;
  return grant && typeof grant === 'object' ? grant : null;
}

function normalizeArgs(toolName, args) {
  const input = args && typeof args === 'object' ? { ...args } : {};
  const requireString = (name) => {
    if (typeof input[name] !== 'string' || !input[name].trim()) {
      throw new Error(`${toolName} requires a "${name}" string.`);
    }
  };

  switch (toolName) {
    case 'dpu_whoami':
    case 'dpu_workspace_roots':
    case 'secret_list':
    case 'dpu_secret_list':
    case 'dpu_audit_config_get':
    case 'dpu_audit_list':
      return input;
    case 'dpu_audit_event_append':
      requireString('eventType');
      return input;
    case 'dpu_audit_config_set':
      if (typeof input.enabled !== 'boolean') {
        throw new Error('dpu_audit_config_set requires an "enabled" boolean.');
      }
      return input;
    case 'dpu_audit_get':
      requireString('name');
      return input;
    case 'secret_get':
    case 'secret_delete':
    case 'dpu_secret_get':
    case 'dpu_secret_delete':
      requireString('key');
      return input;
    case 'secret_put':
    case 'dpu_secret_put':
      requireString('key');
      if (typeof input.value !== 'string') {
        throw new Error(`${toolName} requires a "value" string.`);
      }
      return input;
    case 'secret_grant':
    case 'dpu_secret_grant':
      requireString('key');
      requireString('principal');
      requireString('role');
      return input;
    case 'secret_revoke':
    case 'dpu_secret_revoke':
      requireString('key');
      requireString('principal');
      return input;
    case 'dpu_confidential_list':
      if (input.scope !== undefined && !['my-space', 'shared'].includes(String(input.scope))) {
        throw new Error('dpu_confidential_list scope must be "my-space" or "shared".');
      }
      return input;
    case 'dpu_confidential_get':
    case 'dpu_confidential_delete':
      requireString('id');
      return input;
    case 'dpu_confidential_comment_add':
      requireString('id');
      requireString('message');
      return input;
    case 'dpu_confidential_comment_delete':
      requireString('id');
      requireString('commentId');
      return input;
    case 'dpu_confidential_create':
      requireString('type');
      requireString('name');
      return input;
    case 'dpu_confidential_update':
      requireString('id');
      return input;
    case 'dpu_confidential_grant':
      requireString('id');
      requireString('principal');
      requireString('role');
      return input;
    case 'dpu_confidential_revoke':
      requireString('id');
      requireString('principal');
      return input;
    case 'dpu_access_check':
      requireString('kind');
      requireString('permission');
      if (String(input.kind) === 'secret') {
        requireString('key');
      } else if (String(input.kind) === 'confidential') {
        requireString('id');
      }
      return input;
    default:
      throw new Error(`Unsupported tool: ${toolName}`);
  }
}

async function main() {
  let raw = await readStdinFallback();
  if (!raw) {
    raw = '';
  }
  const envelope = raw && raw.trim() ? safeParseJson(raw) : null;
  // Prefer the verified invocation grant (already validated by the MCP server)
  // over the legacy x-ploinky-auth-info blob. Fall back to the legacy blob
  // during migration if no invocation is present.
  const invocationGrant = extractInvocationGrant(envelope || {});
  const authInfo = invocationGrant
    ? authInfoFromInvocation(invocationGrant)
    : extractAuthInfo(envelope || {});
  const toolName = process.env.TOOL_NAME;
  const args = normalizeArgs(toolName, normalizeInput(envelope || {}));

  let result;
  switch (toolName) {
    case 'dpu_whoami':
      result = await getWhoAmI(authInfo);
      break;
    case 'dpu_audit_config_get':
      result = await getAuditConfig(authInfo);
      break;
    case 'dpu_audit_config_set':
      result = await setAuditConfig(authInfo, args);
      break;
    case 'dpu_audit_list':
      result = await listAuditEntries(authInfo, args);
      break;
    case 'dpu_audit_get':
      result = await getAuditEntry(authInfo, args);
      break;
    case 'dpu_audit_event_append':
      result = await appendAuditClientEvent(authInfo, args);
      break;
    case 'dpu_workspace_roots':
      result = await getWorkspaceRoots(authInfo);
      break;
    case 'secret_list':
    case 'dpu_secret_list':
      result = await listSecrets(authInfo);
      break;
    case 'secret_get':
    case 'dpu_secret_get':
      result = await getSecretByKey(authInfo, args);
      break;
    case 'secret_put':
    case 'dpu_secret_put':
      result = await putSecret(authInfo, args);
      break;
    case 'secret_delete':
    case 'dpu_secret_delete':
      result = await deleteSecret(authInfo, args);
      break;
    case 'secret_grant':
    case 'dpu_secret_grant':
      result = await grantSecret(authInfo, args);
      break;
    case 'secret_revoke':
    case 'dpu_secret_revoke':
      result = await revokeSecret(authInfo, args);
      break;
    case 'dpu_confidential_list':
      result = await listConfidential(authInfo, args);
      break;
    case 'dpu_confidential_get':
      result = await getConfidentialById(authInfo, args);
      break;
    case 'dpu_confidential_create':
      result = await createConfidential(authInfo, args);
      break;
    case 'dpu_confidential_update':
      result = await updateConfidential(authInfo, args);
      break;
    case 'dpu_confidential_delete':
      result = await deleteConfidential(authInfo, args);
      break;
    case 'dpu_confidential_comment_add':
      result = await addConfidentialComment(authInfo, args);
      break;
    case 'dpu_confidential_comment_delete':
      result = await deleteConfidentialComment(authInfo, args);
      break;
    case 'dpu_confidential_grant':
      result = await grantConfidential(authInfo, args);
      break;
    case 'dpu_confidential_revoke':
      result = await revokeConfidential(authInfo, args);
      break;
    case 'dpu_access_check':
      result = await accessCheck(authInfo, args);
      break;
    default:
      throw new Error(`Unsupported tool: ${toolName || '<missing>'}`);
  }

  writeJson(result);
}

main().catch((error) => {
  writeJson({
    ok: false,
    error: 'dpu_tool_failed',
    message: error?.message || String(error)
  });
  process.exitCode = 1;
});
