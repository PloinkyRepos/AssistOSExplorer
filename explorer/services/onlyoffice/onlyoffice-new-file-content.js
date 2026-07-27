import { getOnlyOfficeFileType } from './onlyoffice-file-types.js';

const BLANK_DOC_RTF = [
    '{\\rtf1\\ansi\\deff0',
    '{\\fonttbl{\\f0 Arial;}}',
    '\\viewkind4\\uc1\\pard\\f0\\fs22\\par',
    '}'
].join('');

const BLANK_DOCX_PARTS = Object.freeze({
    '[Content_Types].xml': [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
        '<Default Extension="xml" ContentType="application/xml"/>',
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
        '</Types>'
    ].join(''),
    '_rels/.rels': [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
        '</Relationships>'
    ].join(''),
    'word/document.xml': [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
        '<w:body><w:p/><w:sectPr/></w:body>',
        '</w:document>'
    ].join('')
});

function encodeBytesBase64(bytes) {
    if (globalThis.Buffer?.from) {
        return globalThis.Buffer.from(bytes).toString('base64');
    }

    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

function encodeUtf8Base64(value) {
    return encodeBytesBase64(new TextEncoder().encode(value));
}

function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function appendUint16(target, value) {
    target.push(value & 0xff, (value >>> 8) & 0xff);
}

function appendUint32(target, value) {
    target.push(
        value & 0xff,
        (value >>> 8) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 24) & 0xff
    );
}

function appendBytes(target, bytes) {
    for (const byte of bytes) {
        target.push(byte);
    }
}

function buildStoredZip(parts) {
    const encoder = new TextEncoder();
    const archive = [];
    const centralDirectory = [];

    for (const [name, content] of Object.entries(parts)) {
        const nameBytes = encoder.encode(name);
        const contentBytes = encoder.encode(content);
        const checksum = crc32(contentBytes);
        const localOffset = archive.length;

        appendUint32(archive, 0x04034b50);
        appendUint16(archive, 20);
        appendUint16(archive, 0);
        appendUint16(archive, 0);
        appendUint16(archive, 0);
        appendUint16(archive, 0);
        appendUint32(archive, checksum);
        appendUint32(archive, contentBytes.length);
        appendUint32(archive, contentBytes.length);
        appendUint16(archive, nameBytes.length);
        appendUint16(archive, 0);
        appendBytes(archive, nameBytes);
        appendBytes(archive, contentBytes);

        appendUint32(centralDirectory, 0x02014b50);
        appendUint16(centralDirectory, 20);
        appendUint16(centralDirectory, 20);
        appendUint16(centralDirectory, 0);
        appendUint16(centralDirectory, 0);
        appendUint16(centralDirectory, 0);
        appendUint16(centralDirectory, 0);
        appendUint32(centralDirectory, checksum);
        appendUint32(centralDirectory, contentBytes.length);
        appendUint32(centralDirectory, contentBytes.length);
        appendUint16(centralDirectory, nameBytes.length);
        appendUint16(centralDirectory, 0);
        appendUint16(centralDirectory, 0);
        appendUint16(centralDirectory, 0);
        appendUint16(centralDirectory, 0);
        appendUint32(centralDirectory, 0);
        appendUint32(centralDirectory, localOffset);
        appendBytes(centralDirectory, nameBytes);
    }

    const centralOffset = archive.length;
    appendBytes(archive, centralDirectory);
    appendUint32(archive, 0x06054b50);
    appendUint16(archive, 0);
    appendUint16(archive, 0);
    appendUint16(archive, Object.keys(parts).length);
    appendUint16(archive, Object.keys(parts).length);
    appendUint32(archive, centralDirectory.length);
    appendUint32(archive, centralOffset);
    appendUint16(archive, 0);
    return Uint8Array.from(archive);
}

export function getNewFileInitialContent(fileName) {
    const officeType = getOnlyOfficeFileType(fileName);
    if (officeType?.extension === 'doc') {
        return {
            content: BLANK_DOC_RTF,
            dpuContent: encodeUtf8Base64(BLANK_DOC_RTF),
            mimeType: officeType.mimeType
        };
    }
    if (officeType?.extension === 'docx') {
        return {
            content: '',
            dpuContent: encodeBytesBase64(buildStoredZip(BLANK_DOCX_PARTS)),
            mimeType: officeType.mimeType
        };
    }

    return {
        content: '',
        dpuContent: '',
        mimeType: ''
    };
}
