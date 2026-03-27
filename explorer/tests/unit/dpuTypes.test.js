import test from 'node:test';
import assert from 'node:assert/strict';

import {
    isDpuFileType,
    isDpuFolderType,
    normalizeDpuObjectType,
    toExplorerEntryType
} from '../../services/dpu/dpuTypes.js';

test('dpu type helpers normalize folder and directory consistently', () => {
    assert.equal(normalizeDpuObjectType('directory'), 'folder');
    assert.equal(normalizeDpuObjectType('folder'), 'folder');
    assert.equal(normalizeDpuObjectType('file'), 'file');
    assert.equal(isDpuFolderType('directory'), true);
    assert.equal(isDpuFolderType('folder'), true);
    assert.equal(isDpuFileType('file'), true);
    assert.equal(toExplorerEntryType('folder'), 'directory');
    assert.equal(toExplorerEntryType('directory'), 'directory');
    assert.equal(toExplorerEntryType('file'), 'file');
});

test('dpu type helpers fall back to the resolved node type when the payload is incomplete', () => {
    assert.equal(normalizeDpuObjectType('', 'file'), 'file');
    assert.equal(normalizeDpuObjectType(undefined, 'directory'), 'folder');
    assert.equal(isDpuFileType(undefined, 'file'), true);
    assert.equal(isDpuFolderType(undefined, 'directory'), true);
});
