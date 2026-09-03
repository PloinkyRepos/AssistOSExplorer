import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TOOL_PATH = path.resolve(__dirname, '..', '..', 'tools', 'tasks_tool.mjs');

async function callTool(toolName, args, env = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TOOL_PATH], {
      env: {
        ...process.env,
        ...env,
        TOOL_NAME: toolName
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `Tool exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout || '{}'));
      } catch (error) {
        reject(new Error(`Failed to parse tool output: ${error.message}`));
      }
    });

    child.stdin.write(JSON.stringify({ arguments: args }));
    child.stdin.end();
  });
}

test('tasks tool creates, updates, reorders, and completes markdown backlog tasks', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tasks-markdown-'));
  const backlogPath = path.join(repoRoot, 'sample.backlog');
  const historyPath = path.join(repoRoot, 'sample.history');

  await fs.writeFile(backlogPath, '# Backlog\n\n## Tasks\n', 'utf8');

  const createdOne = await callTool('task_create', {
    repoPath: repoRoot,
    backlogPath,
    description: 'First task',
    options: ['Option one', 'Option two']
  });
  assert.equal(createdOne.ok, true);
  assert.equal(createdOne.task.id, 'TASK-001');

  const createdTwo = await callTool('task_create', {
    repoPath: repoRoot,
    backlogPath,
    description: 'Second task',
    options: ['Another option']
  });
  assert.equal(createdTwo.ok, true);
  assert.equal(createdTwo.task.id, 'TASK-002');

  const listed = await callTool('task_list', {
    repoPath: repoRoot,
    backlogPath
  });
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.tasks.map((task) => task.id), ['TASK-001', 'TASK-002']);

  const updated = await callTool('task_update', {
    repoPath: repoRoot,
    backlogPath,
    id: 'TASK-001',
    description: 'First task updated',
    options: ['Updated option'],
    ifMatch: createdOne.task.taskHash
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.task.description, 'First task updated');

  const reordered = await callTool('task_reorder', {
    repoPath: repoRoot,
    backlogPath,
    order: ['TASK-002', 'TASK-001']
  });
  assert.equal(reordered.ok, true);
  assert.deepEqual(reordered.tasks.map((task) => task.id), ['TASK-002', 'TASK-001']);

  const done = await callTool('task_update', {
    repoPath: repoRoot,
    backlogPath,
    id: 'TASK-001',
    status: 'done',
    resolution: 'Executed.',
    ifMatch: updated.task.taskHash
  });
  assert.equal(done.ok, true);
  assert.equal(done.done, true);

  const listedAfterDone = await callTool('task_list', {
    repoPath: repoRoot,
    backlogPath
  });
  assert.deepEqual(listedAfterDone.tasks.map((task) => task.id), ['TASK-002']);

  const historyListed = await callTool('task_history_list', {
    repoPath: repoRoot,
    backlogPath: historyPath
  });
  assert.equal(historyListed.ok, true);
  assert.deepEqual(historyListed.tasks.map((task) => task.id), ['TASK-001']);
  assert.equal(historyListed.tasks[0].resolution, 'Executed.');
});

test('tasks backlog scan excludes private .data trees from tool results', async (t) => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tasks-scan-'));
  t.after(async () => fs.rm(repoRoot, { recursive: true, force: true }));
  const publicBacklog = path.join(repoRoot, 'public.backlog');
  const privateBacklog = path.join(repoRoot, '.data', 'tasksAgent', 'private.backlog');
  await fs.mkdir(path.dirname(privateBacklog), { recursive: true });
  await fs.writeFile(publicBacklog, '# Backlog\n\n## Tasks\n', 'utf8');
  await fs.writeFile(privateBacklog, '# Backlog\n\n## Tasks\n', 'utf8');

  const result = await callTool('task_list', {
    repoPath: repoRoot,
    __debug: true
  });

  assert.equal(result.error, 'debug');
  assert.equal(result.debug.fileCount, 1);
});

test('task_create rejects a backlog symlink that resolves outside repoPath without modifying its target', async (t) => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tasks-symlink-escape-'));
  t.after(async () => fs.rm(fixtureRoot, { recursive: true, force: true }));
  const repoRoot = path.join(fixtureRoot, 'repo');
  const outsideBacklog = path.join(fixtureRoot, 'outside.backlog');
  const linkedBacklog = path.join(repoRoot, 'linked.backlog');
  const original = '# Backlog\n\n## Tasks\n\nOutside sentinel.\n';
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.writeFile(outsideBacklog, original, 'utf8');
  await fs.symlink(outsideBacklog, linkedBacklog);

  const result = await callTool('task_create', {
    repoPath: repoRoot,
    backlogPath: linkedBacklog,
    description: 'Must not escape',
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /symbolic link|symlink escape/);
  assert.equal(await fs.readFile(outsideBacklog, 'utf8'), original);
  await assert.rejects(fs.access(path.join(repoRoot, 'linked.history')));
});
