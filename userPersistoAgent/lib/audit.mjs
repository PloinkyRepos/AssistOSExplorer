import { getUserPersistoStore } from './storage/persisto-store.mjs';

export async function getAuditEvents(input = {}) {
  const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(500, Math.floor(input.limit))) : 100;
  const filter = {};
  if (input.targetType) filter.targetType = String(input.targetType);
  if (input.targetId) filter.targetId = String(input.targetId);
  const events = await getUserPersistoStore().select('auditEvent', filter, { limit: 1000 });
  return {
    events: events
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, limit)
  };
}
