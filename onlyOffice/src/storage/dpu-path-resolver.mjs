import {
  DPU_MY_SPACE_PATH,
  DPU_SHARED_PATH,
  normalizeDpuPath,
  splitDpuPath,
} from './dpu-paths.mjs';

function normalizeSharedEntryName(item) {
  return String(item?.name || '').trim();
}

export function annotateSharedEntries(items = []) {
  const list = Array.isArray(items) ? items : [];
  const counts = new Map();
  for (const item of list) {
    const name = normalizeSharedEntryName(item);
    if (!name) {
      continue;
    }
    counts.set(name, (counts.get(name) || 0) + 1);
  }

  const usedNames = new Set();
  return list.map((item) => {
    const name = normalizeSharedEntryName(item);
    const ownerId = String(item?.ownerId || '').trim();
    let virtualName = name;
    if (name && (counts.get(name) || 0) > 1) {
      virtualName = `${name} (${ownerId || 'shared'})`;
    }
    if (virtualName && usedNames.has(virtualName)) {
      virtualName = `${virtualName} [${String(item?.id || '').trim().slice(0, 8) || 'item'}]`;
    }
    if (virtualName) {
      usedNames.add(virtualName);
    }
    return {
      ...item,
      virtualName: virtualName || name,
    };
  });
}

export async function resolveDpuConfidentialNodeAtPath(path, {
  getRoots,
  listConfidential,
} = {}) {
  if (typeof getRoots !== 'function' || typeof listConfidential !== 'function') {
    throw new Error('DPU path resolver requires getRoots and listConfidential functions.');
  }

  const normalizedPath = normalizeDpuPath(path);

  if (normalizedPath.startsWith(`${DPU_MY_SPACE_PATH}/`)) {
    const roots = await getRoots();
    let currentId = roots?.mySpace?.id || '';
    if (!currentId) {
      return null;
    }
    let current = null;
    for (const segment of splitDpuPath(normalizedPath).slice(2)) {
      const listing = await listConfidential({
        scope: 'my-space',
        parentId: currentId,
      });
      current = Array.isArray(listing?.items)
        ? listing.items.find((item) => item?.name === segment)
        : null;
      if (!current) {
        return null;
      }
      currentId = current.id;
    }
    return current;
  }

  if (normalizedPath.startsWith(`${DPU_SHARED_PATH}/`)) {
    const segments = splitDpuPath(normalizedPath);
    if (segments.length < 3) {
      return null;
    }
    const sharedRoots = await listConfidential({ scope: 'shared' });
    const topLevel = annotateSharedEntries(sharedRoots?.items);
    let current = topLevel.find((item) => item?.virtualName === segments[2]) || null;
    if (!current) {
      return null;
    }
    let currentId = current.id;
    for (const segment of segments.slice(3)) {
      const listing = await listConfidential({
        scope: 'my-space',
        parentId: currentId,
      });
      current = Array.isArray(listing?.items)
        ? listing.items.find((item) => item?.name === segment)
        : null;
      if (!current) {
        return null;
      }
      currentId = current.id;
    }
    return current;
  }

  return null;
}
