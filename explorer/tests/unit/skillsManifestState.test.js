import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createToolHandlers } from '../../utils/server/tool-handlers.mjs';

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

function parseJsonResponse(response) {
  return JSON.parse(response.content.find((entry) => entry.type === 'text').text);
}

function objectSchema(requiredKeys) {
  return {
    safeParse(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { success: false, error: 'Expected object.' };
      }
      for (const key of requiredKeys) {
        if (typeof value[key] !== 'string') {
          return { success: false, error: `Expected string property ${key}.` };
        }
      }
      return { success: true, data: value };
    }
  };
}

function createMinimalSchemas() {
  const AnyObjectSchema = { safeParse: (value) => ({ success: true, data: value || {} }) };
  return {
    ReadTextFileArgsSchema: AnyObjectSchema,
    ReadMediaFileArgsSchema: AnyObjectSchema,
    ReadMultipleFilesArgsSchema: AnyObjectSchema,
    WriteFileArgsSchema: AnyObjectSchema,
    WriteBinaryFileArgsSchema: AnyObjectSchema,
    EditFileArgsSchema: AnyObjectSchema,
    CreateDirectoryArgsSchema: AnyObjectSchema,
    DeleteFileArgsSchema: AnyObjectSchema,
    DeleteDirectoryArgsSchema: AnyObjectSchema,
    ListDirectoryArgsSchema: AnyObjectSchema,
    ListDirectoryWithSizesArgsSchema: AnyObjectSchema,
    ListDirectoryDetailedArgsSchema: AnyObjectSchema,
    DirectoryTreeArgsSchema: AnyObjectSchema,
    MoveFileArgsSchema: AnyObjectSchema,
    CopyFileArgsSchema: AnyObjectSchema,
    SearchFilesArgsSchema: AnyObjectSchema,
    SearchTextArgsSchema: AnyObjectSchema,
    SearchTextStatusArgsSchema: AnyObjectSchema,
    SearchTextCancelArgsSchema: AnyObjectSchema,
    ReplaceTextArgsSchema: AnyObjectSchema,
    GetFileInfoArgsSchema: AnyObjectSchema,
    CollectIDEPluginsArgsSchema: AnyObjectSchema,
    GetPluginSettingsArgsSchema: AnyObjectSchema,
    SetPluginEnabledArgsSchema: AnyObjectSchema,
    ListSkillsArgsSchema: AnyObjectSchema,
    ReadSkillsManifestStateArgsSchema: objectSchema(['folderPath']),
    AddSkillsManifestRepoArgsSchema: AnyObjectSchema,
    SetSkillsManifestSkillEnabledArgsSchema: AnyObjectSchema,
    RemoveSkillsManifestRepoArgsSchema: AnyObjectSchema
  };
}

async function createLocalSkillRepo(rootDir) {
  const repoDir = path.join(rootDir, 'source-skill-repo');
  await writeFile(path.join(repoDir, 'skills', 'alpha-skill', 'SKILL.md'), '---\nname: alpha-skill\n---\n');
  execFileSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: repoDir, stdio: 'ignore' });
  return repoDir;
}

async function createNonAnthropicSkillRepo(rootDir) {
  const repoDir = path.join(rootDir, 'source-code-skill-repo');
  await writeFile(path.join(repoDir, 'skills', 'code-skill', 'cskill.md'), '# code-skill\n');
  execFileSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: repoDir, stdio: 'ignore' });
  return repoDir;
}

async function createAchillesCopilotBasicSkillsRepo(rootDir) {
  const repoDir = path.join(rootDir, 'source-AchillesCopilotBasicSkills');
  const skills = [
    'achilles-specs',
    'antropic-skill-build',
    'article-build',
    'create-akus',
    'cskill-build',
    'dgskill-build',
    'gamp-specs',
    'manage-ploinky-agents',
    'oskill-build',
    'review-specs'
  ];
  for (const skill of skills) {
    await writeFile(path.join(repoDir, 'skills', skill, 'SKILL.md'), `---\nname: ${skill}\n---\n`);
  }
  execFileSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: repoDir, stdio: 'ignore' });
  return { repoDir, skills };
}

function createHandlers(workspaceRoot) {
  return createToolHandlers({
    fs,
    path,
    schemas: createMinimalSchemas(),
    validatePath: async (value) => {
      const resolved = path.resolve(String(value || ''));
      const root = path.resolve(workspaceRoot);
      if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
        throw new Error('Path is outside workspace root.');
      }
      return resolved;
    },
    workspaceRoot,
    invalidateCachesForPath() {},
    readFileWithCache() {},
    listDirectoryDetailedWithCache() {},
    indexDirectory() {},
    invalidateStructureIndexSubtree() {},
    formatSize() {},
    getFileStats() {},
    applyFileEdits() {},
    tailFile() {},
    headFile() {},
    writeFileContent() {},
    copyRecursive() {},
    aggregateIdePlugins() {},
    buildDirectoryTree() {},
    directoryTreeCache: new Map(),
    buildCacheKey() {},
    searchFilesCache: new Map(),
    searchTextCache: new Map(),
    searchFilesWithinWorkspace() {},
    searchTextWithinWorkspace() {},
    replaceTextWithinWorkspace() {},
    MAX_TEXT_SEARCH_FILE_BYTES: 1024,
    SEARCH_TEXT_TIMEOUT_MS: 1000,
    REPLACE_TEXT_TIMEOUT_MS: 1000,
    DEFAULT_DIRECTORY_TREE_MAX_DEPTH: 4,
    DEFAULT_DIRECTORY_TREE_MAX_NODES: 100,
    getAllowedDirectories: () => [workspaceRoot]
  });
}

test('read_skills_manifest_state caches existing manifest repositories and lists available skills', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'explorer-skills-manifest-'));
  try {
    const repoDir = await createLocalSkillRepo(workspaceRoot);
    await writeFile(path.join(workspaceRoot, 'ploinky', 'cli', 'utils', 'repos.js'), `
export function getPredefinedRepos() { return {}; }
export function getRepoSources() { return {}; }
export function getInstalledRepos() { return []; }
export function classifyRepoKind() { return 'unknown'; }
`);
    const projectDir = path.join(workspaceRoot, 'project');
    await fs.mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, 'ploinky-skills-manifest.json'), JSON.stringify([{
      url: repoDir,
      name: 'local-skills',
      branch: null,
      skills: ['alpha-skill']
    }], null, 2));

    const handlers = createHandlers(workspaceRoot);
    const state = parseJsonResponse(await handlers.read_skills_manifest_state({ folderPath: projectDir }));

    assert.equal(state.repositories.length, 1);
    assert.equal(state.repositories[0].name, 'local-skills');
    assert.equal(state.repositories[0].cached, true);
    assert.deepEqual(state.repositories[0].availableSkills, ['alpha-skill']);
    assert.deepEqual(state.repositories[0].skills, ['alpha-skill']);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('read_skills_manifest_state recognizes AchillesCopilotBasicSkills from an existing manifest', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'explorer-skills-manifest-achilles-'));
  try {
    const { repoDir, skills } = await createAchillesCopilotBasicSkillsRepo(workspaceRoot);
    await writeFile(path.join(workspaceRoot, 'ploinky', 'cli', 'utils', 'repos.js'), `
export function getPredefinedRepos() {
  return {
    AchillesCopilotBasicSkills: {
      url: '${repoDir.replaceAll('\\', '\\\\')}',
      description: 'Default Anthropic-style skill catalog (SKILL.md folders)',
      kind: 'skills'
    }
  };
}
export function getRepoSources() { return {}; }
export function getInstalledRepos() { return ['AchillesCopilotBasicSkills']; }
export function classifyRepoKind() { return 'skills'; }
`);
    const projectDir = path.join(workspaceRoot, 'achilles-cli-test');
    await fs.mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, 'ploinky-skills-manifest.json'), JSON.stringify([{
      url: repoDir,
      name: 'AchillesCopilotBasicSkills',
      branch: null,
      skills
    }], null, 2));

    const handlers = createHandlers(workspaceRoot);
    const state = parseJsonResponse(await handlers.read_skills_manifest_state({ folderPath: projectDir }));

    assert.equal(state.repositories.length, 1);
    assert.equal(state.repositories[0].name, 'AchillesCopilotBasicSkills');
    assert.equal(state.repositories[0].cached, true);
    assert.deepEqual(state.repositories[0].availableSkills, skills);
    assert.deepEqual(state.repositories[0].skills, skills);
    assert.equal(state.skillRepositories[0].name, 'AchillesCopilotBasicSkills');
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('add_skills_manifest_repo resolves a known repository through the current Ploinky utils layout', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'explorer-skills-manifest-add-'));
  try {
    const { repoDir, skills } = await createAchillesCopilotBasicSkillsRepo(workspaceRoot);
    await writeFile(path.join(workspaceRoot, 'ploinky', 'cli', 'utils', 'repos.js'), `
export function getPredefinedRepos() {
  return {
    AchillesCopilotBasicSkills: {
      url: '${repoDir.replaceAll('\\', '\\\\')}',
      description: 'Default Anthropic-style skill catalog (SKILL.md folders)',
      kind: 'skills'
    }
  };
}
export function getRepoSources() { return {}; }
export function getInstalledRepos() { return []; }
export function classifyRepoKind() { return 'skills'; }
`);
    const projectDir = path.join(workspaceRoot, 'project');
    await fs.mkdir(projectDir, { recursive: true });

    const handlers = createHandlers(workspaceRoot);
    const state = parseJsonResponse(await handlers.add_skills_manifest_repo({
      folderPath: projectDir,
      url: 'AchillesCopilotBasicSkills',
      name: 'AchillesCopilotBasicSkills'
    }));

    assert.equal(state.ok, true);
    assert.equal(state.added, true);
    assert.equal(state.cached, true);
    assert.equal(state.message, 'AchillesCopilotBasicSkills added.');
    assert.deepEqual(state.repositories[0].skills, skills);
    assert.deepEqual(state.installedSkills, skills);
    const manifest = JSON.parse(await fs.readFile(path.join(projectDir, 'ploinky-skills-manifest.json'), 'utf8'));
    assert.equal(manifest[0].url, repoDir);
    for (const skill of skills) {
      const installedSkill = await fs.stat(path.join(projectDir, '.agents', 'skills', skill, 'SKILL.md'));
      assert.equal(installedSkill.isFile(), true);
    }
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('add_skills_manifest_repo explains when a cached repository has no Anthropic skills', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'explorer-skills-manifest-non-anthropic-'));
  try {
    const repoDir = await createNonAnthropicSkillRepo(workspaceRoot);
    const projectDir = path.join(workspaceRoot, 'project');
    await fs.mkdir(projectDir, { recursive: true });

    const handlers = createHandlers(workspaceRoot);
    const result = parseJsonResponse(await handlers.add_skills_manifest_repo({
      folderPath: projectDir,
      url: `file://${repoDir}`,
      name: 'code-skills-only'
    }));

    assert.equal(result.ok, true);
    assert.equal(result.added, false);
    assert.equal(result.cached, true);
    assert.match(result.message, /cached but was not added.*no Anthropic skills were found/i);

    const cachedRepo = await fs.stat(path.join(workspaceRoot, '.ploinky', 'repos', 'code-skills-only'));
    assert.equal(cachedRepo.isDirectory(), true);
    await assert.rejects(
      fs.stat(path.join(projectDir, 'ploinky-skills-manifest.json')),
      (error) => error?.code === 'ENOENT'
    );
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
