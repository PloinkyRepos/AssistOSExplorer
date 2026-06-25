import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import defaultFs from 'node:fs/promises';
import defaultPath from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = defaultPath.dirname(__filename);
const EXPLORER_ROOT = defaultPath.resolve(__dirname, '..', '..', '..');

async function pathExists(fs, targetPath) {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveAxiFaceRepoRoot({ fs, path, workspaceRoot, env = process.env } = {}) {
  const fsApi = fs || defaultFs;
  const pathApi = path || defaultPath;
  const candidates = [
    env.AXIFACE_REPO_PATH,
    pathApi.join(EXPLORER_ROOT, 'shared', 'vendor', 'axi-face')
  ].filter(Boolean);

  for (const candidate of candidates) {
    const root = pathApi.resolve(candidate);
    if (await pathExists(fsApi, pathApi.join(root, 'src', 'axi-face.mjs'))) {
      return root;
    }
  }
  throw new Error('AxiFace asset repository is unavailable. Configure AXIFACE_REPO_PATH or run Explorer preinstall.');
}

export async function importAxiFaceAssetLoader(options = {}) {
  const pathApi = options.path || defaultPath;
  const root = await resolveAxiFaceRepoRoot(options);
  return import(pathToFileURL(pathApi.join(root, 'src', 'asset-loader.mjs')).href);
}
