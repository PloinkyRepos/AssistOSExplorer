import { callAgentTool, ensureSuccess } from "../infrastructure/explorerApi.js";

const mountedPluginEvents = new Set();

function normalizePath(value) {
    return String(value || '').trim();
}

export async function emitAuditEvent(eventType, payload = {}) {
    const normalizedEventType = String(eventType || '').trim();
    if (!normalizedEventType) {
        return false;
    }
    const source = String(payload.source || 'explorer').trim() || 'explorer';
    if (/^(ai|llm|copilot)[.:_-]/i.test(normalizedEventType)
        || ['ai', 'llm', 'copilot'].includes(source.toLowerCase())) {
        return false;
    }
    try {
        const raw = await callAgentTool('dpuAgent', 'dpu_audit_event_append', {
            eventType: normalizedEventType,
            source,
            path: normalizePath(payload.path),
            targetPath: normalizePath(payload.targetPath),
            action: String(payload.action || '').trim(),
            pluginKey: String(payload.pluginKey || '').trim(),
            slot: String(payload.slot || '').trim(),
            currentPath: normalizePath(payload.currentPath),
            selectedPath: normalizePath(payload.selectedPath),
            language: String(payload.language || '').trim()
        }, { raw: true });
        ensureSuccess(raw);
        return true;
    } catch (_) {
        return false;
    }
}

export async function emitPluginMountedAudit(pluginKey, context = {}) {
    const key = `${String(pluginKey || '').trim()}::${String(context?.slot || '').trim()}`;
    if (!pluginKey || mountedPluginEvents.has(key)) {
        return false;
    }
    mountedPluginEvents.add(key);
    return emitAuditEvent('plugin.used', {
        pluginKey,
        slot: context?.slot || '',
        currentPath: context?.currentPath || '',
        selectedPath: context?.selectedPath || ''
    });
}
