import { callAgentTool, ensureSuccess } from "../infrastructure/explorerApi.js";

const mountedPluginEvents = new Set();

function normalizePath(value) {
    return String(value || '').trim();
}

function sanitizeMetadata(value) {
    if (value === null || value === undefined) {
        return undefined;
    }
    if (Array.isArray(value)) {
        return value.map((entry) => sanitizeMetadata(entry));
    }
    if (typeof value === 'object') {
        const output = {};
        for (const [key, entry] of Object.entries(value)) {
            if (entry === undefined) {
                continue;
            }
            output[key] = sanitizeMetadata(entry);
        }
        return output;
    }
    return value;
}

export async function emitAuditEvent(eventType, payload = {}) {
    const normalizedEventType = String(eventType || '').trim();
    if (!normalizedEventType) {
        return false;
    }
    try {
        const raw = await callAgentTool('dpuAgent', 'dpu_audit_event_append', {
            eventType: normalizedEventType,
            source: String(payload.source || 'explorer').trim() || 'explorer',
            path: normalizePath(payload.path),
            targetPath: normalizePath(payload.targetPath),
            action: String(payload.action || '').trim(),
            pluginKey: String(payload.pluginKey || '').trim(),
            slot: String(payload.slot || '').trim(),
            currentPath: normalizePath(payload.currentPath),
            selectedPath: normalizePath(payload.selectedPath),
            language: String(payload.language || '').trim(),
            prompt: payload.prompt === undefined ? undefined : String(payload.prompt || ''),
            response: payload.response === undefined ? undefined : String(payload.response || ''),
            metadata: sanitizeMetadata(payload.metadata)
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
        selectedPath: context?.selectedPath || '',
        metadata: {
            orientation: context?.orientation || ''
        }
    });
}
