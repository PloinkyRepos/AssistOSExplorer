import { isOnlyOfficeFile } from './onlyoffice-file-types.js';

function buildSessionUrl(filePath) {
    const params = new URLSearchParams({ path: String(filePath || '') });
    return `/services/onlyoffice/office/session?${params.toString()}`;
}

async function readJsonResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        return await response.json();
    }
    const text = await response.text();
    return text ? { ok: false, error: text } : {};
}

export async function fetchOnlyOfficeSession(filePath) {
    const response = await fetch(buildSessionUrl(filePath), {
        method: 'GET',
        credentials: 'same-origin',
        headers: {
            accept: 'application/json'
        }
    });
    const payload = await readJsonResponse(response);
    if (!response.ok || payload?.ok === false) {
        const errorMessage = payload?.error || `OnlyOffice session request failed with ${response.status}.`;
        throw new Error(errorMessage);
    }
    return payload;
}

export async function tryLoadOnlyOfficePreview(fileExp, filePath, { invalidate = true } = {}) {
    if (!isOnlyOfficeFile(filePath)) {
        return false;
    }

    const session = await fetchOnlyOfficeSession(filePath);
    const preview = session?.preview && typeof session.preview === 'object' ? session.preview : {};

    fileExp.setPreviewState({
        previewMode: 'onlyoffice',
        mediaType: null,
        previewContent: '',
        selectedIsMarkdown: false,
        fileContent: '',
        markdownTextView: false,
        documentId: null,
        hasUnsavedChanges: false,
        isEditing: false,
        onlyOfficeConfig: session?.config || null,
        onlyOfficeStatusText: '',
        dpuSelectedObjectId: preview.objectId || null,
        dpuSelectedCanWrite: Boolean(preview.canWrite),
        dpuSelectedCanComment: Boolean(preview.canComment),
        dpuSelectedCommentCount: 0,
        dpuSelectedComments: [],
        dpuCommentsOpen: false,
        fileLoadInfo: null
    });

    if (invalidate) {
        fileExp.invalidate();
    } else {
        fileExp.refreshPreviewUi();
    }
    return true;
}
