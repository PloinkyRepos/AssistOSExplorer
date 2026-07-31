import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createScriptaDocumentModel,
    mutateScriptaDocument,
    normalizeScriptaDocumentModel,
    projectScriptaDocument,
} from '../../shared/document/scripta-document.js';
import { parseMarkdownState, serializeMarkdownState } from '../../utils/server/markdown-crdt/markdown-crdt-model.mjs';
import { ScriptaVariantsView } from '../../shared/ui/scripta-variants-view/scripta-variants-view.js';

test('adding an image at chapter level creates one paragraph whose initial variant owns the image', () => {
    const document = createScriptaDocumentModel({ title: 'Media', template: 'general', createdBy: 'owner' });
    const chapter = document.chapters[0];
    const {document: changed, focusTarget} = mutateScriptaDocument(document, 'paragraph-add', {
        chapterId: chapter.id,
        text: '',
        assetId: 'asset_chapter',
        alt: 'Chapter image',
        workspaceUrl: '/WebMeet/story-room-1/assets/asset_chapter/chapter.png',
    }, {hash: 'owner'});

    assert.equal(changed.chapters[0].paragraphs.length, 2);
    const created = changed.chapters[0].paragraphs[1];
    const variant = created.pluginState.scripta.variants[0];
    assert.equal(variant.text, '');
    assert.equal(variant.images.length, 1);
    assert.equal(variant.images[0].assetId, 'asset_chapter');
    assert.deepEqual(focusTarget, {type: 'paragraph', chapterId: chapter.id, paragraphId: created.id});
});

test('variant image position is serialized at the text cursor and follows later text edits', () => {
    const document = createScriptaDocumentModel({title: 'Cursor', template: 'general', createdBy: 'owner'});
    const chapter = document.chapters[0];
    const paragraph = chapter.paragraphs[0];
    const variantId = paragraph.pluginState.scripta.variants[0].id;
    let changed = mutateScriptaDocument(document, 'p-variant-edit', {
        chapterId: chapter.id, paragraphId: paragraph.id, variantId, text: 'abcdef',
    }, {hash: 'owner'}).document;
    changed = mutateScriptaDocument(changed, 'p-variant-image-insert', {
        chapterId: chapter.id, paragraphId: paragraph.id, variantId,
        assetId: 'asset_cursor', alt: 'Cursor image', position: 3,
        workspaceUrl: '/WebMeet/story-room-1/assets/asset_cursor/cursor.png',
    }, {hash: 'owner'}).document;
    let variant = changed.chapters[0].paragraphs[0].pluginState.scripta.variants[0];
    assert.equal(variant.images[0].position, 3);
    assert.match(serializeMarkdownState(changed), /abc\n\n!\[Cursor image\].*\n\ndef/);

    changed = mutateScriptaDocument(changed, 'p-variant-edit', {
        chapterId: chapter.id, paragraphId: paragraph.id, variantId, text: 'XXabcdef',
    }, {hash: 'owner'}).document;
    variant = changed.chapters[0].paragraphs[0].pluginState.scripta.variants[0];
    assert.equal(variant.images[0].position, 5);
});

test('image ordinals follow document order and resolve against the authoritative variant', () => {
    const document = createScriptaDocumentModel({title: 'Ordinals', template: 'general', createdBy: 'owner'});
    const chapter = document.chapters[0];
    const paragraph = chapter.paragraphs[0];
    const variantId = paragraph.pluginState.scripta.variants[0].id;
    let changed = mutateScriptaDocument(document, 'p-variant-edit', {
        chapterId: chapter.id, paragraphId: paragraph.id, variantId, text: 'abcdef',
    }, {hash: 'owner'}).document;
    for (const image of [
        {assetId: 'asset_end', alt: 'End', position: 6},
        {assetId: 'asset_start', alt: 'Start', position: 0},
    ]) {
        changed = mutateScriptaDocument(changed, 'p-variant-image-insert', {
            chapterId: chapter.id, paragraphId: paragraph.id, variantId, ...image,
            workspaceUrl: `/WebMeet/story-room-1/assets/${image.assetId}/image.png`,
        }, {hash: 'owner'}).document;
    }
    const projection = projectScriptaDocument(changed, {
        view: {chapterId: chapter.id, paragraphId: paragraph.id}, viewerHash: 'owner',
    });
    assert.deepEqual(projection.paragraph.variants[0].images.map(({alt, ordinal}) => ({alt, ordinal})), [
        {alt: 'Start', ordinal: 1},
        {alt: 'End', ordinal: 2},
    ]);
    changed = mutateScriptaDocument(changed, 'p-variant-image-delete', {
        chapterId: chapter.id, paragraphId: paragraph.id, variantOrdinal: 1, imageOrdinal: 1,
    }, {hash: 'owner'}).document;
    assert.deepEqual(
        projectScriptaDocument(changed, {view: {chapterId: chapter.id, paragraphId: paragraph.id}, viewerHash: 'owner'})
            .paragraph.variants[0].images.map(({alt}) => alt),
        ['End'],
    );
});

test('conflicting variant or image selectors are rejected instead of mutating an unintended image', () => {
    const document = createScriptaDocumentModel({title: 'Selector integrity', template: 'general', createdBy: 'owner'});
    const chapter = document.chapters[0];
    const paragraph = chapter.paragraphs[0];
    const firstVariantId = paragraph.pluginState.scripta.variants[0].id;
    let changed = mutateScriptaDocument(document, 'p-variant-add', {
        chapterId: chapter.id, paragraphId: paragraph.id, text: 'Second variant',
    }, {hash: 'owner'}).document;
    const secondVariantId = changed.chapters[0].paragraphs[0].pluginState.scripta.variants[1].id;
    changed = mutateScriptaDocument(changed, 'p-variant-image-insert', {
        chapterId: chapter.id, paragraphId: paragraph.id, variantId: firstVariantId,
        assetId: 'asset_one', workspaceUrl: '/WebMeet/story-room-1/assets/asset_one/one.png',
    }, {hash: 'owner'}).document;
    changed = mutateScriptaDocument(changed, 'p-variant-image-insert', {
        chapterId: chapter.id, paragraphId: paragraph.id, variantId: secondVariantId,
        assetId: 'asset_two', workspaceUrl: '/WebMeet/story-room-1/assets/asset_two/two.png',
    }, {hash: 'owner'}).document;
    const firstImageId = changed.chapters[0].paragraphs[0].pluginState.scripta.variants[0].images[0].imageId;

    assert.throws(() => mutateScriptaDocument(changed, 'p-variant-image-delete', {
        chapterId: chapter.id,
        paragraphId: paragraph.id,
        variantId: firstVariantId,
        variantOrdinal: 2,
        imageOrdinal: 1,
    }, {hash: 'owner'}), /variant selectors do not identify the same variant/);
    assert.throws(() => mutateScriptaDocument(changed, 'p-variant-image-delete', {
        chapterId: chapter.id,
        paragraphId: paragraph.id,
        variantId: firstVariantId,
        imageId: firstImageId,
        imageOrdinal: 2,
    }, {hash: 'owner'}), /image selectors do not identify the same image/);
});

test('variant image control keeps the draft editor open while file selection is pending', () => {
    const emitted = [];
    const view = new ScriptaVariantsView({dispatchEvent() {}, contains: () => true}, () => {});
    view.emit = (type, detail) => emitted.push({type, detail});
    view.root = {querySelector: () => ({selectionStart: 4, value: 'draft text'})};
    view.render = () => {};
    view.state.variants = [{id: 'variant-2', text: 'old text', canEdit: true}];
    view.state.selectedVariantId = 'variant-2';
    view.state.editingVariantId = 'variant-2';
    const button = {dataset: {scriptaAction: 'insert-image', variantId: 'variant-2'}};
    view.handleClick({
        target: {closest: () => button},
        preventDefault() {},
        stopPropagation() {},
    });
    assert.deepEqual(emitted, [{
        type: 'scripta-p-variant-image-insert',
        detail: {variantId: 'variant-2', position: 4, text: 'draft text'},
    }]);
    assert.equal(view.state.editingVariantId, 'variant-2');
    assert.equal(view.state.variants[0].text, 'old text');
});

test('authoritative edit projections restore focus after the variants view rerenders', () => {
    const focusCalls = [];
    const selections = [];
    const editor = {
        value: 'Editable text',
        disabled: false,
        readOnly: false,
        focus: (options) => focusCalls.push(options),
        setSelectionRange: (...args) => selections.push(args),
    };
    const view = new ScriptaVariantsView({dispatchEvent() {}}, () => {});
    view.root = {querySelector: (selector) => selector === '[data-role="variantText"]' ? editor : null};
    view.render = () => {};

    view.setData({
        variants: [{id: 'variant-1', text: 'Editable text', canEdit: true}],
        selectedVariantId: 'variant-1',
        editingVariantId: 'variant-1',
        editable: true,
        disabled: false,
    });

    assert.deepEqual(focusCalls, [{preventScroll: true}]);
    assert.deepEqual(selections, [[13, 13]]);
});

test('a rejected edit start closes only the local variant editor', () => {
    let renders = 0;
    const view = new ScriptaVariantsView({dispatchEvent() {}}, () => {});
    view.render = () => { renders += 1; };
    view.state.editingVariantId = 'variant-1';

    assert.equal(view.rejectEditStart('variant-other'), false);
    assert.equal(view.state.editingVariantId, 'variant-1');
    assert.equal(view.rejectEditStart('variant-1'), true);
    assert.equal(view.state.editingVariantId, '');
    assert.equal(renders, 1);
});

test('SCRIPTA variants view removes its global pointer listener when unloaded', () => {
    const removed = [];
    const previousDocument = globalThis.document;
    globalThis.document = {
        removeEventListener: (...args) => removed.push(args),
    };
    try {
        const element = {
            dispatchEvent() {},
            contains: () => true,
            removeEventListener() {},
        };
        const view = new ScriptaVariantsView(element, () => {});
        view.afterUnload();
        assert.deepEqual(removed, [['pointerdown', view.onDocumentPointerDown, true]]);
        assert.equal(view.root, null);
    } finally {
        globalThis.document = previousDocument;
    }
});

test('variant image layout control emits persistent resize and ratio data', () => {
    const emitted = [];
    let renders = 0;
    const view = new ScriptaVariantsView({dispatchEvent() {}, contains: () => true}, () => {});
    view.emit = (type, detail) => emitted.push({type, detail});
    view.render = () => { renders += 1; };
    const imageNode = {style: {}};
    const classes = new Set(['scripta-variant-image', 'is-center']);
    const figure = {
        style: {},
        classList: {
            remove: (...values) => values.forEach((value) => classes.delete(value)),
            add: (...values) => values.forEach((value) => classes.add(value)),
        },
        querySelector: () => imageNode,
    };
    const container = {
        dataset: {imageId: 'image-1'},
        querySelector: (selector) => selector === '.scripta-variant-image' ? figure : null,
    };
    view.root = {querySelectorAll: () => [container]};
    view.state.variants = [{
        id: 'variant-1', canEdit: true, images: [{
            imageId: 'image-1',
            alt: 'Diagram',
            layout: {widthPercent: 100, aspectRatio: 'auto', fit: 'contain', alignment: 'center'},
        }],
    }];
    const control = {
        value: '60',
        dataset: {imageLayoutField: 'widthPercent', variantId: 'variant-1', imageId: 'image-1'},
    };
    view.handleChange({target: {closest: () => control}});
    assert.deepEqual(emitted, [{
        type: 'scripta-p-variant-image-layout',
        detail: {
            variantId: 'variant-1', imageId: 'image-1', widthPercent: 60,
            aspectRatio: 'auto', fit: 'contain', alignment: 'center',
        },
    }]);
    assert.equal(renders, 0);
    assert.equal(figure.style.width, '60%');
    assert.equal(classes.has('is-center'), true);
    assert.equal(imageNode.style.objectFit, 'contain');
});

test('image container leaves contextual toolbar creation to the component template', () => {
    const view = new ScriptaVariantsView({dispatchEvent() {}, contains: () => true}, () => {});
    view.state.editable = true;
    view.state.selectedImageId = 'image-1';
    const variant = {
        id: 'variant-1', text: '', canEdit: true, canDelete: true, images: [{
            imageId: 'image-1', assetId: 'asset-1', alt: 'Diagram',
            workspaceUrl: '/WebMeet/story-room/assets/asset-1/image.png', position: 0,
            layout: {widthPercent: 80, aspectRatio: '4:3', fit: 'contain', alignment: 'center'},
        }],
    };
    const html = view.renderPanel(variant);
    assert.doesNotMatch(html, /<figcaption|scripta-image-caption-control|Show caption/);
    assert.match(html, /class="scripta-variant-image-container is-selected"[\s\S]*<figure[\s\S]*<\/figure>[\s\S]*<\/div>/);
    assert.doesNotMatch(html, /scripta-variant-image-layout|Image options/);
    assert.equal(view.positionImageLayoutMenu, undefined);
});

test('image inspector reports its open state so a host rerender can restore it', () => {
    const emitted = [];
    const view = new ScriptaVariantsView({dispatchEvent() {}, contains: () => true}, () => {});
    view.emit = (type, detail) => emitted.push({type, detail});
    view.render = () => {};
    view.state.selectedVariantId = 'variant-1';
    view.setSelectedImage('image-1', 'variant-1');
    view.setSelectedImage('', '');
    assert.deepEqual(emitted, [
        {type: 'scripta-image-inspector-change', detail: {open: true, variantId: 'variant-1', imageId: 'image-1'}},
        {type: 'scripta-image-inspector-change', detail: {open: false, variantId: '', imageId: ''}},
    ]);
});

test('opening and closing image options mutates only the selected image container', () => {
    const view = new ScriptaVariantsView({dispatchEvent() {}, contains: () => true}, () => {});
    let fullRenders = 0;
    let insertedMenu = null;
    let removedMenus = 0;
    const figureClasses = new Set(['scripta-variant-image']);
    const containerClasses = new Set(['scripta-variant-image-container']);
    const figure = {classList: {toggle: (name, enabled) => enabled ? figureClasses.add(name) : figureClasses.delete(name)}};
    const container = {
        dataset: {variantId: 'variant-1', imageId: 'image-1'},
        classList: {toggle: (name, enabled) => enabled ? containerClasses.add(name) : containerClasses.delete(name)},
        querySelector: (selector) => {
            if (selector === '.scripta-variant-image') return figure;
            if (selector === '.scripta-variant-image-layout' && insertedMenu) {
                return {remove: () => { insertedMenu = null; removedMenus += 1; }};
            }
            return null;
        },
        append: (menu) => { insertedMenu = menu; },
    };
    view.root = {querySelectorAll: () => [container]};
    view.render = () => { fullRenders += 1; };
    view.state.editable = true;
    view.state.selectedVariantId = 'variant-1';
    view.state.variants = [{
        id: 'variant-1', ordinal: 1, canEdit: true, images: [{
            imageId: 'image-1', ordinal: 1,
            layout: {widthPercent: 80, aspectRatio: 'auto', fit: 'contain', alignment: 'center'},
        }],
    }];
    view.createImageLayoutMenu = () => ({className: 'scripta-variant-image-layout'});

    view.setSelectedImage('image-1', 'variant-1');
    assert.equal(fullRenders, 0);
    assert.equal(containerClasses.has('is-selected'), true);
    assert.equal(figureClasses.has('is-selected'), true);
    assert.equal(insertedMenu.className, 'scripta-variant-image-layout');

    view.setSelectedImage('', '');
    assert.equal(fullRenders, 0);
    assert.equal(containerClasses.has('is-selected'), false);
    assert.equal(figureClasses.has('is-selected'), false);
    assert.equal(insertedMenu, null);
    assert.equal(removedMenus, 1);
});

test('image option buttons use presenter actions and emit the canonical mutations', () => {
    const emitted = [];
    const view = new ScriptaVariantsView({dispatchEvent() {}, contains: () => true}, () => {});
    view.emit = (type, detail) => emitted.push({type, detail});
    view.root = {querySelector: () => null, querySelectorAll: () => []};
    view.state.selectedVariantId = 'variant-1';
    view.state.selectedImageId = 'image-1';
    view.state.variants = [{
        id: 'variant-1', ordinal: 2, text: '', canEdit: true, images: [{imageId: 'image-1'}],
    }];
    const target = {dataset: {variantId: 'variant-1', imageId: 'image-1', imageOrdinal: '3'}};

    view.replaceImage(target);
    view.deleteImage(target);
    view.closeImageLayout();

    assert.deepEqual(emitted, [
        {
            type: 'scripta-p-variant-image-replace',
            detail: {variantId: 'variant-1', variantOrdinal: 2, imageId: 'image-1', imageOrdinal: 3},
        },
        {
            type: 'scripta-p-variant-image-delete',
            detail: {variantId: 'variant-1', variantOrdinal: 2, imageId: 'image-1', imageOrdinal: 3},
        },
        {
            type: 'scripta-image-inspector-change',
            detail: {open: false, variantId: '', imageId: ''},
        },
    ]);
});

test('SCRIPTA variant owns inserted, replaced, and deleted images', () => {
    const document = createScriptaDocumentModel({ title: 'Media', template: 'general', createdBy: 'owner' });
    const chapter = document.chapters[0];
    const first = chapter.paragraphs[0];
    const variantId = first.pluginState.scripta.variants[0].id;
    const { document: changed, focusTarget } = mutateScriptaDocument(document, 'p-variant-image-insert', {
        chapterId: chapter.id,
        paragraphId: first.id,
        variantId,
        assetId: 'asset_1',
        alt: 'Architecture',
        workspaceUrl: '/WebMeet/story-room-1/assets/asset_1/one.png'
    }, { hash: 'owner' });
    assert.equal(changed.chapters[0].paragraphs.length, 1);
    assert.equal(focusTarget, null);
    const variant = changed.chapters[0].paragraphs[0].pluginState.scripta.variants[0];
    assert.equal(variant.text, '');
    assert.equal(variant.images.length, 1);
    assert.equal(variant.images[0].assetId, 'asset_1');
    assert.match(serializeMarkdownState(changed), /!\[Architecture\]\(\/WebMeet\/story-room-1\/assets\/asset_1\/one\.png\)/);
    const projection = projectScriptaDocument(changed, {
        view: { chapterId: chapter.id, paragraphId: first.id }
    });
    assert.equal(projection.paragraph.variants[0].images[0].assetId, 'asset_1');
    assert.equal(projection.chapters[0].paragraphs[0].images[0].assetId, 'asset_1');

    const imageId = variant.images[0].imageId;
    const {document: laidOut} = mutateScriptaDocument(changed, 'p-variant-image-layout', {
        chapterId: chapter.id, paragraphId: first.id, variantId, imageId,
        widthPercent: 55, aspectRatio: '16:9', fit: 'cover', alignment: 'right', showCaption: true,
    }, {hash: 'owner'});
    assert.deepEqual(laidOut.chapters[0].paragraphs[0].pluginState.scripta.variants[0].images[0].layout, {
        widthPercent: 55, aspectRatio: '16:9', fit: 'cover', alignment: 'right', showCaption: true,
    });
    const {document: captioned} = mutateScriptaDocument(laidOut, 'p-variant-image-layout', {
        chapterId: chapter.id, paragraphId: first.id, variantId, imageId,
        alt: 'Editable caption', showCaption: false,
    }, {hash: 'owner'});
    const captionedImage = captioned.chapters[0].paragraphs[0].pluginState.scripta.variants[0].images[0];
    assert.equal(captionedImage.alt, 'Editable caption');
    assert.equal(captionedImage.layout.showCaption, false);
    const { document: replaced } = mutateScriptaDocument(captioned, 'p-variant-image-replace', {
        chapterId: chapter.id, paragraphId: first.id, variantId, imageId,
        assetId: 'asset_2', alt: 'Replacement',
        workspaceUrl: '/WebMeet/story-room-1/assets/asset_2/two.png'
    }, { hash: 'owner' });
    assert.equal(replaced.chapters[0].paragraphs[0].pluginState.scripta.variants[0].images[0].assetId, 'asset_2');
    assert.equal(replaced.chapters[0].paragraphs[0].pluginState.scripta.variants[0].images[0].layout.widthPercent, 55);
    assert.equal(replaced.chapters[0].paragraphs[0].pluginState.scripta.variants[0].images[0].layout.showCaption, false);
    assert.match(serializeMarkdownState(replaced), /!\[Replacement\].*asset_2\/two\.png/);
    assert.throws(() => mutateScriptaDocument(replaced, 'p-variant-image-delete', {
        chapterId: chapter.id, paragraphId: first.id, variantId, imageId,
    }, { hash: 'another-user' }), /Only the participant/);
    const { document: removed } = mutateScriptaDocument(replaced, 'p-variant-image-delete', {
        chapterId: chapter.id, paragraphId: first.id, variantId, imageId,
    }, { hash: 'owner' });
    assert.equal(removed.chapters[0].paragraphs[0].pluginState.scripta.variants[0].images.length, 0);
    assert.doesNotMatch(serializeMarkdownState(removed), /asset_2\/two\.png/);

    const reopened = normalizeScriptaDocumentModel({
        metadata: { title: 'Document' },
        chapters: [{ title: 'Chapter 1', paragraphs: [{
            text: '![Architecture](/WebMeet/story-room-1/assets/asset_1/one.png)'
        }] }]
    }, { createdBy: 'owner' });
    const migrated = reopened.chapters[0].paragraphs[0].pluginState.scripta.variants[0];
    assert.equal(migrated.text, '');
    assert.equal(migrated.images[0].assetId, 'asset_1');
    assert.equal('media' in reopened.chapters[0].paragraphs[0].pluginState.scripta, false);

    const roundTrip = normalizeScriptaDocumentModel(parseMarkdownState(serializeMarkdownState(changed)).model, {
        createdBy: 'owner'
    });
    const roundTripVariant = roundTrip.chapters[0].paragraphs[0].pluginState.scripta.variants[0];
    assert.equal(roundTripVariant.id, variant.id);
    assert.equal(roundTripVariant.images[0].imageId, variant.images[0].imageId);
    assert.equal(roundTripVariant.images[0].assetId, 'asset_1');

    const legacyStandalone = normalizeScriptaDocumentModel({
        metadata: { title: 'Legacy' },
        chapters: [{ title: 'Chapter 1', paragraphs: [
            { text: 'Paragraph text' },
            {
                text: '![Legacy](/WebMeet/story-room-1/assets/asset_legacy/legacy.png)',
                metadata: {
                    type: 'image',
                    pluginState: {
                        scripta: {
                            media: {
                                assetId: 'asset_legacy',
                                alt: 'Legacy',
                                workspaceUrl: '/WebMeet/story-room-1/assets/asset_legacy/legacy.png'
                            }
                        }
                    }
                }
            }
        ] }]
    }, { createdBy: 'owner' });
    assert.equal(legacyStandalone.chapters[0].paragraphs.length, 1);
    const legacyVariant = legacyStandalone.chapters[0].paragraphs[0].pluginState.scripta.variants[0];
    assert.equal(legacyVariant.text, 'Paragraph text');
    assert.equal(legacyVariant.images[0].assetId, 'asset_legacy');

    const splitRegression = normalizeScriptaDocumentModel({
        metadata: { title: 'Stable image paragraph' },
        chapters: [{ title: 'Chapter 1', paragraphs: [{
            id: 'paragraph-stable',
            hasMetadata: false,
            text: 'Paragraph text\n\n![Image](/WebMeet/story-room-1/assets/asset_1/one.png)',
            metadata: { pluginState: changed.chapters[0].paragraphs[0].pluginState }
        }] }]
    }, { createdBy: 'owner' });
    const reopenedAgain = normalizeScriptaDocumentModel(splitRegression, { createdBy: 'owner' });
    assert.equal(splitRegression.chapters[0].paragraphs.length, 1);
    assert.equal(reopenedAgain.chapters[0].paragraphs.length, 1);

    const duplicatedPluginState = cloneVariantState(changed.chapters[0].paragraphs[0].pluginState);
    const duplicateRecovery = normalizeScriptaDocumentModel({
        metadata: { title: 'Duplicated' },
        chapters: [{ title: 'Chapter 1', paragraphs: [
            { id: 'paragraph-original', text: 'Original', metadata: { pluginState: duplicatedPluginState } },
            { id: 'paragraph-clone', text: 'Clone', metadata: { pluginState: duplicatedPluginState } }
        ] }]
    }, { createdBy: 'owner' });
    assert.equal(duplicateRecovery.chapters[0].paragraphs.length, 1);
});

function cloneVariantState(value) {
    return JSON.parse(JSON.stringify(value));
}
