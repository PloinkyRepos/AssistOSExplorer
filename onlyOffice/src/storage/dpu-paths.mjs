export const DPU_ROOT_PATH = '/Confidential';
export const DPU_MY_SPACE_PATH = '/Confidential/My Space';
export const DPU_SHARED_PATH = '/Confidential/Shared';
export const DPU_SECRETS_PATH = '/Confidential/Secrets';

export function normalizeDpuPath(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed === '/') {
    return '/';
  }
  return `/${trimmed.replace(/^\/+/, '').replace(/\/+/g, '/')}`.replace(/\/$/, '');
}

export function splitDpuPath(path) {
  return normalizeDpuPath(path).split('/').filter(Boolean);
}

export function isDpuVirtualPath(path) {
  const normalized = normalizeDpuPath(path);
  return normalized === DPU_ROOT_PATH || normalized.startsWith(`${DPU_ROOT_PATH}/`);
}

export function isDpuSecretPath(path) {
  const normalized = normalizeDpuPath(path);
  return normalized === DPU_SECRETS_PATH || normalized.startsWith(`${DPU_SECRETS_PATH}/`);
}
