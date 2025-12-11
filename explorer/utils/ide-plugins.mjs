import fs from 'node:fs/promises';
import path from 'node:path';

export const SKIP_DIRECTORY_NAMES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.idea',
  '.vscode',
  'node_modules',
  'dist',
  'build',
  'out',
  '.turbo',
  '.parcel-cache',
  '.cache',
  '.mcp-cache',
  'coverage',
  'tmp'
]);

export const DEFAULT_PLUGIN_LOCATIONS = ['document', 'chapter', 'paragraph', 'infoText'];

export async function aggregateIdePlugins(rootDir) {
  if (!rootDir) throw new Error('Workspace root not configured.');

  const aggregated = Object.create(null);
  const visitedAgents = new Set();
  let pluginCount = 0;

  const ensureBucket = (location) => {
    if (!aggregated[location]) {
      aggregated[location] = [];
    }
    return aggregated[location];
  };

  for (const location of DEFAULT_PLUGIN_LOCATIONS) {
    ensureBucket(location);
  }

  const candidateDirsProcessed = new Set();

  const processAgentDirectory = async (agentName, agentDir) => {
    if (!agentName || SKIP_DIRECTORY_NAMES.has(agentName)) {
      return;
    }

    const idePluginsDir = path.join(agentDir, 'IDE-plugins');

    let ideStat;
    try {
      ideStat = await fs.stat(idePluginsDir);
    } catch {
      return;
    }

    if (!ideStat.isDirectory()) {
      return;
    }

    if (visitedAgents.has(agentName)) {
      return;
    }
    visitedAgents.add(agentName);

    let pluginEntries;
    try {
      pluginEntries = await fs.readdir(idePluginsDir, { withFileTypes: true });
    } catch (error) {
      console.warn(`[filesystem-http] Unable to read IDE-plugins directory ${idePluginsDir}:`, error instanceof Error ? error.message : String(error));
      return;
    }

    for (const pluginEntry of pluginEntries) {
      if (!pluginEntry.isDirectory()) continue;
      const pluginDir = path.join(idePluginsDir, pluginEntry.name);
      const configPath = path.join(pluginDir, 'config.json');

      let rawConfig;
      try {
        rawConfig = await fs.readFile(configPath, 'utf8');
      } catch (error) {
        console.warn(`[filesystem-http] Skipping plugin ${pluginDir}: unable to read config.json (${error instanceof Error ? error.message : String(error)})`);
        continue;
      }

      let parsedConfig;
      try {
        parsedConfig = JSON.parse(rawConfig);
      } catch (error) {
        console.warn(`[filesystem-http] Invalid JSON in ${configPath}:`, error instanceof Error ? error.message : String(error));
        continue;
      }

      const locationsRaw = parsedConfig.location;
      const locations = Array.isArray(locationsRaw)
        ? locationsRaw.map((loc) => (typeof loc === 'string' ? loc.trim() : '')).filter(Boolean)
        : typeof locationsRaw === 'string' && locationsRaw.trim()
          ? [locationsRaw.trim()]
          : [];

      if (!locations.length) {
        console.warn(`[filesystem-http] Plugin ${pluginDir} does not specify a valid location; skipping.`);
        continue;
      }

      const { location, ...pluginConfig } = parsedConfig;
      if (!pluginConfig.component) {
        pluginConfig.component = pluginEntry.name;
      }
      pluginConfig.agent = agentName;

      for (const loc of new Set(locations)) {
        if (!loc) continue;
        const bucket = ensureBucket(loc);
        bucket.push({ ...pluginConfig });
        pluginCount += 1;
      }
    }
  };

  const scanAgentDirectories = async (baseDir) => {
    if (!baseDir || candidateDirsProcessed.has(baseDir)) {
      return;
    }
    candidateDirsProcessed.add(baseDir);

    let entries;
    try {
      entries = await fs.readdir(baseDir, { withFileTypes: true });
    } catch (error) {
      console.warn(`[filesystem-http] Unable to read agent base directory ${baseDir}:`, error instanceof Error ? error.message : String(error));
      return;
    }

    await processAgentDirectory(path.basename(baseDir), baseDir);

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRECTORY_NAMES.has(entry.name)) continue;
      await processAgentDirectory(entry.name, path.join(baseDir, entry.name));
    }
  };

  const addRepoCollections = async (baseDir) => {
    if (!baseDir) return;

    const repoRoot = path.join(baseDir, '.ploinky', 'repos');
    let repoEntries;
    try {
      const repoStat = await fs.stat(repoRoot);
      if (!repoStat.isDirectory()) {
        return;
      }
      repoEntries = await fs.readdir(repoRoot, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of repoEntries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRECTORY_NAMES.has(entry.name)) continue;
      await scanAgentDirectories(path.join(repoRoot, entry.name));
    }
  };

  await scanAgentDirectories(rootDir);
  await addRepoCollections(rootDir);

  if (pluginCount === 0) {
    const parentDir = path.dirname(rootDir);
    if (parentDir && parentDir !== rootDir) {
      await scanAgentDirectories(parentDir);
      await addRepoCollections(parentDir);
    }
  }

  for (const [location, plugins] of Object.entries(aggregated)) {
    plugins.sort((a, b) => {
      const aKey = (a?.component || '').toLowerCase();
      const bKey = (b?.component || '').toLowerCase();
      return aKey.localeCompare(bKey);
    });
  }

  return aggregated;
}
