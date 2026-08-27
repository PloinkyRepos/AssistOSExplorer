import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {buildLogoutConfirmationUrl} from '../../web-components/pages/file-exp/file-exp-utils.js';

const fileExplorerHtml = fs.readFileSync(
    new URL('../../web-components/pages/file-exp/file-exp.html', import.meta.url),
    'utf8',
);

test('Explorer logout captures the current route for Cancel and subsequent sign in', () => {
    const currentPath = '/explorer/index.html?view=list#file-exp/repository/folder';
    const logoutUrl = new URL(buildLogoutConfirmationUrl({
        pathname: '/explorer/index.html',
        search: '?view=list',
        hash: '#file-exp/repository/folder',
    }), 'http://localhost');
    const loggedOutUrl = new URL(logoutUrl.searchParams.get('returnTo'), 'http://localhost');

    assert.equal(logoutUrl.pathname, '/auth/logout');
    assert.equal(logoutUrl.searchParams.get('cancelTo'), currentPath);
    assert.equal(loggedOutUrl.pathname, '/auth/logged-out');
    assert.equal(loggedOutUrl.searchParams.get('next'), currentPath);
    assert.match(fileExplorerHtml, /data-local-action="openLogoutConfirmation"/);
});
