import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bridgePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'nvflare_bridge.py');
const ALLOWED_OPERATIONS = new Set(['test', 'submit', 'get', 'cancel']);

function required(value, name) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${name} is required.`);
  return text;
}

function parseCredential(value) {
  let parsed;
  try { parsed = JSON.parse(String(value || '')); } catch { throw new Error('NVFlare secret must contain a JSON configuration object.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('NVFlare secret must contain a JSON configuration object.');
  return {
    username: required(parsed.username, 'NVFlare username'),
    startupKitPath: path.resolve(required(parsed.startupKitPath, 'NVFlare startupKitPath')),
    templatesRoot: path.resolve(required(parsed.templatesRoot, 'NVFlare templatesRoot')),
    study: String(parsed.study || 'default').trim() || 'default'
  };
}

function resolveTemplate(settings, credential, templateId) {
  const normalizedId = required(templateId, 'templateId');
  const catalog = settings?.templateCatalog && typeof settings.templateCatalog === 'object'
    ? settings.templateCatalog
    : {};
  const relativeTemplate = required(catalog[normalizedId], `NVFlare template ${normalizedId}`);
  const target = path.resolve(credential.templatesRoot, relativeTemplate);
  const relative = path.relative(credential.templatesRoot, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('NVFlare job template must stay inside templatesRoot.');
  }
  return target;
}

export function runNvFlareBridge(payload, {
  pythonBin = process.env.DPU_NVFLARE_PYTHON || 'python3',
  timeoutMs = 30_000
} = {}) {
  if (!ALLOWED_OPERATIONS.has(payload?.operation)) throw new Error('Unsupported NVFlare bridge operation.');
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, [bridgePath], { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`NVFlare bridge could not start: ${error?.code || 'spawn_failed'}.`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      let result;
      try { result = JSON.parse(stdout.trim()); } catch { result = null; }
      if (code !== 0 || !result?.ok) {
        reject(new Error(String(result?.error || (stderr ? 'NVFlare bridge failed.' : 'NVFlare bridge returned an invalid response.'))));
        return;
      }
      resolve(result);
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export function createNvFlareBackend({ runBridge = runNvFlareBridge } = {}) {
  return {
    type: 'nvflare',
    capabilities: ['federated-learning', 'fedavg', 'fedprox', 'scaffold', 'cancel', 'result-download'],
    async test({ backend, secretValue }) {
      const credential = parseCredential(secretValue);
      const result = await runBridge({ operation: 'test', credential });
      return { ok: true, identity: String(result.identity || credential.username), version: String(result.version || '') };
    },
    async submit({ backend, secretValue, experiment, submitToken }) {
      const credential = parseCredential(secretValue);
      const jobPath = resolveTemplate(backend.settings, credential, experiment.templateId);
      return runBridge({ operation: 'submit', credential, jobPath, submitToken: required(submitToken, 'submitToken') });
    },
    async get({ secretValue, externalJobId }) {
      return runBridge({ operation: 'get', credential: parseCredential(secretValue), externalJobId: required(externalJobId, 'externalJobId') });
    },
    async cancel({ secretValue, externalJobId }) {
      return runBridge({ operation: 'cancel', credential: parseCredential(secretValue), externalJobId: required(externalJobId, 'externalJobId') });
    }
  };
}
