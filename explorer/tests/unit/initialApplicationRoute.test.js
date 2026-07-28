import assert from 'node:assert/strict';
import test from 'node:test';

import {
    mountInitialApplicationRoute,
    resolveInitialHashedRoute
} from '../../services/runtime/initial-application-route.js';
import { loadStateFromURL } from '../../web-components/pages/file-exp/file-exp-navigation-controller.js';
import { normalizePath, parentPath } from '../../web-components/pages/file-exp/file-exp-utils.js';
import { FileExp } from '../../web-components/pages/file-exp/file-exp.js';

test('direct encoded Explorer hash is applied after mount to the exact decoded directory', async () => {
    const originalWindow = globalThis.window;
    const events = [];
    const pageElement = {
        renderCompletePromise: Promise.resolve(),
        webSkelPresenter: null
    };
    const pageContent = {
        querySelector(name) {
            assert.equal(name, 'file-exp');
            events.push('query-mounted-page');
            return pageElement;
        }
    };
    const fileExp = {
        state: {
            isEditing: false,
            directoryViewMode: 'list',
            path: '/'
        },
        normalizePath,
        parentPath,
        withLoader: async (operation) => operation(),
        loadDirectoryContent: async (directoryPath) => {
            assert.equal(directoryPath, '/Confidential');
            return [{
                name: 'My Space',
                path: '/Confidential/My Space',
                type: 'directory'
            }];
        },
        loadDirectory: async (directoryPath) => {
            fileExp.state.path = normalizePath(directoryPath);
        },
        showStatus() {
            throw new Error('The valid direct directory must not fall back to an error state.');
        }
    };
    const presenter = {
        state: fileExp.state,
        async applyInitialLocationRoute() {
            events.push('apply-initial-route');
            await loadStateFromURL(fileExp);
        }
    };
    const webSkel = {
        async changeToDynamicPage(pageName, url, props, preserveHash) {
            assert.equal(pageName, 'file-exp');
            assert.equal(url, 'file-exp/Confidential/My%20Space');
            assert.equal(props, null);
            assert.equal(preserveHash, true);
            events.push('mount-page');
            pageElement.webSkelPresenter = presenter;
        }
    };
    globalThis.window = {
        location: {
            hash: '#file-exp/Confidential/My%20Space'
        }
    };

    try {
        const route = resolveInitialHashedRoute(globalThis.window.location.hash);
        const result = await mountInitialApplicationRoute({ webSkel, pageContent, route });

        assert.equal(result, presenter);
        assert.equal(fileExp.state.path, '/Confidential/My Space');
        assert.deepEqual(events, [
            'mount-page',
            'query-mounted-page',
            'apply-initial-route'
        ]);
    } finally {
        globalThis.window = originalWindow;
    }
});

test('FileExp consumes the initial location route exactly once after listener registration', async () => {
    const fileExp = Object.create(FileExp.prototype);
    let applications = 0;
    let releaseFirstApplication;
    fileExp.initialLocationRouteApplied = false;
    fileExp.boundLoadStateFromURL = async () => {
        applications += 1;
        await new Promise((resolve) => {
            releaseFirstApplication = resolve;
        });
    };

    const first = fileExp.applyInitialLocationRoute();
    const second = await fileExp.applyInitialLocationRoute();
    assert.equal(second, false);
    assert.equal(applications, 1);

    releaseFirstApplication();
    assert.equal(await first, true);
    assert.equal(await fileExp.applyInitialLocationRoute(), false);
    assert.equal(applications, 1);
});

test('initial hashed route parser preserves encoded path bytes for the mounted page', () => {
    assert.deepEqual(
        resolveInitialHashedRoute('#file-exp/Confidential/My%20Space'),
        {
            pageName: 'file-exp',
            url: 'file-exp/Confidential/My%20Space',
            preserveHash: true
        }
    );
    assert.equal(resolveInitialHashedRoute(''), null);
    assert.equal(resolveInitialHashedRoute('#'), null);
});
