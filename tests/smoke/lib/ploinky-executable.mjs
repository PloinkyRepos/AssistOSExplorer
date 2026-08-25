import path from 'node:path';

export function resolvePloinkyExecutable({
  deploymentMode = String(process.env.SMOKE_DEPLOYMENT_MODE || '').trim(),
  configured = String(process.env.SMOKE_PLOINKY_BIN || '').trim(),
} = {}) {
  if (deploymentMode === 'box') {
    if (!configured) {
      throw new Error(
        'Box-mode targeted restarts require SMOKE_PLOINKY_BIN to name the exact mounted Ploinky candidate binary.',
      );
    }
    if (!path.isAbsolute(configured)) {
      throw new Error('SMOKE_PLOINKY_BIN must be an absolute path for Box-mode targeted restarts.');
    }
  }
  return configured || 'ploinky';
}
