import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildOnlyOfficeEditorConfig,
    buildPublicOfficeUrl,
    resolveOnlyOfficeSettings,
    rewriteOnlyOfficeDownloadUrl
} from '../../utils/server/onlyoffice/onlyoffice-config.mjs';

test('resolveOnlyOfficeSettings requires public url and jwt secret', () => {
    assert.throws(
        () => resolveOnlyOfficeSettings({}, { host: 'localhost:8080' }),
        /ONLYOFFICE_PUBLIC_URL/
    );

    assert.throws(
        () => resolveOnlyOfficeSettings(
            { ONLYOFFICE_PUBLIC_URL: 'https://office.example.com' },
            { host: 'localhost:8080' }
        ),
        /ONLYOFFICE_JWT_SECRET/
    );
});

test('OnlyOffice config builder signs config and uses router public urls', () => {
    const settings = resolveOnlyOfficeSettings({
        ONLYOFFICE_PUBLIC_URL: 'https://office.example.com/',
        ONLYOFFICE_INTERNAL_URL: 'http://onlyoffice:80',
        ONLYOFFICE_JWT_SECRET: 'secret-value'
    }, {
        host: 'app.example.com',
        'x-forwarded-proto': 'https'
    });

    const documentUrl = buildPublicOfficeUrl(settings, 'document/token-1');
    const callbackUrl = buildPublicOfficeUrl(settings, 'callback/token-1');
    const config = buildOnlyOfficeEditorConfig({
        settings,
        authInfo: {
            user: {
                id: 'u-1',
                username: 'qa1'
            }
        },
        session: {
            storageKind: 'workspace',
            storageId: '/tmp/report.docx',
            versionKey: 'v1',
            fileName: 'report.docx',
            canWrite: true,
            canComment: false
        },
        documentUrl,
        callbackUrl
    });

    assert.equal(config.documentServerUrl, 'https://office.example.com');
    assert.equal(config.document.url, 'https://app.example.com/public-services/explorer/office/document/token-1');
    assert.equal(config.editorConfig.callbackUrl, 'https://app.example.com/public-services/explorer/office/callback/token-1');
    assert.equal(config.documentType, 'word');
    assert.equal(config.editorConfig.user.name, 'qa1');
    assert.equal(config.document.permissions.edit, true);
    assert.equal(config.token.split('.').length, 3);
});

test('rewriteOnlyOfficeDownloadUrl swaps public url for internal url when configured', () => {
    const settings = resolveOnlyOfficeSettings({
        ONLYOFFICE_PUBLIC_URL: 'https://office.example.com',
        ONLYOFFICE_INTERNAL_URL: 'http://onlyoffice:80',
        ONLYOFFICE_JWT_SECRET: 'secret-value'
    }, {
        host: 'app.example.com',
        'x-forwarded-proto': 'https'
    });

    assert.equal(
        rewriteOnlyOfficeDownloadUrl('https://office.example.com/cache/files/report.docx', settings),
        'http://onlyoffice:80/cache/files/report.docx'
    );
    assert.equal(
        rewriteOnlyOfficeDownloadUrl('https://cdn.example.com/report.docx', settings),
        'https://cdn.example.com/report.docx'
    );
});
