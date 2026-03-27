import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DPU_MY_SPACE_PATH,
    DPU_SHARED_PATH,
    isDpuSecretPath,
    isDpuVirtualPath,
    resolveDpuSecretKey
} from '../../services/dpu/dpuPaths.js';
import { annotateSharedEntries, resolveDpuConfidentialNodeAtPath } from '../../services/dpu/dpuPathResolver.js';

test('dpu path helpers classify virtual and secret paths consistently', () => {
    assert.equal(isDpuVirtualPath('/Confidential/Secrets/API_KEY'), true);
    assert.equal(isDpuSecretPath('/Confidential/Secrets/API_KEY'), true);
    assert.equal(resolveDpuSecretKey('/Confidential/Secrets/API_KEY'), 'API_KEY');
    assert.equal(isDpuVirtualPath('/regular/path.txt'), false);
});

test('resolveDpuConfidentialNodeAtPath walks My Space descendants', async () => {
    const calls = [];
    const resolved = await resolveDpuConfidentialNodeAtPath('/Confidential/My Space/docs/plan.md', {
        getRoots: async () => ({ mySpace: { id: 'root-1' } }),
        listConfidential: async (args) => {
            calls.push(args);
            if (args.parentId === 'root-1') {
                return { items: [{ id: 'folder-1', name: 'docs', type: 'folder' }] };
            }
            if (args.parentId === 'folder-1') {
                return { items: [{ id: 'file-1', name: 'plan.md', type: 'file' }] };
            }
            return { items: [] };
        }
    });

    assert.deepEqual(calls, [
        { scope: 'my-space', parentId: 'root-1' },
        { scope: 'my-space', parentId: 'folder-1' }
    ]);
    assert.equal(resolved?.id, 'file-1');
    assert.equal(resolved?.name, 'plan.md');
});

test('annotateSharedEntries keeps direct names and disambiguates shared collisions only when needed', () => {
    const annotated = annotateSharedEntries([
        { id: '1', ownerId: 'alice@example.com', name: 'projects' },
        { id: '2', ownerId: 'bob@example.com', name: 'projects' },
        { id: '3', ownerId: 'carol@example.com', name: 'notes' }
    ]);

    assert.equal(annotated[0].virtualName, 'projects (alice@example.com)');
    assert.equal(annotated[1].virtualName, 'projects (bob@example.com)');
    assert.equal(annotated[2].virtualName, 'notes');
});

test('resolveDpuConfidentialNodeAtPath resolves shared paths without owner-scoped URL segments', async () => {
    const calls = [];
    const resolved = await resolveDpuConfidentialNodeAtPath('/Confidential/Shared/projects/spec.md', {
        getRoots: async () => ({ mySpace: { id: 'unused' } }),
        listConfidential: async (args) => {
            calls.push(args);
            if (args.scope === 'shared') {
                return {
                    items: [
                        { id: 'folder-1', ownerId: 'owner@example.com', name: 'projects', type: 'folder' }
                    ]
                };
            }
            if (args.parentId === 'folder-1') {
                return { items: [{ id: 'file-1', name: 'spec.md', type: 'file', ownerId: 'owner@example.com' }] };
            }
            return { items: [] };
        }
    });

    assert.equal(calls[0].scope, 'shared');
    assert.deepEqual(calls[1], { scope: 'my-space', parentId: 'folder-1' });
    assert.equal(resolved?.id, 'file-1');
    assert.equal(resolved?.name, 'spec.md');
});

test('resolver returns null for root-only confidential paths', async () => {
    const resultMySpace = await resolveDpuConfidentialNodeAtPath(DPU_MY_SPACE_PATH, {
        getRoots: async () => ({ mySpace: { id: 'root-1' } }),
        listConfidential: async () => ({ items: [] })
    });
    const resultShared = await resolveDpuConfidentialNodeAtPath(DPU_SHARED_PATH, {
        getRoots: async () => ({ mySpace: { id: 'root-1' } }),
        listConfidential: async () => ({ items: [] })
    });

    assert.equal(resultMySpace, null);
    assert.equal(resultShared, null);
});
