export function getRequestedRoots(argv, env) {
  const args = [...(argv || [])];
  const envRoots = (env?.ASSISTOS_FS_ROOT || env?.MCP_FS_ROOT || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  if (envRoots.length) {
    return envRoots;
  }
  if (args.length) {
    return args;
  }
  const workspaceRoot = String(env?.PLOINKY_WORKSPACE_ROOT || '').trim();
  if (workspaceRoot) {
    return [workspaceRoot];
  }
  return [process.cwd()];
}

export async function resolveAllowedDirectories(inputDirs, { expandHome, normalizePath, fs, path }) {
  const results = await Promise.all(inputDirs.map(async (dir) => {
    const expanded = expandHome(dir);
    const absolute = path.resolve(expanded);
    try {
      const resolved = await fs.realpath(absolute);
      return normalizePath(resolved);
    } catch {
      return normalizePath(absolute);
    }
  }));

  const validated = [];
  for (const dir of results) {
    try {
      const stats = await fs.stat(dir);
      if (!stats.isDirectory()) {
        console.error(`[filesystem-http] Skipping ${dir} (not a directory)`);
        continue;
      }
      validated.push(dir);
    } catch (error) {
      console.error(`[filesystem-http] Error accessing directory ${dir}:`, error?.message || error);
    }
  }
  if (!validated.length) {
    const fallback = path.resolve(process.cwd());
    console.error(`[filesystem-http] No valid directories supplied, falling back to ${fallback}`);
    validated.push(fallback);
  }
  return validated;
}
