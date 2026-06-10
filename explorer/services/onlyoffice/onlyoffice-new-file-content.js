import { getOnlyOfficeFileType } from './onlyoffice-file-types.js';

const BLANK_DOC_RTF = [
    '{\\rtf1\\ansi\\deff0',
    '{\\fonttbl{\\f0 Arial;}}',
    '\\viewkind4\\uc1\\pard\\f0\\fs22\\par',
    '}'
].join('');

function encodeUtf8Base64(value) {
    if (globalThis.Buffer?.from) {
        return globalThis.Buffer.from(value, 'utf8').toString('base64');
    }

    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
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

    return {
        content: '',
        dpuContent: '',
        mimeType: ''
    };
}

