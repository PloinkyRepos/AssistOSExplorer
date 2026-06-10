import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createWorkspaceStore } from '../src/storage/workspace-store.mjs';

test('workspace store reads document bytes and version key', async (t) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyoffice-workspace-store-'));
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(workspaceRoot, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, 'docs', 'report.docx'), 'hello world', 'utf8');

  const store = createWorkspaceStore({ workspaceRoot });
  const result = await store.read({
    path: '/docs/report.docx',
  });

  assert.equal(result.buffer.toString('utf8'), 'hello world');
  assert.equal(typeof result.versionKey, 'string');
  assert.equal(result.versionKey.length > 10, true);
});

test('workspace store writes callback bytes atomically inside the workspace root', async (t) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyoffice-workspace-store-'));
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(workspaceRoot, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, 'docs', 'report.docx'), 'before', 'utf8');

  const store = createWorkspaceStore({ workspaceRoot });
  await store.write({
    path: '/docs/report.docx',
    canWrite: true,
  }, Buffer.from('after'));

  assert.equal(fs.readFileSync(path.join(workspaceRoot, 'docs', 'report.docx'), 'utf8'), 'after');
  const leftoverTempFiles = fs.readdirSync(path.join(workspaceRoot, 'docs'))
    .filter((entry) => entry.includes('.onlyoffice-tmp-'));
  assert.deepEqual(leftoverTempFiles, []);
});

test('workspace store rejects writes when canWrite is false', async (t) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyoffice-workspace-store-'));
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(workspaceRoot, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, 'docs', 'report.docx'), 'before', 'utf8');

  const store = createWorkspaceStore({ workspaceRoot });
  await assert.rejects(
    () => store.write({
      path: '/docs/report.docx',
      canWrite: false,
    }, Buffer.from('after')),
    /read-only/i
  );
});
