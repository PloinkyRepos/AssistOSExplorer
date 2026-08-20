import { normalizeCapabilities, sanitizeProviderFacts } from './source-adapter.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const DEFAULT_PATHS = Object.freeze({
  catalog: '/v3/catalog/request',
  negotiations: '/v3/contractnegotiations',
  transfers: '/v3/transferprocesses'
});

function headersFor(credential = '') {
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (String(credential || '').trim()) headers['X-Api-Key'] = String(credential).trim();
  return headers;
}

async function requestJson(fetchImplementation, url, options = {}) {
  const response = await fetchImplementation(url, options);
  if (!response.ok) throw new Error(`EDC request failed with status ${response.status}.`);
  if (response.status === 204) return {};
  return response.json();
}

function collectDatasets(catalog = {}) {
  const datasets = catalog['dcat:dataset'] || catalog.dataset || [];
  return Array.isArray(datasets) ? datasets : [datasets].filter(Boolean);
}

function normalizeOffer(dataset = {}, source = {}) {
  const id = String(dataset['@id'] || dataset.id || '').trim();
  const distributions = dataset['dcat:distribution'] || dataset.distribution || [];
  const policy = dataset['odrl:hasPolicy'] || dataset.policy || null;
  return {
    externalId: id,
    persistentId: String(dataset['dct:identifier'] || id).trim(),
    name: String(dataset['dct:title'] || dataset.name || id).trim(),
    resourceType: 'dataset',
    provider: 'edc',
    sourceId: source.id,
    version: String(dataset['dct:hasVersion'] || dataset.version || '').trim(),
    revision: String(dataset['dct:hasVersion'] || dataset.version || '').trim(),
    licence: String(dataset['dct:license'] || '').trim(),
    citation: String(dataset['dct:identifier'] || '').trim(),
    executionMode: 'remote',
    accessState: policy ? 'pending' : 'available',
    accessConditions: { policy: sanitizeProviderFacts(policy) },
    fair: {
      persistentIdentifier: String(dataset['dct:identifier'] || id).trim(),
      metadataAvailable: true,
      licenceAvailable: Boolean(dataset['dct:license']),
      machineReadableFormats: [],
      citationAvailable: Boolean(dataset['dct:identifier'])
    },
    providerFacts: sanitizeProviderFacts({ distributions, policy, rawId: id })
  };
}

export function createEdcAdapter({ fetchImplementation = globalThis.fetch } = {}) {
  if (typeof fetchImplementation !== 'function') throw new Error('EDC adapter requires fetch.');
  return {
    getCapabilities() {
      return normalizeCapabilities(['search', 'metadata', 'download', 'access-request', 'remote-processing', 'provenance', 'citation']);
    },

    async testConnection({ source, credential = '' }) {
      const endpoint = String(source.endpoint || '').replace(/\/$/, '');
      if (!endpoint) throw new Error('EDC source endpoint is required.');
      const path = source.settings?.catalogPath || DEFAULT_PATHS.catalog;
      const body = {
        '@context': { '@vocab': 'https://w3id.org/edc/v0.0.1/ns/' },
        counterPartyAddress: source.settings?.counterPartyAddress || endpoint,
        protocol: source.settings?.protocol || 'dataspace-protocol-http',
        querySpec: { offset: 0, limit: 1 }
      };
      await requestJson(fetchImplementation, `${endpoint}${path}`, { method: 'POST', headers: headersFor(credential), body: JSON.stringify(body) });
      return { ok: true, identity: String(source.settings?.participantId || '') };
    },

    async discover({ source, query = '', credential = '', limit = 20 }) {
      const endpoint = String(source.endpoint || '').replace(/\/$/, '');
      const path = source.settings?.catalogPath || DEFAULT_PATHS.catalog;
      const body = {
        '@context': { '@vocab': 'https://w3id.org/edc/v0.0.1/ns/' },
        counterPartyAddress: source.settings?.counterPartyAddress || endpoint,
        protocol: source.settings?.protocol || 'dataspace-protocol-http',
        querySpec: {
          offset: 0,
          limit: Math.max(1, Math.min(100, Number(limit) || 20)),
          filterExpression: query ? [{ operandLeft: 'https://purl.org/dc/terms/title', operator: 'like', operandRight: `%${query}%` }] : []
        }
      };
      const catalog = await requestJson(fetchImplementation, `${endpoint}${path}`, { method: 'POST', headers: headersFor(credential), body: JSON.stringify(body) });
      return collectDatasets(catalog).map((dataset) => normalizeOffer(dataset, source));
    },

    async describe({ source, externalId, credential = '' }) {
      const results = await this.discover({ source, query: '', credential, limit: 100 });
      const resource = results.find((item) => item.externalId === externalId);
      if (!resource) throw new Error('EDC asset was not found in the current catalog.');
      return resource;
    },

    async resolveAccess({ resource }) {
      return {
        accessState: resource.accessConditions?.policy ? 'pending' : 'available',
        accessConditions: sanitizeProviderFacts(resource.accessConditions || {})
      };
    },

    async requestAccess({ source, resource, credential = '', callbackAddresses }) {
      const endpoint = String(source.endpoint || '').replace(/\/$/, '');
      const path = source.settings?.negotiationsPath || DEFAULT_PATHS.negotiations;
      const offer = resource.providerFacts?.policy || resource.accessConditions?.policy;
      if (!offer) throw new Error('EDC resource does not contain a contract offer.');
      const policy = {
        ...offer,
        target: offer.target || resource.externalId,
        ...(source.settings?.providerId && !offer.assigner ? { assigner: source.settings.providerId } : {})
      };
      const payload = {
        '@context': { '@vocab': 'https://w3id.org/edc/v0.0.1/ns/' },
        counterPartyAddress: source.settings?.counterPartyAddress || endpoint,
        ...(source.settings?.providerId ? { counterPartyId: source.settings.providerId } : {}),
        protocol: source.settings?.protocol || 'dataspace-protocol-http',
        policy,
        callbackAddresses: Array.isArray(callbackAddresses) ? callbackAddresses : (Array.isArray(source.settings?.callbackAddresses) ? source.settings.callbackAddresses : [])
      };
      return requestJson(fetchImplementation, `${endpoint}${path}`, { method: 'POST', headers: headersFor(credential), body: JSON.stringify(payload) });
    },

    async acquire({ source, resource, credential = '', destinationRoot }) {
      const endpoint = String(source.endpoint || '').replace(/\/$/, '');
      const path = source.settings?.transfersPath || DEFAULT_PATHS.transfers;
      const contractId = String(resource.providerFacts?.contractAgreementId || '').trim();
      if (!contractId) throw new Error('EDC contract agreement is required before transfer.');
      const payload = {
        '@context': { '@vocab': 'https://w3id.org/edc/v0.0.1/ns/' },
        counterPartyAddress: source.settings?.counterPartyAddress || endpoint,
        ...(source.settings?.providerId ? { counterPartyId: source.settings.providerId } : {}),
        contractId,
        assetId: resource.externalId,
        protocol: source.settings?.protocol || 'dataspace-protocol-http',
        transferType: source.settings?.transferType || 'HttpData-PULL',
        dataDestination: { type: 'File', path: destinationRoot }
      };
      const transfer = await requestJson(fetchImplementation, `${endpoint}${path}`, { method: 'POST', headers: headersFor(credential), body: JSON.stringify(payload) });
      return { remoteOperation: transfer, revision: resource.revision, fileManifest: [] };
    },

    async getOperation({ source, operationId, credential = '', operationType = 'transfer' }) {
      const endpoint = String(source.endpoint || '').replace(/\/$/, '');
      const base = operationType === 'negotiation'
        ? (source.settings?.negotiationsPath || DEFAULT_PATHS.negotiations)
        : (source.settings?.transfersPath || DEFAULT_PATHS.transfers);
      return requestJson(fetchImplementation, `${endpoint}${base}/${encodeURIComponent(operationId)}`, { headers: headersFor(credential) });
    },

    async cancelOperation({ source, operationId, credential = '', operationType = 'transfer' }) {
      const endpoint = String(source.endpoint || '').replace(/\/$/, '');
      const base = operationType === 'negotiation'
        ? (source.settings?.negotiationsPath || DEFAULT_PATHS.negotiations)
        : (source.settings?.transfersPath || DEFAULT_PATHS.transfers);
      return requestJson(fetchImplementation, `${endpoint}${base}/${encodeURIComponent(operationId)}/terminate`, { method: 'POST', headers: headersFor(credential), body: '{}' });
    },

    async materializeCompletedTransfer({ remoteStatus, destinationRoot, isCancelled }) {
      const address = remoteStatus?.dataAddress || remoteStatus?.dataDestination || remoteStatus?.transferData || null;
      const endpoint = String(address?.endpoint || address?.properties?.endpoint || '').trim();
      if (!endpoint) return null;
      const parsed = new URL(endpoint);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error('EDC data-plane endpoint must be an HTTP(S) URL without embedded credentials.');
      }
      const rawName = String(address?.fileName || address?.properties?.fileName || 'edc-transfer.bin').replaceAll('\\', '/');
      const fileName = path.posix.basename(rawName);
      if (!fileName || fileName === '.' || fileName === '..') throw new Error('EDC data-plane filename is invalid.');
      const token = String(address?.authorization || address?.properties?.authorization || '').trim();
      const response = await fetchImplementation(endpoint, {
        headers: token ? { Authorization: token } : {},
        redirect: 'follow'
      });
      if (!response.ok) throw new Error(`EDC data-plane download failed with status ${response.status}.`);
      await fs.mkdir(destinationRoot, { recursive: true });
      const target = path.join(destinationRoot, fileName);
      const hash = createHash('sha256');
      let size = 0;
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          Promise.resolve(typeof isCancelled === 'function' ? isCancelled() : false).then((cancelled) => {
            if (cancelled) return callback(new Error('DPU transfer materialization was cancelled.'));
            size += chunk.length;
            hash.update(chunk);
            callback(null, chunk);
          }, callback);
        }
      });
      const input = response.body ? Readable.fromWeb(response.body) : Readable.from(Buffer.from(await response.arrayBuffer()));
      await pipeline(input, meter, (await import('node:fs')).createWriteStream(target, { flags: 'wx' }));
      return {
        revision: String(remoteStatus?.revision || '').trim(),
        fileManifest: [{ path: fileName, size, checksum: `sha256:${hash.digest('hex')}` }]
      };
    },

    getCitation({ resource }) {
      return String(resource?.citation || resource?.persistentId || '').trim();
    }
  };
}
