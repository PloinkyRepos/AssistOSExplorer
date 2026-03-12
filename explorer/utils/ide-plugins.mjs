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
const VALID_PLUGIN_TYPES = new Set(['embedded', 'modal']);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizePluginDependencies(rawDependencies, configPath) {
  if (rawDependencies === undefined) {
    return [];
  }
  if (!Array.isArray(rawDependencies)) {
    console.warn(`[filesystem-http] Invalid dependencies in ${configPath}: expected an array.`);
    return null;
  }

  const normalized = [];
  for (const dependency of rawDependencies) {
    if (!dependency || typeof dependency !== 'object' || Array.isArray(dependency)) {
      console.warn(`[filesystem-http] Invalid dependency entry in ${configPath}: expected an object.`);
      return null;
    }

    const dependencyName = isNonEmptyString(dependency.component)
      ? dependency.component.trim()
      : isNonEmptyString(dependency.name)
        ? dependency.name.trim()
        : '';

    if (!dependencyName) {
      console.warn(`[filesystem-http] Invalid dependency entry in ${configPath}: missing "component" or "name".`);
      return null;
    }

    const normalizedDependency = {
      ...dependency,
      component: dependencyName
    };

    if (normalizedDependency.name === undefined) {
      normalizedDependency.name = dependencyName;
    }

    if (normalizedDependency.presenter !== undefined && !isNonEmptyString(normalizedDependency.presenter)) {
      console.warn(`[filesystem-http] Invalid dependency presenter for "${dependencyName}" in ${configPath}.`);
      return null;
    }

    if (normalizedDependency.path !== undefined && !isNonEmptyString(normalizedDependency.path)) {
      console.warn(`[filesystem-http] Invalid dependency path for "${dependencyName}" in ${configPath}.`);
      return null;
    }

    if (normalizedDependency.directory !== undefined && !isNonEmptyString(normalizedDependency.directory)) {
      console.warn(`[filesystem-http] Invalid dependency directory for "${dependencyName}" in ${configPath}.`);
      return null;
    }

    if (normalizedDependency.type !== undefined && !VALID_PLUGIN_TYPES.has(normalizedDependency.type)) {
      console.warn(`[filesystem-http] Invalid dependency type for "${dependencyName}" in ${configPath}: ${normalizedDependency.type}`);
      return null;
    }

    normalized.push(normalizedDependency);
  }

  return normalized;
}

function validateAndNormalizePluginConfig(parsedConfig, pluginEntryName, configPath) {
  if (!parsedConfig || typeof parsedConfig !== 'object' || Array.isArray(parsedConfig)) {
    console.warn(`[filesystem-http] Invalid plugin config in ${configPath}: expected an object.`);
    return null;
  }

  const locationsRaw = parsedConfig.location;
  const locations = Array.isArray(locationsRaw)
    ? locationsRaw.map((loc) => (typeof loc === 'string' ? loc.trim() : '')).filter(Boolean)
    : typeof locationsRaw === 'string' && locationsRaw.trim()
      ? [locationsRaw.trim()]
      : [];

  if (!locations.length) {
    console.warn(`[filesystem-http] Plugin ${configPath} does not specify a valid location; skipping.`);
    return null;
  }

  const invalidLocations = locations.filter((location) => !DEFAULT_PLUGIN_LOCATIONS.includes(location));
  if (invalidLocations.length > 0) {
    console.warn(`[filesystem-http] Plugin ${configPath} has unsupported locations: ${invalidLocations.join(', ')}`);
    return null;
  }

  const component = isNonEmptyString(parsedConfig.component) ? parsedConfig.component.trim() : pluginEntryName;
  if (!component) {
    console.warn(`[filesystem-http] Plugin ${configPath} is missing a valid component name.`);
    return null;
  }

  if (parsedConfig.presenter !== undefined && !isNonEmptyString(parsedConfig.presenter)) {
    console.warn(`[filesystem-http] Plugin ${configPath} has an invalid presenter.`);
    return null;
  }

  if (parsedConfig.tooltip !== undefined && !isNonEmptyString(parsedConfig.tooltip)) {
    console.warn(`[filesystem-http] Plugin ${configPath} has an invalid tooltip.`);
    return null;
  }

  if (parsedConfig.icon !== undefined && !isNonEmptyString(parsedConfig.icon)) {
    console.warn(`[filesystem-http] Plugin ${configPath} has an invalid icon path.`);
    return null;
  }

  if (parsedConfig.iconPresenter !== undefined && !isNonEmptyString(parsedConfig.iconPresenter)) {
    console.warn(`[filesystem-http] Plugin ${configPath} has an invalid iconPresenter.`);
    return null;
  }

  if (parsedConfig.iconComponent !== undefined && !isNonEmptyString(parsedConfig.iconComponent)) {
    console.warn(`[filesystem-http] Plugin ${configPath} has an invalid iconComponent.`);
    return null;
  }

  if (parsedConfig.type !== undefined && !VALID_PLUGIN_TYPES.has(parsedConfig.type)) {
    console.warn(`[filesystem-http] Plugin ${configPath} has an invalid type "${parsedConfig.type}".`);
    return null;
  }

  if (parsedConfig.autoPin !== undefined && typeof parsedConfig.autoPin !== 'boolean') {
    console.warn(`[filesystem-http] Plugin ${configPath} has a non-boolean autoPin value.`);
    return null;
  }

  const dependencies = normalizePluginDependencies(parsedConfig.dependencies, configPath);
  if (dependencies === null) {
    return null;
  }

  return {
    locations: [...new Set(locations)],
    pluginConfig: {
      ...parsedConfig,
      component,
      dependencies
    }
  };
}

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
        if (error && typeof error === 'object' && error.code === 'ENOENT') {
          continue;
        }
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

      const normalizedConfig = validateAndNormalizePluginConfig(parsedConfig, pluginEntry.name, configPath);
      if (!normalizedConfig) {
        continue;
      }

      const {
        locations,
        pluginConfig
      } = normalizedConfig;
      const { location, ...pluginConfigWithoutLocation } = pluginConfig;
      const finalPluginConfig = pluginConfigWithoutLocation;
      finalPluginConfig.agent = agentName;

      for (const loc of locations) {
        if (!loc) continue;
        const bucket = ensureBucket(loc);
        bucket.push({ ...finalPluginConfig });
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
