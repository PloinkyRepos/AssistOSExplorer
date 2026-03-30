import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getOnlyOfficeDocumentType,
    getOnlyOfficeFileType,
    isOnlyOfficeFile
} from '../../services/onlyoffice/onlyoffice-file-types.js';

test('OnlyOffice file type helpers recognize supported extensions', () => {
    assert.equal(isOnlyOfficeFile('/docs/report.doc'), true);
    assert.equal(isOnlyOfficeFile('/docs/report.docx'), true);
    assert.equal(isOnlyOfficeFile('/docs/report.odt'), true);
    assert.equal(isOnlyOfficeFile('/docs/report.xls'), true);
    assert.equal(isOnlyOfficeFile('/docs/report.xlsx'), true);
    assert.equal(isOnlyOfficeFile('/docs/report.ods'), true);
    assert.equal(isOnlyOfficeFile('/docs/report.csv'), true);
    assert.equal(isOnlyOfficeFile('/docs/report.ppt'), true);
    assert.equal(isOnlyOfficeFile('/docs/report.pptx'), true);
    assert.equal(isOnlyOfficeFile('/docs/report.odp'), true);
    assert.equal(isOnlyOfficeFile('/docs/report.pdf'), true);
    assert.equal(isOnlyOfficeFile('/docs/report.md'), false);

    assert.equal(getOnlyOfficeDocumentType('/docs/report.doc'), 'word');
    assert.equal(getOnlyOfficeDocumentType('/docs/report.docx'), 'word');
    assert.equal(getOnlyOfficeDocumentType('/docs/report.odt'), 'word');
    assert.equal(getOnlyOfficeDocumentType('/docs/report.xls'), 'cell');
    assert.equal(getOnlyOfficeDocumentType('/docs/report.xlsx'), 'cell');
    assert.equal(getOnlyOfficeDocumentType('/docs/report.ods'), 'cell');
    assert.equal(getOnlyOfficeDocumentType('/docs/report.csv'), 'cell');
    assert.equal(getOnlyOfficeDocumentType('/docs/report.ppt'), 'slide');
    assert.equal(getOnlyOfficeDocumentType('/docs/report.pptx'), 'slide');
    assert.equal(getOnlyOfficeDocumentType('/docs/report.odp'), 'slide');
    assert.equal(getOnlyOfficeDocumentType('/docs/report.pdf'), 'pdf');
    assert.equal(getOnlyOfficeDocumentType('/docs/report.txt'), '');

    assert.equal(
        getOnlyOfficeFileType('/docs/report.docx')?.mimeType,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    assert.equal(
        getOnlyOfficeFileType('/docs/report.pdf')?.mimeType,
        'application/pdf'
    );
});
