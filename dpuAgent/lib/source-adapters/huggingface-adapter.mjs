import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { normalizeCapabilities, sanitizeProviderFacts } from './source-adapter.mjs';

const DEFAULT_ENDPOINT = 'https://huggingface.co';
const SMALL_SIZE_RANK = new Map([
  ['size_categories:n<1K', 0],
  ['size_categories:1K<n<10K', 1],
  ['size_categories:10K<n<100K', 2],
  ['size_categories:100K<n<1M', 3],
  ['size_categories:1M<n<10M', 4],
  ['size_categories:10M<n<100M', 5],
  ['size_categories:n>100M', 6]
]);
const QUERY_NOISE = new Set([
  'a', 'an', 'and', 'data', 'dataset', 'datasets', 'find', 'first', 'for', 'hugging', 'face',
  'match', 'one', 'return', 'search', 'small', 'text', 'the'
]);

function queryIntent(query = '') {
  const normalized = String(query).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const romanian = /\b(romanian|romana|romanesc|romaneste)\b/.test(normalized);
  const small = /\b(small|tiny|compact|mic|mica|mici)\b/.test(normalized);
  const text = /\b(text|texts|textual|corpus|corpora)\b/.test(normalized);
  const topic = normalized
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !QUERY_NOISE.has(token) && token !== 'romanian' && !token.startsWith('roman'))
    .join(' ');
  return { romanian, small, text, topic };
}

function sizeRank(tags = []) {
  for (const [tag, rank] of SMALL_SIZE_RANK) {
    if (tags.includes(tag)) return rank;
  }
  return Number.POSITIVE_INFINITY;
}

function hasTextModality(tags = []) {
  if (tags.includes('modality:text')) return true;
  if (tags.some((tag) => /^modality:(audio|image|video|tabular|time-series)$/.test(tag))) return false;
  return tags.some((tag) => (
    tag.startsWith('task_categories:')
    && !/(audio|image|video|speech|vision)/.test(tag)
  ));
}

function relevanceRank(item = {}, intent = {}) {
  const tags = Array.isArray(item.tags) ? item.tags.map(String) : [];
  const haystack = `${item.id || item.repoId || ''} ${tags.join(' ')}`.toLowerCase();
  const languagePenalty = intent.romanian && !tags.includes('language:ro') && !/romanian|romana/.test(haystack) ? 1 : 0;
  const textPenalty = intent.text && !hasTextModality(tags) ? 1 : 0;
  const smallness = intent.small ? sizeRank(tags) : 0;
  return [languagePenalty, textPenalty, smallness, String(item.id || item.repoId || '')];
}

function compareRank(left, right, intent) {
  const a = relevanceRank(left, intent);
  const b = relevanceRank(right, intent);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] < b[index]) return -1;
    if (a[index] > b[index]) return 1;
  }
  return 0;
}

function discoveryRequests(query, limit) {
  const intent = queryIntent(query);
  const poolLimit = String(Math.max(20, Math.min(100, (Number(limit) || 20) * 10)));
  const base = { limit: poolLimit, full: 'true' };
  const requests = [];
  if (intent.romanian) {
    requests.push(new URLSearchParams({ ...base, ...(intent.topic ? { search: intent.topic } : {}), filter: 'language:ro' }));
  }
  requests.push(new URLSearchParams({ ...base, search: String(query || '').trim() }));
  return { intent, requests };
}

function headersFor(token = '') {
  const headers = { Accept: 'application/json' };
  if (String(token || '').trim()) headers.Authorization = `Bearer ${String(token).trim()}`;
  return headers;
}

async function fetchJson(fetchImplementation, url, options = {}) {
  const response = await fetchImplementation(url, options);
  if (!response.ok) {
    const error = new Error(`Hugging Face request failed with status ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function normalizeDataset(item = {}, source = {}) {
  const repoId = String(item.id || item.repoId || '').trim();
  const revision = String(item.sha || item.revision || '').trim();
  const tags = Array.isArray(item.tags) ? item.tags.map(String) : [];
  const gated = Boolean(item.gated && item.gated !== 'false');
  const isPrivate = Boolean(item.private);
  return {
    externalId: repoId,
    persistentId: `hf://datasets/${repoId}`,
    name: repoId.split('/').pop() || repoId,
    resourceType: 'dataset',
    provider: 'huggingface',
    sourceId: source.id,
    version: revision,
    revision,
    licence: String(item.cardData?.license || item.license || tags.find((tag) => tag.startsWith('license:'))?.slice(8) || '').trim(),
    citation: String(item.cardData?.citation || '').trim(),
    executionMode: 'remote',
    accessState: gated || isPrivate ? 'pending' : 'available',
    accessConditions: {
      gated,
      gatedMode: gated ? String(item.gated) : '',
      private: isPrivate,
      requiresAuthentication: gated || isPrivate,
      termsUrl: repoId ? `https://huggingface.co/datasets/${repoId}` : ''
    },
    fair: {
      persistentIdentifier: `https://huggingface.co/datasets/${repoId}`,
      metadataAvailable: Boolean(repoId),
      licenceAvailable: Boolean(item.cardData?.license || item.license || tags.some((tag) => tag.startsWith('license:'))),
      machineReadableFormats: Array.isArray(item.siblings)
        ? [...new Set(item.siblings.map((entry) => path.extname(String(entry?.rfilename || '')).toLowerCase()).filter(Boolean))]
        : [],
      citationAvailable: Boolean(item.cardData?.citation)
    },
    providerFacts: sanitizeProviderFacts({
      downloads: item.downloads,
      likes: item.likes,
      lastModified: item.lastModified,
      tags,
      gated,
      private: isPrivate
    })
  };
}

function safeRelativePath(value) {
  const normalized = path.posix.normalize(String(value || '').replaceAll('\\', '/')).replace(/^\/+/, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error('Hugging Face file path is outside the materialization root.');
  }
  return normalized;
}

function expectedSha256(entry = {}) {
  const candidate = String(entry?.lfs?.oid || entry?.checksum || '').trim().toLowerCase();
  return candidate.startsWith('sha256:') ? candidate : '';
}

async function writeResponseToFile(response, targetPath, { expectedChecksum = '', signal, isCancelled } = {}) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const hash = createHash('sha256');
  let size = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      Promise.resolve(typeof isCancelled === 'function' ? isCancelled() : false).then((cancelled) => {
        if (cancelled || signal?.aborted) return callback(new Error('DPU acquisition was cancelled.'));
        size += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      }, callback);
    }
  });
  const input = response.body
    ? Readable.fromWeb(response.body)
    : Readable.from(Buffer.from(await response.arrayBuffer()));
  await pipeline(input, meter, (await import('node:fs')).createWriteStream(targetPath, { flags: 'wx' }));
  const checksum = `sha256:${hash.digest('hex')}`;
  if (expectedChecksum && checksum.toLowerCase() !== expectedChecksum.toLowerCase()) {
    await fs.rm(targetPath, { force: true });
    throw new Error(`Hugging Face checksum mismatch for ${path.basename(targetPath)}.`);
  }
  return {
    size,
    checksum
  };
}

export function createHuggingFaceAdapter({ fetchImplementation = globalThis.fetch } = {}) {
  if (typeof fetchImplementation !== 'function') throw new Error('Hugging Face adapter requires fetch.');
  return {
    getCapabilities() {
      return normalizeCapabilities(['search', 'metadata', 'download', 'access-request', 'provenance', 'citation']);
    },

    async testConnection({ source, credential = '' }) {
      const endpoint = String(source.endpoint || DEFAULT_ENDPOINT).replace(/\/$/, '');
      const response = await fetchImplementation(`${endpoint}/api/whoami-v2`, { headers: headersFor(credential) });
      if (response.ok) {
        const identity = await response.json();
        return { ok: true, authenticated: true, identity: String(identity?.name || identity?.fullname || '') };
      }
      if (!credential && response.status === 401) return { ok: true, authenticated: false, identity: '' };
      return { ok: false, authenticated: false, status: response.status };
    },

    async discover({ source, query, credential = '', limit = 20 }) {
      const endpoint = String(source.endpoint || DEFAULT_ENDPOINT).replace(/\/$/, '');
      const requestedLimit = Math.max(1, Math.min(100, Number(limit) || 20));
      const { intent, requests } = discoveryRequests(query, requestedLimit);
      const candidates = new Map();
      for (const params of requests) {
        const items = await fetchJson(fetchImplementation, `${endpoint}/api/datasets?${params}`, { headers: headersFor(credential) });
        for (const item of Array.isArray(items) ? items : []) {
          const repoId = String(item?.id || item?.repoId || '').trim();
          if (repoId && !candidates.has(repoId)) candidates.set(repoId, item);
        }
        if (candidates.size >= requestedLimit && intent.romanian) break;
      }
      return [...candidates.values()]
        .sort((left, right) => compareRank(left, right, intent))
        .slice(0, requestedLimit)
        .map((item) => normalizeDataset(item, source));
    },

    async describe({ source, externalId, revision = '', credential = '' }) {
      const endpoint = String(source.endpoint || DEFAULT_ENDPOINT).replace(/\/$/, '');
      const suffix = revision ? `/revision/${encodeURIComponent(revision)}` : '';
      const item = await fetchJson(fetchImplementation, `${endpoint}/api/datasets/${externalId}${suffix}`, { headers: headersFor(credential) });
      return normalizeDataset(item, source);
    },

    async resolveAccess({ source, resource, credential = '' }) {
      try {
        const endpoint = String(source.endpoint || DEFAULT_ENDPOINT).replace(/\/$/, '');
        const revision = resource.revision || 'main';
        const raw = await fetchJson(fetchImplementation, `${endpoint}/api/datasets/${resource.externalId}/revision/${encodeURIComponent(revision)}`, { headers: headersFor(credential) });
        const described = normalizeDataset(raw, source);
        if (described.accessState !== 'available') {
          if (!credential) return { accessState: 'pending', accessConditions: described.accessConditions, revision: described.revision };
          const probe = (Array.isArray(raw.siblings) ? raw.siblings : []).find((entry) => String(entry?.rfilename || '').trim());
          if (!probe) return { accessState: 'pending', accessConditions: described.accessConditions, revision: described.revision };
          const relativePath = safeRelativePath(probe.rfilename);
          const probeUrl = `${endpoint}/datasets/${resource.externalId}/resolve/${encodeURIComponent(described.revision || revision)}/${relativePath.split('/').map(encodeURIComponent).join('/')}`;
          const response = await fetchImplementation(probeUrl, { method: 'HEAD', headers: headersFor(credential), redirect: 'follow' });
          if (!response.ok) {
            if ([401, 403].includes(response.status)) return { accessState: 'pending', accessConditions: described.accessConditions, revision: described.revision };
            throw Object.assign(new Error(`Hugging Face access probe failed with status ${response.status}.`), { status: response.status });
          }
        }
        return {
          accessState: 'available',
          accessConditions: described.accessConditions,
          revision: described.revision
        };
      } catch (error) {
        if (error?.status === 401 || error?.status === 403) {
          return { accessState: 'pending', accessConditions: { requiresAuthentication: true, gated: true } };
        }
        if (error?.status === 404) return { accessState: 'blocked', reason: 'Dataset is unavailable.' };
        throw error;
      }
    },

    async acquire({ source, resource, credential = '', destinationRoot, allowPatterns = [], signal, isCancelled }) {
      const endpoint = String(source.endpoint || DEFAULT_ENDPOINT).replace(/\/$/, '');
      const access = await this.resolveAccess({ source, resource, credential });
      if (access.accessState !== 'available') throw new Error('Hugging Face dataset access is not available.');
      const raw = await fetchJson(fetchImplementation, `${endpoint}/api/datasets/${resource.externalId}/revision/${encodeURIComponent(access.revision || resource.revision || 'main')}`, { headers: headersFor(credential) });
      const described = normalizeDataset(raw, source);
      const siblings = Array.isArray(raw.siblings) ? raw.siblings : [];
      const patterns = (Array.isArray(allowPatterns) ? allowPatterns : []).map(String).filter(Boolean);
      const selected = siblings.filter((entry) => {
        const name = String(entry?.rfilename || '');
        return name && (!patterns.length || patterns.some((pattern) => name.includes(pattern)));
      });
      if (!selected.length) throw new Error('No Hugging Face dataset files matched the acquisition request.');
      const revision = String(raw.sha || described.revision || resource.revision || '').trim();
      const manifest = [];
      for (const entry of selected) {
        if (signal?.aborted || (typeof isCancelled === 'function' && await isCancelled())) {
          throw new Error('DPU acquisition was cancelled.');
        }
        const relativePath = safeRelativePath(entry.rfilename);
        const url = `${endpoint}/datasets/${resource.externalId}/resolve/${encodeURIComponent(revision)}/${relativePath.split('/').map(encodeURIComponent).join('/')}`;
        const response = await fetchImplementation(url, { headers: headersFor(credential), redirect: 'follow' });
        if (!response.ok) throw new Error(`Hugging Face download failed with status ${response.status}.`);
        const file = await writeResponseToFile(response, path.join(destinationRoot, relativePath), {
          expectedChecksum: expectedSha256(entry), signal, isCancelled
        });
        manifest.push({ path: relativePath, size: file.size, checksum: file.checksum });
      }
      return { revision, fileManifest: manifest, citation: described.citation, providerFacts: described.providerFacts };
    },

    getCitation({ resource }) {
      return String(resource?.citation || resource?.fair?.persistentIdentifier || '').trim();
    }
  };
}
