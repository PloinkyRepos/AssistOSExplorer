import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createWorkspacePathPolicy } from '../src/storage/path-policy.mjs';
import { isConfidentialRequestPath } from '../src/storage/dpu-paths.mjs';

test('workspace path policy accepts paths inside the workspace root', async (t) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyoffice-workspace-root-'));
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(workspaceRoot, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, 'docs', 'report.docx'), 'report', 'utf8');

  const policy = createWorkspacePathPolicy({ workspaceRoot });
  const resolved = await policy.resolve('/docs/report.docx');

  assert.equal(resolved.absolutePath, path.join(workspaceRoot, 'docs', 'report.docx'));
  assert.equal(resolved.relativePath, 'docs/report.docx');
});

test('workspace path policy rejects dot dot traversal', async (t) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyoffice-workspace-root-'));
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));

  const policy = createWorkspacePathPolicy({ workspaceRoot });
  await assert.rejects(
    () => policy.resolve('/docs/../../outside.txt'),
    /outside the workspace root/i
  );
});

test('workspace path policy rejects nul bytes', async (t) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyoffice-workspace-root-'));
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));

  const policy = createWorkspacePathPolicy({ workspaceRoot });
  await assert.rejects(
    () => policy.resolve('/docs/bad\u0000name.docx'),
    /nul byte/i
  );
});

test('workspace path policy rejects symlink escapes outside the workspace root', async (t) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyoffice-workspace-root-'));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyoffice-outside-root-'));
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(outsideRoot, { recursive: true, force: true }));

  fs.mkdirSync(path.join(workspaceRoot, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(outsideRoot, 'secret-dir'), { recursive: true });
  fs.symlinkSync(path.join(outsideRoot, 'secret-dir'), path.join(workspaceRoot, 'docs', 'escape'));

  const policy = createWorkspacePathPolicy({ workspaceRoot });
  await assert.rejects(
    () => policy.resolve('/docs/escape/report.docx'),
    /outside the workspace root/i
  );
});

test('workspace path policy rejects .secrets and star dot secrets files', async (t) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyoffice-workspace-root-'));
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));

  const policy = createWorkspacePathPolicy({ workspaceRoot });
  await assert.rejects(
    () => policy.resolve('/.secrets'),
    /\.secrets/i
  );
  await assert.rejects(
    () => policy.resolve('/docs/app.secrets'),
    /\.secrets/i
  );
  await assert.rejects(
    () => policy.resolve('/docs/.secrets/report.docx'),
    /\.secrets/i
  );
});

test('workspace path policy rejects /Confidential because dpu storage owns it', async (t) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onlyoffice-workspace-root-'));
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));

  const policy = createWorkspacePathPolicy({ workspaceRoot });
  await assert.rejects(
    () => policy.resolve('/Confidential/My Space/report.docx'),
    /Confidential/i
  );
});

test('isConfidentialRequestPath uses a path boundary', () => {
  assert.equal(isConfidentialRequestPath('/Confidential'), true);
  assert.equal(isConfidentialRequestPath('/Confidential/My Space/a.docx'), true);
  assert.equal(isConfidentialRequestPath('/Confidentialfoo.docx'), false);
  assert.equal(isConfidentialRequestPath('/docs/a.docx'), false);
});
