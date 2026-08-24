import test from 'node:test';
import assert from 'node:assert/strict';

import { AppMenu } from '../../web-components/components/app-menu/app-menu.js';

function createElement(attributes = {}) {
    const values = new Map(Object.entries(attributes));
    return {
        getAttribute(name) {
            return values.get(name) ?? null;
        },
        setAttribute(name, value) {
            values.set(name, String(value));
        },
        dispatchEvent() {}
    };
}

test('app menu keeps loaded items visible while other items are loading', () => {
    const menu = new AppMenu(createElement(), () => {}, {
        items: [
            { id: 'ready', label: 'Ready action' },
            { id: 'pending', label: 'Plugin action', loading: true }
        ]
    });

    assert.match(menu.itemsMarkup, /Ready action/);
    assert.match(menu.itemsMarkup, /Plugin action/);
    assert.match(menu.itemsMarkup, /app-menu-item-spinner/);
    assert.match(menu.itemsMarkup, /aria-busy="true"/);
});

test('app menu only disables the item that is still loading', () => {
    const menu = new AppMenu(createElement(), () => {}, {
        items: [
            { id: 'ready', label: 'Ready action' },
            { id: 'pending', label: 'Pending action', loading: true }
        ]
    });
    const markup = menu.itemsMarkup;
    const readyButton = markup.match(/<button[^>]*data-item-id="ready"[^>]*>/)?.[0] || '';
    const pendingButton = markup.match(/<button[^>]*data-item-id="pending"[^>]*>/)?.[0] || '';

    assert.doesNotMatch(readyButton, /disabled/);
    assert.match(pendingButton, /disabled/);
    assert.match(pendingButton, /is-loading/);
});

test('an item loading spinner occupies the icon position until the item resolves', () => {
    const menu = new AppMenu(createElement(), () => {}, {
        items: [{ id: 'pending', label: 'Pending action', icon: '/plugin.svg', loading: true }]
    });

    const markup = menu.itemsMarkup;
    assert.doesNotMatch(markup, /<img/);
    assert.match(markup, /app-menu-item-spinner[\s\S]*app-menu-item-label/);
});

test('menu item updates do not rebuild the host menu', () => {
    const previousDocument = globalThis.document;
    let invalidations = 0;
    let replacements = 0;
    const root = { classList: { toggle() {} } };
    const list = {
        replaceChildren() {
            replacements += 1;
        },
        closest() {
            return root;
        }
    };
    const element = {
        ...createElement(),
        querySelector(selector) {
            return selector === '#appMenuList' ? list : null;
        }
    };
    globalThis.document = {
        createElement() {
            return { innerHTML: '', content: {} };
        }
    };
    const menu = new AppMenu(element, () => {
        invalidations += 1;
    }, {
        items: [
            { id: 'ready', label: 'Ready action' }
        ]
    });

    try {
        menu.handleItemsSet({
            detail: {
                items: [
                    { id: 'ready', label: 'Ready action' },
                    { id: 'git:commit', label: 'Commit' }
                ]
            }
        });

        assert.deepEqual(menu.items.map((item) => item.id), ['ready', 'git:commit']);
        assert.equal(menu.loading, false);
        assert.equal(invalidations, 1);
        assert.equal(replacements, 1);
    } finally {
        globalThis.document = previousDocument;
    }
});
