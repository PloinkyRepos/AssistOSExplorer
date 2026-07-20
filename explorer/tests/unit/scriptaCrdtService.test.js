import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createMarkdownCrdtStore } from '../../utils/server/markdown-crdt/markdown-crdt-store.mjs';
import { createScriptaCrdtService } from '../../utils/server/markdown-crdt/scripta-crdt-service.mjs';
import {
    applyDocumentChanges,
    changeDocument,
    createDocument,
    getDocumentChanges,
    getDocumentHeads,
    loadDocument,
} from '../../utils/server/markdown-crdt/automerge-adapter.mjs';

test('Explorer MCP manifests expose only canonical SCRIPTA mutation operations', async () => {
    const config = JSON.parse(await fs.readFile(new URL('../../mcp-config.json', import.meta.url), 'utf8'));
    const collaborationTool = config.tools.find(({ name }) => name === 'scripta_collaboration_apply');
    const mutationTool = config.tools.find(({ name }) => name === 'scripta_crdt_mutate');

    assert.deepEqual(collaborationTool?.inputSchema?.operation?.enum, ['p-variant-edit']);
    assert.deepEqual(mutationTool?.inputSchema?.operation?.enum, [
        'p-variant-add',
        'p-variant-vote',
        'p-variant-vote-withdraw',
        'p-variant-edit',
        'p-variant-delete',
        'chapter-add',
        'chapter-delete',
        'chapter-rename',
        'chapter-move',
        'paragraph-add',
        'paragraph-delete',
        'paragraph-move',
        'undo',
    ]);
});

test('SCRIPTA mutations use the Explorer Automerge authority and persist the winning variant', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'explorer-scripta-crdt-'));
    const validatePath = async (input) => {
        const candidate = String(input || '');
        const target = path.isAbsolute(candidate) && candidate.startsWith(`${workspaceRoot}${path.sep}`)
            ? path.resolve(candidate)
            : path.resolve(workspaceRoot, candidate.replace(/^\/+/, ''));
        if (target !== workspaceRoot && !target.startsWith(`${workspaceRoot}${path.sep}`)) {
            throw new Error('Path outside workspace.');
        }
        return target;
    };
    const store = createMarkdownCrdtStore({
        fs,
        path,
        workspaceRoot,
        validatePath,
        writeFileContent: (target, content) => fs.writeFile(target, content, 'utf8'),
        invalidateCachesForPath() {},
    });
    const service = createScriptaCrdtService({
        fs,
        path,
        workspaceRoot,
        validatePath,
        markdownCrdtStore: store,
    });
    const participant = { id: 'user-1', hash: 'participant-user-1', label: 'User' };

    try {
        await service.ensureFolder({ folderPath: '/WebMeet/room-1234' });
        const created = await service.create({
            path: '/WebMeet/room-1234/draft.md',
            title: 'Draft',
            template: 'general',
            createdBy: participant.hash,
            resourceId: 'resource-1',
            viewerHash: participant.hash,
        });
        const chapter = created.projection.chapters[0];
        const paragraph = chapter.paragraphs[0];
        const beforeAlternative = await service.collaborationOpen({
            path: '/WebMeet/room-1234/draft.md',
            resourceId: 'resource-1',
            viewerHash: participant.hash,
            view: { mode: 'paragraph', chapterId: chapter.chapterId, paragraphId: paragraph.paragraphId },
        });
        const initialCollaborationDocument = loadDocument(
            Buffer.from(beforeAlternative.stateBase64, 'base64')
        );
        const initialVariant = initialCollaborationDocument.chapters[0].paragraphs[0]
            .pluginState.scripta.variants[0];
        assert.equal(Object.hasOwn(initialVariant, 'text'), true);
        assert.equal(initialVariant.text, '');
        assert.equal(Object.hasOwn(initialVariant, 'createdBy'), false);
        assert.deepEqual(
            initialCollaborationDocument.chapters[0].paragraphs[0].pluginState.scripta.reactionsByVariant,
            {},
        );
        const alternative = await service.mutate({
            path: '/WebMeet/room-1234/draft.md',
            resourceId: 'resource-1',
            operation: 'p-variant-add',
            args: { chapterId: chapter.chapterId, paragraphId: paragraph.paragraphId, text: 'Alternative text' },
            participant,
            viewerHash: participant.hash,
            view: { mode: 'paragraph', chapterId: chapter.chapterId, paragraphId: paragraph.paragraphId },
        });
        const alternativePull = await service.collaborationPull({
            path: '/WebMeet/room-1234/draft.md',
            resourceId: 'resource-1',
            knownHeads: beforeAlternative.heads,
            viewerHash: participant.hash,
            view: { mode: 'paragraph', chapterId: chapter.chapterId, paragraphId: paragraph.paragraphId },
        });
        assert.equal(alternativePull.resetRequired, false);
        assert.equal('stateBase64' in alternativePull, false);
        assert.equal('projection' in alternativePull, false);
        assert.ok(
            alternativePull.changesBase64.reduce(
                (total, change) => total + Buffer.from(change, 'base64').byteLength,
                0
            ) < 16 * 1024,
            'A small variant mutation must not retransmit the complete collaboration document.'
        );
        const variantId = alternative.projection.paragraph.variants[1].id;
        const voted = await service.mutate({
            path: '/WebMeet/room-1234/draft.md',
            resourceId: 'resource-1',
            operation: 'p-variant-vote',
            args: { chapterId: chapter.chapterId, paragraphId: paragraph.paragraphId, variantId, type: 'like' },
            participant,
            viewerHash: participant.hash,
            view: { mode: 'paragraph', chapterId: chapter.chapterId, paragraphId: paragraph.paragraphId },
        });

        assert.equal(voted.projection.paragraph.currentText, 'Alternative text');
        assert.equal(voted.projection.paragraph.activeVariantId, variantId);
        assert.match(await fs.readFile(path.join(workspaceRoot, 'WebMeet/room-1234/draft.md'), 'utf8'), /Alternative text/);
        const collaborationAfterVote = await service.collaborationOpen({
            path: '/WebMeet/room-1234/draft.md',
            resourceId: 'resource-1',
            viewerHash: participant.hash,
            view: { mode: 'paragraph', chapterId: chapter.chapterId, paragraphId: paragraph.paragraphId },
        });
        const publicDocumentAfterVote = loadDocument(
            Buffer.from(collaborationAfterVote.stateBase64, 'base64')
        );
        const publicScriptaAfterVote = publicDocumentAfterVote.chapters[0].paragraphs[0]
            .pluginState.scripta;
        assert.ok(publicScriptaAfterVote.variants.every(
            (variant) => !Object.hasOwn(variant, 'createdBy')
        ));
        assert.deepEqual(publicScriptaAfterVote.reactionsByVariant, {});
        const restartedService = createScriptaCrdtService({
            fs,
            path,
            workspaceRoot,
            validatePath,
            markdownCrdtStore: store,
        });
        const undone = await restartedService.mutate({
            path: '/WebMeet/room-1234/draft.md',
            resourceId: 'resource-1',
            operation: 'undo',
            args: {},
            participant,
            viewerHash: participant.hash,
            view: { mode: 'paragraph', chapterId: chapter.chapterId, paragraphId: paragraph.paragraphId },
        });
        assert.notEqual(undone.projection.paragraph.activeVariantId, variantId);
        assert.equal((await store.open('/WebMeet/room-1234/draft.md')).documentId, created.documentId);

        const collaboration = await service.collaborationOpen({
            path: '/WebMeet/room-1234/draft.md',
            resourceId: 'resource-1',
            viewerHash: participant.hash,
            view: { mode: 'paragraph', chapterId: chapter.chapterId, paragraphId: paragraph.paragraphId },
        });
        const browserDocument = loadDocument(
            Buffer.from(collaboration.stateBase64, 'base64'),
            { actor: crypto.randomBytes(16).toString('hex') }
        );
        const browserEdited = changeDocument(browserDocument, (draft) => {
            const target = draft.chapters[0].paragraphs[0].pluginState.scripta.variants
                .find((variant) => variant.id === draft.chapters[0].paragraphs[0].pluginState.scripta.activeVariantId);
            target.text = 'Edited in the browser replica';
        });
        const activeVariantId = browserDocument.chapters[0].paragraphs[0].pluginState.scripta.activeVariantId;
        const applied = await service.collaborationApply({
            path: '/WebMeet/room-1234/draft.md',
            resourceId: 'resource-1',
            operation: 'p-variant-edit',
            changesBase64: getDocumentChanges(browserDocument, browserEdited)
                .map((change) => Buffer.from(change).toString('base64')),
            baseHeads: collaboration.heads,
            args: {
                chapterId: chapter.chapterId,
                paragraphId: paragraph.paragraphId,
                variantId: activeVariantId,
                text: 'Edited in the browser replica',
            },
            participant,
            viewerHash: participant.hash,
            view: { mode: 'paragraph', chapterId: chapter.chapterId, paragraphId: paragraph.paragraphId },
        });
        assert.equal(applied.projection.paragraph.currentText, 'Edited in the browser replica');
        assert.match(await fs.readFile(path.join(workspaceRoot, 'WebMeet/room-1234/draft.md'), 'utf8'), /Edited in the browser replica/);
        assert.equal('stateBase64' in applied, false);
        const browserAfterApply = applyDocumentChanges(
            browserEdited,
            applied.changesBase64.map((change) => Buffer.from(change, 'base64'))
        );
        assert.equal('path' in browserAfterApply, false);
        assert.deepEqual(getDocumentHeads(browserAfterApply), applied.heads);
        const unauthorizedBrowserEdit = changeDocument(browserAfterApply, (draft) => {
            const target = draft.chapters[0].paragraphs[0].pluginState.scripta.variants
                .find((variant) => variant.id === activeVariantId);
            target.text = 'Unauthorized edit';
        });
        const otherParticipant = {
            id: 'user-2',
            hash: 'participant-user-2',
            label: 'Other user',
        };
        await assert.rejects(
            service.collaborationApply({
                path: '/WebMeet/room-1234/draft.md',
                resourceId: 'resource-1',
                operation: 'p-variant-edit',
                changesBase64: getDocumentChanges(browserAfterApply, unauthorizedBrowserEdit)
                    .map((change) => Buffer.from(change).toString('base64')),
                baseHeads: applied.heads,
                args: {
                    chapterId: chapter.chapterId,
                    paragraphId: paragraph.paragraphId,
                    variantId: activeVariantId,
                    text: 'Unauthorized edit',
                },
                participant: otherParticipant,
                viewerHash: otherParticipant.hash,
                view: { mode: 'paragraph', chapterId: chapter.chapterId, paragraphId: paragraph.paragraphId },
            }),
            (error) => error?.code === 'scripta_variant_forbidden'
        );

        const canonicalState = loadDocument(await fs.readFile(path.join(
            workspaceRoot,
            '.ploinky/data/explorer/automerge/documents',
            `${created.documentId}.automerge`
        )));
        assert.equal('scriptaHistory' in canonicalState, false);
        assert.ok(Array.isArray(canonicalState.scriptaUndoHeads));
        assert.ok(canonicalState.scriptaUndoHeads.every((entry) => (
            Array.isArray(entry.beforeHeads)
            && entry.beforeHeads.every((head) => typeof head === 'string')
            && Array.isArray(entry.afterHeads)
            && entry.afterHeads.every((head) => typeof head === 'string')
            && typeof entry.modelHash === 'string'
            && entry.modelHash.length > 0
        )));

        const secondStore = createMarkdownCrdtStore({
            fs,
            path,
            workspaceRoot,
            validatePath,
            writeFileContent: (target, content) => fs.writeFile(target, content, 'utf8'),
            invalidateCachesForPath() {},
        });
        const secondService = createScriptaCrdtService({
            fs,
            path,
            workspaceRoot,
            validatePath,
            markdownCrdtStore: secondStore,
        });
        await Promise.all([
            service.mutate({
                path: '/WebMeet/room-1234/draft.md',
                resourceId: 'resource-1',
                operation: 'p-variant-add',
                args: { chapterId: chapter.chapterId, paragraphId: paragraph.paragraphId, text: 'Concurrent A' },
                participant,
                viewerHash: participant.hash,
                view: { mode: 'paragraph', chapterId: chapter.chapterId, paragraphId: paragraph.paragraphId },
            }),
            secondService.mutate({
                path: '/WebMeet/room-1234/draft.md',
                resourceId: 'resource-1',
                operation: 'p-variant-add',
                args: { chapterId: chapter.chapterId, paragraphId: paragraph.paragraphId, text: 'Concurrent B' },
                participant,
                viewerHash: participant.hash,
                view: { mode: 'paragraph', chapterId: chapter.chapterId, paragraphId: paragraph.paragraphId },
            }),
        ]);
        const concurrentProjection = await service.open({
            path: '/WebMeet/room-1234/draft.md',
            resourceId: 'resource-1',
            viewerHash: participant.hash,
            view: { mode: 'paragraph', chapterId: chapter.chapterId, paragraphId: paragraph.paragraphId },
        });
        assert.ok(concurrentProjection.projection.paragraph.variants.some((variant) => variant.text === 'Concurrent A'));
        assert.ok(concurrentProjection.projection.paragraph.variants.some((variant) => variant.text === 'Concurrent B'));

        const beforeStructuralChange = await service.collaborationOpen({
            path: '/WebMeet/room-1234/draft.md',
            resourceId: 'resource-1',
            viewerHash: participant.hash,
            view: { mode: 'document' },
        });
        const unrelatedDocument = changeDocument(createDocument({}), (draft) => {
            draft.unrelated = true;
        });
        const unrelatedPull = await service.collaborationPull({
            path: '/WebMeet/room-1234/draft.md',
            resourceId: 'resource-1',
            knownHeads: getDocumentHeads(unrelatedDocument),
            viewerHash: participant.hash,
            view: { mode: 'document' },
        });
        assert.equal(unrelatedPull.resetRequired, true);
        assert.deepEqual(unrelatedPull.changesBase64, []);
        const staleBrowserDocument = loadDocument(Buffer.from(beforeStructuralChange.stateBase64, 'base64'));
        const addedChapter = await service.mutate({
            path: '/WebMeet/room-1234/draft.md',
            resourceId: 'resource-1',
            operation: 'chapter-add',
            args: {},
            participant,
            viewerHash: participant.hash,
            view: { mode: 'document' },
        });
        const pulled = await service.collaborationPull({
            path: '/WebMeet/room-1234/draft.md',
            resourceId: 'resource-1',
            knownHeads: beforeStructuralChange.heads,
            viewerHash: participant.hash,
            view: { mode: 'document' },
        });
        assert.equal(pulled.resetRequired, false);
        assert.equal('stateBase64' in pulled, false);
        assert.equal('projection' in pulled, false);
        const pulledBrowserDocument = applyDocumentChanges(
            staleBrowserDocument,
            pulled.changesBase64.map((change) => Buffer.from(change, 'base64'))
        );
        assert.deepEqual(getDocumentHeads(pulledBrowserDocument).sort(), [...pulled.heads].sort());
        const newChapterId = addedChapter.focusTarget.chapterId;
        const newParagraphId = addedChapter.focusTarget.paragraphId;
        const pulledChapter = pulledBrowserDocument.chapters.find((entry) => entry.id === newChapterId);
        const pulledParagraph = pulledChapter.paragraphs.find((entry) => entry.id === newParagraphId);
        const pulledVariantId = pulledParagraph.pluginState.scripta.activeVariantId;
        const browserAfterFirstVariantEdit = changeDocument(pulledBrowserDocument, (draft) => {
            draft.chapters.find((entry) => entry.id === newChapterId)
                .paragraphs.find((entry) => entry.id === newParagraphId)
                .pluginState.scripta.variants.find((entry) => entry.id === pulledVariantId)
                .text = 'First variant after structural pull';
        });
        const structuralEdit = await service.collaborationApply({
            path: '/WebMeet/room-1234/draft.md',
            resourceId: 'resource-1',
            operation: 'p-variant-edit',
            changesBase64: getDocumentChanges(pulledBrowserDocument, browserAfterFirstVariantEdit)
                .map((change) => Buffer.from(change).toString('base64')),
            baseHeads: pulled.heads,
            args: {
                chapterId: newChapterId,
                paragraphId: newParagraphId,
                variantId: pulledVariantId,
                text: 'First variant after structural pull',
            },
            participant,
            viewerHash: participant.hash,
            view: { mode: 'paragraph', chapterId: newChapterId, paragraphId: newParagraphId },
        });
        assert.equal(structuralEdit.projection.paragraph.currentText, 'First variant after structural pull');

        await store.mutateAndSave({
            path: '/WebMeet/room-1234/draft.md',
        }, (model) => ({
            ...model,
            preface: 'Advanced Editor change after the SCRIPTA operation',
        }));
        await assert.rejects(
            service.mutate({
                path: '/WebMeet/room-1234/draft.md',
                resourceId: 'resource-1',
                operation: 'undo',
                args: {},
                participant,
                viewerHash: participant.hash,
                view: { mode: 'paragraph', chapterId: newChapterId, paragraphId: newParagraphId },
            }),
            (error) => error?.code === 'scripta_undo_conflict'
        );
        assert.equal(
            (await store.open('/WebMeet/room-1234/draft.md')).model.preface,
            'Advanced Editor change after the SCRIPTA operation'
        );

        const rollbackPrepared = await service.remove({
            phase: 'prepare',
            documentId: created.documentId,
            path: '/WebMeet/room-1234/draft.md'
        });
        assert.ok(rollbackPrepared.transactionId);
        await new Promise((resolve) => setTimeout(resolve, 5));
        const recoveryStore = createMarkdownCrdtStore({
            fs,
            path,
            workspaceRoot,
            validatePath,
            writeFileContent: (target, content) => fs.writeFile(target, content, 'utf8'),
            invalidateCachesForPath() {},
            transactionStaleMs: 1,
        });
        await recoveryStore.open('/WebMeet/room-1234/draft.md');
        assert.equal((await fs.stat(path.join(workspaceRoot, 'WebMeet/room-1234/draft.md'))).isFile(), true);
        const collaborationPath = path.join(
            workspaceRoot,
            '.ploinky/data/explorer/automerge/scripta-collaboration',
            `${created.documentId}.automerge`
        );
        assert.equal((await fs.stat(collaborationPath)).isFile(), true);

        const commitPrepared = await service.remove({
            phase: 'prepare',
            documentId: created.documentId,
            path: '/WebMeet/room-1234/draft.md'
        });
        await service.remove({ phase: 'commit', transactionId: commitPrepared.transactionId });
        await assert.rejects(fs.stat(path.join(workspaceRoot, 'WebMeet/room-1234/draft.md')), /ENOENT/);
        await assert.rejects(fs.stat(collaborationPath), /ENOENT/);
    } finally {
        await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
});

test('SCRIPTA creation removes every artifact when the collaboration replica cannot be created', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'explorer-scripta-create-rollback-'));
    const controlledFs = new Proxy(fs, {
        get(target, property) {
            if (property !== 'rename') return target[property];
            return async (source, destination) => {
                if (String(destination).includes(`${path.sep}scripta-collaboration${path.sep}`)) {
                    throw new Error('public replica unavailable');
                }
                return target.rename(source, destination);
            };
        },
    });
    const validatePath = async (input) => {
        const target = path.resolve(workspaceRoot, String(input || '').replace(/^\/+/, ''));
        if (target !== workspaceRoot && !target.startsWith(`${workspaceRoot}${path.sep}`)) {
            throw new Error('Path outside workspace.');
        }
        return target;
    };
    const store = createMarkdownCrdtStore({
        fs: controlledFs,
        path,
        workspaceRoot,
        validatePath,
        writeFileContent: (target, content) => controlledFs.writeFile(target, content, 'utf8'),
        invalidateCachesForPath() {},
    });
    const service = createScriptaCrdtService({
        fs: controlledFs,
        path,
        workspaceRoot,
        validatePath,
        markdownCrdtStore: store,
    });

    try {
        await service.ensureFolder({ folderPath: '/WebMeet/create-rollback' });
        await assert.rejects(service.create({
            path: '/WebMeet/create-rollback/draft.md',
            title: 'Draft',
            template: 'general',
            createdBy: 'participant-user-1',
            resourceId: 'resource-1',
            viewerHash: 'participant-user-1',
        }), /public replica unavailable/);
        await assert.rejects(
            fs.stat(path.join(workspaceRoot, 'WebMeet/create-rollback/draft.md')),
            /ENOENT/
        );
        const canonicalFiles = await fs.readdir(path.join(
            workspaceRoot,
            '.ploinky/data/explorer/automerge/documents'
        )).catch(() => []);
        const collaborationFiles = await fs.readdir(path.join(
            workspaceRoot,
            '.ploinky/data/explorer/automerge/scripta-collaboration'
        )).catch(() => []);
        assert.equal(canonicalFiles.filter((name) => name.endsWith('.automerge')).length, 0);
        assert.equal(collaborationFiles.filter((name) => name.endsWith('.automerge')).length, 0);
    } finally {
        await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
});

test('SCRIPTA creation and open share one path lock after the document id becomes visible', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'explorer-scripta-lock-'));
    let releaseReplica;
    let replicaWriteStarted;
    const replicaGate = new Promise((resolve) => { releaseReplica = resolve; });
    const replicaStarted = new Promise((resolve) => { replicaWriteStarted = resolve; });
    let holdReplica = true;
    const controlledFs = new Proxy(fs, {
        get(target, property) {
            if (property !== 'rename') return target[property];
            return async (source, destination) => {
                if (
                    holdReplica
                    && String(destination).includes(`${path.sep}scripta-collaboration${path.sep}`)
                ) {
                    replicaWriteStarted();
                    await replicaGate;
                    holdReplica = false;
                }
                return target.rename(source, destination);
            };
        },
    });
    const validatePath = async (input) => {
        const target = path.resolve(workspaceRoot, String(input || '').replace(/^\/+/, ''));
        if (target !== workspaceRoot && !target.startsWith(`${workspaceRoot}${path.sep}`)) {
            throw new Error('Path outside workspace.');
        }
        return target;
    };
    const makeStore = () => createMarkdownCrdtStore({
        fs: controlledFs,
        path,
        workspaceRoot,
        validatePath,
        writeFileContent: (target, content) => controlledFs.writeFile(target, content, 'utf8'),
        invalidateCachesForPath() {},
    });
    const service = createScriptaCrdtService({
        fs: controlledFs,
        path,
        workspaceRoot,
        validatePath,
        markdownCrdtStore: makeStore(),
    });
    const secondStore = makeStore();

    try {
        await service.ensureFolder({ folderPath: '/WebMeet/lock' });
        const creation = service.create({
            path: '/WebMeet/lock/draft.md',
            title: 'Draft',
            template: 'general',
            createdBy: 'participant-user-1',
            resourceId: 'resource-1',
            viewerHash: 'participant-user-1',
        });
        await replicaStarted;
        let openSettled = false;
        const opening = secondStore.open('/WebMeet/lock/draft.md').finally(() => {
            openSettled = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.equal(openSettled, false);
        releaseReplica();
        const [created, opened] = await Promise.all([creation, opening]);
        assert.equal(opened.documentId, created.documentId);
    } finally {
        releaseReplica();
        await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
});

test('SCRIPTA mutation rolls back canonical state when public replica commit fails', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'explorer-scripta-rollback-'));
    let failPublicCommit = false;
    const controlledFs = new Proxy(fs, {
        get(target, property) {
            if (property !== 'rename') return target[property];
            return async (source, destination) => {
                if (
                    failPublicCommit
                    && String(destination).includes(`${path.sep}scripta-collaboration${path.sep}`)
                ) {
                    throw new Error('public replica unavailable');
                }
                return target.rename(source, destination);
            };
        },
    });
    const validatePath = async (input) => {
        const target = path.resolve(workspaceRoot, String(input || '').replace(/^\/+/, ''));
        if (target !== workspaceRoot && !target.startsWith(`${workspaceRoot}${path.sep}`)) {
            throw new Error('Path outside workspace.');
        }
        return target;
    };
    const store = createMarkdownCrdtStore({
        fs: controlledFs,
        path,
        workspaceRoot,
        validatePath,
        writeFileContent: (target, content) => controlledFs.writeFile(target, content, 'utf8'),
        invalidateCachesForPath() {},
    });
    const service = createScriptaCrdtService({
        fs: controlledFs,
        path,
        workspaceRoot,
        validatePath,
        markdownCrdtStore: store,
    });
    const documentPath = '/WebMeet/rollback/draft.md';
    const participant = { id: 'user-1', hash: 'participant-user-1', label: 'User' };

    try {
        await service.ensureFolder({ folderPath: '/WebMeet/rollback' });
        const created = await service.create({
            path: documentPath,
            title: 'Draft',
            template: 'general',
            createdBy: participant.hash,
            resourceId: 'resource-1',
            viewerHash: participant.hash,
        });
        const chapter = created.projection.chapters[0];
        const paragraph = chapter.paragraphs[0];
        failPublicCommit = true;

        await assert.rejects(
            service.mutate({
                path: documentPath,
                resourceId: 'resource-1',
                operation: 'p-variant-add',
                args: {
                    chapterId: chapter.chapterId,
                    paragraphId: paragraph.paragraphId,
                    text: 'Must not survive',
                },
                participant,
                viewerHash: participant.hash,
                view: {
                    mode: 'paragraph',
                    chapterId: chapter.chapterId,
                    paragraphId: paragraph.paragraphId,
                },
            }),
            /public replica unavailable/
        );

        failPublicCommit = false;
        const reopened = await service.open({
            path: documentPath,
            resourceId: 'resource-1',
            viewerHash: participant.hash,
            view: {
                mode: 'paragraph',
                chapterId: chapter.chapterId,
                paragraphId: paragraph.paragraphId,
            },
        });
        assert.equal(reopened.projection.documentRevision, created.projection.documentRevision);
        assert.equal(reopened.projection.paragraph.variants.length, 1);
        assert.doesNotMatch(
            await fs.readFile(path.join(workspaceRoot, 'WebMeet/rollback/draft.md'), 'utf8'),
            /Must not survive/
        );
    } finally {
        await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
});
