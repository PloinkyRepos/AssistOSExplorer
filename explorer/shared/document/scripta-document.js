import {
    addScriptaVariant,
    applyScriptaVote,
    assertScriptaVariantOwner,
    deleteScriptaVariant,
    ensureScriptaInitialVariant,
    getScriptaReactionStats,
    getScriptaViewerVote,
    isScriptaVariantOwner,
    normalizeScriptaState,
    updateScriptaActiveVariant,
} from './scripta-state.js';

function clone(value) {
    return JSON.parse(JSON.stringify(value ?? null));
}

function newId(prefix) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

function nowIso() {
    return new Date().toISOString();
}

function chapterTitle(chapter, fallback = 'Chapter') {
    return String(chapter?.heading?.text || chapter?.metadata?.title || chapter?.title || '').trim() || fallback;
}

function setChapterTitle(chapter, title) {
    const value = String(title || '').replace(/\s+/g, ' ').trim();
    chapter.heading = { ...(chapter.heading || {}), level: 2, text: value };
    chapter.metadata = { ...(chapter.metadata || {}), id: chapter.id, title: value };
    chapter.title = value;
}

function createParagraph(value = {}, createdBy = '') {
    const paragraph = {
        id: String(value.id || newId('paragraph')),
        text: String(value.text || ''),
        metadata: clone(value.metadata || {}),
    };
    paragraph.metadata.id = paragraph.id;
    if (value.pluginState) {
        paragraph.pluginState = clone(value.pluginState);
        paragraph.metadata.pluginState = paragraph.pluginState;
    }
    ensureScriptaInitialVariant(paragraph, { createdBy });
    return paragraph;
}

function createChapter(value = {}, index = 0, createdBy = '') {
    const chapter = {
        id: String(value.id || newId('chapter')),
        metadata: clone(value.metadata || {}),
        paragraphs: (Array.isArray(value.paragraphs) && value.paragraphs.length ? value.paragraphs : [{}])
            .map((paragraph) => createParagraph(paragraph, createdBy)),
    };
    setChapterTitle(chapter, chapterTitle(value, `Chapter ${index + 1}`));
    return chapter;
}

function initialChapters(template, initialization = {}) {
    if (template === 'vision') {
        const paragraphs = Array.isArray(initialization.visionParagraphs) ? initialization.visionParagraphs : [];
        if (paragraphs.length < 3) {
            throw new Error('Vision creation requires at least three generated aspect paragraphs.');
        }
        return [{ title: initialization.chapterTitle, paragraphs }];
    }
    if (template === 'plan') {
        if (Array.isArray(initialization.chapters) && initialization.chapters.length) {
            return initialization.chapters;
        }
        const paragraphs = Array.isArray(initialization.planParagraphs) ? initialization.planParagraphs : [];
        if (!paragraphs.length) {
            throw new Error('Plan creation requires generated chapters or paragraphs.');
        }
        return [{ title: initialization.chapterTitle, paragraphs }];
    }
    return [{ title: 'Chapter 1', paragraphs: [{ text: '' }] }];
}

export function createScriptaDocumentModel({
    title,
    template = 'general',
    initialization = {},
    createdBy = '',
} = {}) {
    const owner = String(createdBy || '').trim();
    if (!owner) throw new Error('SCRIPTA document creation requires a variant owner.');
    const normalizedTemplate = String(template || 'general').toLowerCase();
    if (!['vision', 'plan', 'general'].includes(normalizedTemplate)) {
        throw new Error('SCRIPTA template must be Vision, Plan, or General.');
    }
    const documentId = newId('document');
    const timestamp = nowIso();
    const model = {
        id: documentId,
        documentId,
        metadata: {
            id: documentId,
            title: String(initialization.title || title || 'Untitled').trim() || 'Untitled',
            version: 1,
            updatedAt: timestamp,
            pluginState: {
                scripta: {
                    template: normalizedTemplate,
                    createdAt: timestamp,
                },
            },
        },
        chapters: initialChapters(normalizedTemplate, initialization)
            .map((chapter, index) => createChapter(chapter, index, owner)),
    };
    model.title = model.metadata.title;
    model.version = model.metadata.version;
    model.updatedAt = timestamp;
    return model;
}

export function normalizeScriptaDocumentModel(source, {
    fallbackTitle = 'Untitled',
    createdBy = '',
} = {}) {
    const document = clone(source || {});
    document.metadata = { ...(document.metadata || {}) };
    document.chapters = Array.isArray(document.chapters) ? document.chapters : [];
    const first = document.chapters[0];
    if (!document.metadata.title && first?.heading?.level === 1) {
        document.metadata.title = chapterTitle(first, fallbackTitle);
        if (!first.paragraphs?.length && document.chapters.length > 1) {
            document.chapters.shift();
        }
    }
    document.metadata.title = String(document.metadata.title || fallbackTitle).trim() || fallbackTitle;
    document.title = document.metadata.title;
    document.chapters.forEach((chapter, chapterIndex) => {
        chapter.id ||= newId('chapter');
        setChapterTitle(chapter, chapterTitle(chapter, `Chapter ${chapterIndex + 1}`));
        const paragraphs = [];
        for (const paragraph of Array.isArray(chapter.paragraphs) ? chapter.paragraphs : []) {
            const pieces = paragraph.hasMetadata
                ? [String(paragraph.text || '')]
                : String(paragraph.text || '').split(/\n\s*\n+/);
            pieces.forEach((text, pieceIndex) => {
                paragraphs.push(createParagraph({
                    ...paragraph,
                    id: pieceIndex === 0 ? paragraph.id : undefined,
                    text,
                }, createdBy));
            });
        }
        chapter.paragraphs = paragraphs;
    });
    ensureNonEmptyDocument(document, createdBy);
    for (const paragraph of document.chapters.flatMap((chapter) => chapter.paragraphs)) {
        updateScriptaActiveVariant(paragraph, ensureScriptaInitialVariant(paragraph, { createdBy }));
    }
    return document;
}

export function findScriptaChapter(document, chapterId = '') {
    return document?.chapters?.find((chapter) => chapter.id === String(chapterId || ''))
        || document?.chapters?.[0]
        || null;
}

export function findScriptaParagraph(chapter, paragraphId = '') {
    return chapter?.paragraphs?.find((paragraph) => paragraph.id === String(paragraphId || ''))
        || chapter?.paragraphs?.[0]
        || null;
}

function ensureNonEmptyDocument(document, createdBy) {
    if (!Array.isArray(document.chapters) || !document.chapters.length) {
        document.chapters = [createChapter({}, 0, createdBy)];
    }
    if (!document.chapters.some((chapter) => Array.isArray(chapter.paragraphs) && chapter.paragraphs.length)) {
        document.chapters[0].paragraphs = [createParagraph({}, createdBy)];
    }
}

function bumpRevision(document) {
    const version = Math.max(0, Number(document.metadata?.version || document.version || 0)) + 1;
    const updatedAt = nowIso();
    document.metadata = { ...(document.metadata || {}), id: document.documentId, version, updatedAt };
    document.version = version;
    document.updatedAt = updatedAt;
}

export function mutateScriptaDocument(source, operation, args = {}, participant = {}) {
    const document = clone(source);
    const actorHash = String(participant.hash || participant.id || '');
    const chapter = findScriptaChapter(document, args.chapterId);
    const paragraph = findScriptaParagraph(chapter, args.paragraphId);
    let focusTarget = null;

    if (operation === 'p-variant-add') {
        if (!paragraph) throw new Error('SCRIPTA paragraph was not found.');
        addScriptaVariant(paragraph, args.text, { createdBy: actorHash });
    } else if (operation === 'p-variant-vote') {
        if (!paragraph) throw new Error('SCRIPTA paragraph was not found.');
        const state = normalizeScriptaState(paragraph);
        const variant = args.variantId
            ? state.variants.find((entry) => entry.id === args.variantId)
            : state.variants[Number(args.variantOrdinal || 0) - 1];
        if (!variant) throw new Error('SCRIPTA variant was not found.');
        applyScriptaVote(paragraph, {
            variantId: variant.id,
            userHash: actorHash,
            userLabel: String(participant.label || participant.id || ''),
            type: args.type,
        });
    } else if (operation === 'p-variant-vote-withdraw') {
        if (!paragraph) throw new Error('SCRIPTA paragraph was not found.');
        const state = ensureScriptaInitialVariant(paragraph, { createdBy: actorHash });
        const vote = getScriptaViewerVote(state, actorHash);
        if (vote) {
            applyScriptaVote(paragraph, {
                variantId: vote.variantId,
                userHash: actorHash,
                userLabel: String(participant.label || participant.id || ''),
                type: '',
            });
        }
    } else if (operation === 'p-variant-edit') {
        if (!paragraph) throw new Error('SCRIPTA paragraph was not found.');
        const state = ensureScriptaInitialVariant(paragraph, { createdBy: actorHash });
        const variant = args.variantId
            ? state.variants.find((entry) => entry.id === args.variantId)
            : state.variants.find((entry) => entry.id === state.activeVariantId);
        if (!variant) throw new Error('SCRIPTA variant was not found.');
        assertScriptaVariantOwner(variant, actorHash);
        variant.text = String(args.text ?? '');
        variant.updatedAt = nowIso();
        updateScriptaActiveVariant(paragraph, state);
    } else if (operation === 'p-variant-delete') {
        if (!paragraph) throw new Error('SCRIPTA paragraph was not found.');
        deleteScriptaVariant(paragraph, args.variantId, { deletedBy: actorHash });
    } else if (operation === 'chapter-add') {
        const created = createChapter({
            title: String(args.title || `Chapter ${document.chapters.length + 1}`),
        }, document.chapters.length, actorHash);
        document.chapters.push(created);
        focusTarget = { type: 'chapter', chapterId: created.id, paragraphId: created.paragraphs[0].id };
    } else if (operation === 'chapter-delete') {
        if (!chapter || document.chapters.length <= 1) throw new Error('SCRIPTA document must keep at least one chapter.');
        document.chapters = document.chapters.filter((entry) => entry.id !== chapter.id);
    } else if (operation === 'chapter-rename') {
        if (!chapter) throw new Error('SCRIPTA chapter was not found.');
        const ordinal = document.chapters.findIndex((entry) => entry.id === chapter.id) + 1;
        setChapterTitle(chapter, String(args.title || `Chapter ${ordinal}`));
    } else if (operation === 'chapter-move') {
        if (!chapter) throw new Error('SCRIPTA chapter was not found.');
        const index = document.chapters.findIndex((entry) => entry.id === chapter.id);
        document.chapters.splice(index, 1);
        document.chapters.splice(Math.max(0, Math.min(document.chapters.length, Number(args.targetIndex || 0))), 0, chapter);
    } else if (operation === 'paragraph-add') {
        if (!chapter) throw new Error('SCRIPTA chapter was not found.');
        const created = createParagraph({ text: args.text }, actorHash);
        chapter.paragraphs.push(created);
        focusTarget = { type: 'paragraph', chapterId: chapter.id, paragraphId: created.id };
    } else if (operation === 'paragraph-delete') {
        if (!paragraph) throw new Error('SCRIPTA paragraph was not found.');
        chapter.paragraphs = chapter.paragraphs.filter((entry) => entry.id !== paragraph.id);
    } else if (operation === 'paragraph-move') {
        if (!paragraph) throw new Error('SCRIPTA paragraph was not found.');
        const target = findScriptaChapter(document, args.targetChapterId);
        if (!target) throw new Error('SCRIPTA target chapter was not found.');
        chapter.paragraphs = chapter.paragraphs.filter((entry) => entry.id !== paragraph.id);
        const position = Math.max(0, Math.min(target.paragraphs.length, Number(args.targetIndex ?? target.paragraphs.length)));
        target.paragraphs.splice(position, 0, paragraph);
    } else {
        throw new Error(`Unsupported SCRIPTA operation "${operation}".`);
    }

    ensureNonEmptyDocument(document, actorHash);
    for (const item of document.chapters.flatMap((entry) => entry.paragraphs || [])) {
        updateScriptaActiveVariant(item, ensureScriptaInitialVariant(item));
    }
    bumpRevision(document);
    return { document, focusTarget };
}

function projectVariant(state, variant, viewerHash) {
    const projected = clone(variant);
    delete projected.createdBy;
    const ownedByViewer = isScriptaVariantOwner(variant, viewerHash);
    return {
        ...projected,
        ...getScriptaReactionStats(state, variant.id),
        _ownerHash: String(variant.createdBy || ''),
        ownedByViewer,
        canEdit: ownedByViewer,
        canDelete: ownedByViewer && state.variants.length > 1,
    };
}

export function projectScriptaDocument(document, {
    resourceId = '',
    view = {},
    viewerHash = '',
    participantMap = null,
} = {}) {
    const focusedChapter = findScriptaChapter(document, view.chapterId);
    const focusedParagraph = findScriptaParagraph(focusedChapter, view.paragraphId);
    const chapters = (document.chapters || []).map((chapter, chapterIndex) => ({
        chapterId: chapter.id,
        chapterOrdinal: chapterIndex + 1,
        chapterTitle: chapterTitle(chapter, `Chapter ${chapterIndex + 1}`),
        paragraphs: (chapter.paragraphs || []).map((paragraph, paragraphIndex) => {
            const winner = updateScriptaActiveVariant(paragraph, ensureScriptaInitialVariant(paragraph));
            return {
                paragraphId: paragraph.id,
                paragraphOrdinal: paragraphIndex + 1,
                text: winner?.text ?? paragraph.text,
            };
        }),
    }));
    let paragraph = null;
    if (focusedParagraph) {
        const state = ensureScriptaInitialVariant(focusedParagraph);
        updateScriptaActiveVariant(focusedParagraph, state);
        paragraph = {
            chapterId: focusedChapter.id,
            chapterTitle: chapterTitle(focusedChapter),
            chapterOrdinal: document.chapters.findIndex((entry) => entry.id === focusedChapter.id) + 1,
            paragraphId: focusedParagraph.id,
            paragraphOrdinal: focusedChapter.paragraphs.findIndex((entry) => entry.id === focusedParagraph.id) + 1,
            currentText: focusedParagraph.text,
            activeVariantId: state.activeVariantId,
            selectedVariantId: state.variants.some((variant) => variant.id === view.selectedVariantId)
                ? view.selectedVariantId
                : state.activeVariantId,
            editingVariantId: state.variants.some((variant) => variant.id === view.editingVariantId)
                ? view.editingVariantId
                : '',
            editorParticipantId: view.editingVariantId
                ? String(view.editorParticipantId || '')
                : '',
            variants: state.variants.map((variant) => projectVariant(state, variant, viewerHash)),
            viewerVote: viewerHash ? getScriptaViewerVote(state, viewerHash) : null,
        };
        if (participantMap && typeof participantMap === 'object') {
            paragraph._viewerVotes = Object.fromEntries(Object.entries(participantMap)
                .map(([hash, participantId]) => [String(participantId || ''), getScriptaViewerVote(state, hash)])
                .filter(([participantId, vote]) => participantId && vote));
        }
    }
    return {
        resourceId,
        documentId: document.documentId,
        documentTitle: String(document.metadata?.title || document.title || 'Untitled'),
        documentRevision: Number(document.metadata?.version || document.version || 0),
        chapters,
        viewMode: view.mode === 'paragraph' ? 'paragraph' : 'document',
        focusedChapterId: focusedChapter?.id || '',
        focusedParagraphId: focusedParagraph?.id || '',
        focusTargetType: view.focusTargetType === 'chapter' ? 'chapter' : 'paragraph',
        autoFocusRevision: Number(view.autoFocusRevision || 0),
        paragraph,
    };
}
