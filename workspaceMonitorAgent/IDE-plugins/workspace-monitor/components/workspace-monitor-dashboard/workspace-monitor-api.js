import { callAgentTool, ensureSuccess, parseToolResult } from '/explorer/services/infrastructure/explorerApi.js';

const MONITOR_RETRY_DELAYS_MS = [300, 900, 1_800];

export async function callDpu(name, args = {}) {
  const result = await callAgentTool('dpuAgent', name, args, { raw: true });
  ensureSuccess(result);
  return parseToolResult(result) || {};
}

export async function callMonitor(name, args = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const result = await callAgentTool('workspaceMonitorAgent', name, args, { raw: true });
      ensureSuccess(result);
      const payload = parseToolResult(result) || {};
      if (payload.ok === false) throw new Error(payload.message || 'Workspace Monitor request failed.');
      return payload;
    } catch (error) {
      const message = String(error?.message || error || '');
      const transientGenerationFailure = /browser_csrf_invalid|edge_generation_changed/i.test(message);
      if (!transientGenerationFailure || attempt >= MONITOR_RETRY_DELAYS_MS.length) throw error;
      window.webSkel?.appServices?.resetClient?.('workspaceMonitorAgent');
      await new Promise((resolve) => setTimeout(resolve, MONITOR_RETRY_DELAYS_MS[attempt]));
    }
  }
}
