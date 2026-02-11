import test from 'node:test';
import assert from 'node:assert/strict';
import { PREVIEW_ACTIONS, previewReducer } from '../../web-components/pages/file-exp/file-exp-preview-controller.js';

function createState(overrides = {}) {
    return {
        selectedPath: '/docs/a.html',
        previewViewMode: 'code',
        webViewUrl: '',
        webViewReloadToken: 0,
        webViewCodePaneHidden: false,
        webViewPaneHidden: false,
        ...overrides
    };
}

test('SYNC_PATH sets web url for html files', () => {
    const state = createState({ selectedPath: '/docs/a.html' });
    const transition = previewReducer(state, {
        type: PREVIEW_ACTIONS.SYNC_PATH,
        payload: {
            path: '/docs/a.html',
            buildWebViewUrl: (path) => path
        }
    });

    assert.equal(transition.changed, true);
    assert.equal(transition.patch.webViewUrl, '/docs/a.html');
    assert.equal(transition.patch.webViewCodePaneHidden, false);
    assert.equal(transition.patch.webViewPaneHidden, false);
});

test('SYNC_PATH resets preview state for non-html files', () => {
    const state = createState({
        selectedPath: '/docs/readme.md',
        previewViewMode: 'split',
        webViewUrl: '/docs/a.html',
        webViewReloadToken: 3,
        webViewCodePaneHidden: true,
        webViewPaneHidden: true
    });

    const transition = previewReducer(state, {
        type: PREVIEW_ACTIONS.SYNC_PATH,
        payload: { path: '/docs/readme.md' }
    });

    assert.equal(transition.changed, true);
    assert.equal(transition.patch.previewViewMode, 'code');
    assert.equal(transition.patch.webViewUrl, '');
    assert.equal(transition.patch.webViewReloadToken, 0);
    assert.equal(transition.patch.webViewCodePaneHidden, false);
    assert.equal(transition.patch.webViewPaneHidden, false);
});

test('SET_VIEW_MODE supports code/web/split transitions', () => {
    let state = createState({ previewViewMode: 'code' });

    let transition = previewReducer(state, {
        type: PREVIEW_ACTIONS.SET_VIEW_MODE,
        payload: { mode: 'web' }
    });
    assert.equal(transition.changed, true);
    assert.equal(transition.patch.previewViewMode, 'web');

    state = { ...state, ...transition.patch };
    transition = previewReducer(state, {
        type: PREVIEW_ACTIONS.SET_VIEW_MODE,
        payload: { mode: 'split' }
    });
    assert.equal(transition.changed, true);
    assert.equal(transition.patch.previewViewMode, 'split');

    state = { ...state, ...transition.patch };
    transition = previewReducer(state, {
        type: PREVIEW_ACTIONS.SET_VIEW_MODE,
        payload: { mode: 'code' }
    });
    assert.equal(transition.changed, true);
    assert.equal(transition.patch.previewViewMode, 'code');
});

test('REFRESH increments token only for html path', () => {
    const htmlState = createState({
        selectedPath: '/docs/a.html',
        webViewReloadToken: 2
    });
    const htmlTransition = previewReducer(htmlState, {
        type: PREVIEW_ACTIONS.REFRESH,
        payload: { path: '/docs/a.html' }
    });
    assert.equal(htmlTransition.changed, true);
    assert.equal(htmlTransition.patch.webViewReloadToken, 3);

    const nonHtmlState = createState({
        selectedPath: '/docs/readme.md',
        webViewReloadToken: 2
    });
    const nonHtmlTransition = previewReducer(nonHtmlState, {
        type: PREVIEW_ACTIONS.REFRESH,
        payload: { path: '/docs/readme.md' }
    });
    assert.equal(nonHtmlTransition.changed, false);
});

