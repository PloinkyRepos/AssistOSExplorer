import {
    callAgentTool,
    ensureSuccess,
    extractToolText,
    parseToolResult,
    ToolError
} from "../../../services/infrastructure/explorerApi.js";
import {
    DPU_MY_SPACE_PATH,
    DPU_ROOT_PATH,
    DPU_SECRETS_PATH,
    DPU_SHARED_PATH,
    isDpuSecretPath as isAnyDpuSecretPath,
    isDpuVirtualPath as isAnyDpuVirtualPath,
    normalizeDpuPath,
    resolveDpuSecretKey
} from "../../../services/dpu/dpuPaths.js";
import { annotateSharedEntries, resolveDpuConfidentialNodeAtPath } from "../../../services/dpu/dpuPathResolver.js";
import {
    isDpuFileType,
    isDpuFolderType,
    normalizeDpuObjectType,
    toExplorerEntryType
} from "../../../services/dpu/dpuTypes.js";
import {
    renderCodePreview
} from "./file-exp-utils.js";

export {
    DPU_ROOT_PATH,
    DPU_MY_SPACE_PATH,
    DPU_SHARED_PATH,
    DPU_SECRETS_PATH
};

function isSecretsRootPath(path) {
    return normalizeDpuPath(path) === DPU_SECRETS_PATH;
}

function hasDpuClient() {
    return Boolean(window.webSkel?.appServices?.getClient?.('dpuAgent'));
}

async function ensureDpuCommentsComponentRegistered() {
    const ensureComponentRegistered = window.assistOS?.webSkel?.ensureComponentRegistered;
    if (typeof ensureComponentRegistered !== 'function') {
        return;
    }
    await ensureComponentRegistered('dpu-comments-popover');
}

function getDpuCache(fileExp) {
    if (!fileExp.__dpuVirtualState) {
        fileExp.__dpuVirtualState = {
            roots: null,
            nodesByPath: new Map()
        };
    }
    return fileExp.__dpuVirtualState;
}

function normalizeManagedPath(fileExp, input) {
    return normalizeDpuPath(fileExp.normalizePath(String(input || '')));
}

function makeEntry(name, type, extra = {}) {
    return {
        name,
        type,
        size: null,
        modified: null,
        virtualProvider: 'dpu',
        ...extra
    };
}

function indexNode(fileExp, path, node) {
    const cache = getDpuCache(fileExp);
    cache.nodesByPath.set(normalizeManagedPath(fileExp, path), {
        ...node,
        path: normalizeManagedPath(fileExp, path),
        virtualProvider: 'dpu'
    });
}

function resetDpuCache(fileExp) {
    fileExp.__dpuVirtualState = {
        roots: null,
        nodesByPath: new Map()
    };
}

function getIndexedNode(fileExp, path) {
    const cache = getDpuCache(fileExp);
    return cache.nodesByPath.get(normalizeManagedPath(fileExp, path)) || null;
}

async function callDpuTool(toolName, args = {}) {
    const raw = await callAgentTool('dpuAgent', toolName, args, { raw: true });
    ensureSuccess(raw);
    const parsed = parseToolResult(raw);
    if (!parsed || typeof parsed !== 'object') {
        const detail = extractToolText(raw).trim();
        throw new ToolError(
            'invalid_dpu_response',
            detail ? `Invalid DPU response for ${toolName}: ${detail}` : `Invalid DPU response for ${toolName}.`
        );
    }
    if (parsed.ok === false) {
        throw new ToolError('dpu_error', parsed.error || `DPU call failed: ${toolName}`, parsed);
    }
    return parsed;
}

async function getDpuRoots(fileExp) {
    const cache = getDpuCache(fileExp);
    if (cache.roots) {
        return cache.roots;
    }
    const parsed = await callDpuTool('dpu_workspace_roots');
    cache.roots = parsed.roots || {};
    indexNode(fileExp, DPU_ROOT_PATH, {
        kind: 'root',
        type: 'directory',
        canWrite: false,
        canCreateChildren: false,
        immutableRoot: true
    });
    indexNode(fileExp, DPU_MY_SPACE_PATH, {
        kind: 'my-space-root',
        type: 'directory',
        objectId: cache.roots?.mySpace?.id || '',
        canWrite: true,
        canCreateChildren: true,
        immutableRoot: true
    });
    indexNode(fileExp, DPU_SHARED_PATH, {
        kind: 'shared-root',
        type: 'directory',
        canWrite: false,
        canCreateChildren: false,
        immutableRoot: true
    });
    indexNode(fileExp, DPU_SECRETS_PATH, {
        kind: 'secrets-root',
        type: 'directory',
        canWrite: true,
        canCreateChildren: false,
        canCreateFiles: true,
        canCreateDirectories: false,
        immutableRoot: true
    });
    return cache.roots;
}

function createRootEntries(fileExp, roots = {}) {
    indexNode(fileExp, DPU_MY_SPACE_PATH, {
        kind: 'my-space-root',
        type: 'directory',
        objectId: roots?.mySpace?.id || '',
        canWrite: true,
        canCreateChildren: true,
        immutableRoot: true
    });
    indexNode(fileExp, DPU_SHARED_PATH, {
        kind: 'shared-root',
        type: 'directory',
        canWrite: false,
        canCreateChildren: false,
        immutableRoot: true
    });
    indexNode(fileExp, DPU_SECRETS_PATH, {
        kind: 'secrets-root',
        type: 'directory',
        canWrite: true,
        canCreateChildren: false,
        canCreateFiles: true,
        canCreateDirectories: false,
        immutableRoot: true
    });
    return [
        {
            ...makeEntry('My Space', 'directory'),
            dpuCanWrite: true,
            dpuCanCreateChildren: true,
            dpuImmutableRoot: true,
            path: DPU_MY_SPACE_PATH
        },
        {
            ...makeEntry('Shared', 'directory'),
            path: DPU_SHARED_PATH
        },
        {
            ...makeEntry('Secrets', 'directory'),
            path: DPU_SECRETS_PATH
        }
    ];
}

function createSecretEntry(fileExp, secret) {
    const entryPath = fileExp.joinPath(DPU_SECRETS_PATH, secret.key);
    indexNode(fileExp, entryPath, {
        kind: 'secret',
        type: 'file',
        key: secret.key,
        secretId: secret.id,
        role: secret.role || '',
        updatedAt: secret.updatedAt || '',
        canWrite: Boolean(secret.canWrite)
    });
    return {
        ...makeEntry(secret.key, 'file', {
            modified: secret.updatedAt || null,
            dpuCanWrite: Boolean(secret.canWrite)
        }),
        path: entryPath
    };
}

function createConfidentialEntry(fileExp, basePath, objectRecord, kind = 'confidential', options = {}) {
    const objectType = normalizeDpuObjectType(objectRecord.type);
    const entryName = String(options.virtualName || objectRecord.name || '').trim();
    const entryPath = fileExp.joinPath(basePath, entryName);
    const canWrite = Boolean(objectRecord.canWrite);
    indexNode(fileExp, entryPath, {
        kind,
        type: objectType,
        objectId: objectRecord.id,
        ownerId: objectRecord.ownerId || '',
        role: objectRecord.role || '',
        updatedAt: objectRecord.updatedAt || '',
        name: entryName,
        actualName: objectRecord.name,
        canWrite,
        canCreateChildren: isDpuFolderType(objectType) && canWrite,
        canCreateFiles: isDpuFolderType(objectType) && canWrite,
        canCreateDirectories: isDpuFolderType(objectType) && canWrite,
        immutableRoot: false
    });
    return {
        ...makeEntry(entryName, toExplorerEntryType(objectType), {
            modified: objectRecord.updatedAt || null,
            dpuCanWrite: canWrite,
            dpuCanCreateChildren: isDpuFolderType(objectType) && canWrite,
            dpuImmutableRoot: false
        }),
        path: entryPath
    };
}

async function resolveMySpaceNode(fileExp, normalizedPath) {
    const cached = getIndexedNode(fileExp, normalizedPath);
    if (cached) return cached;

    if (normalizedPath === DPU_MY_SPACE_PATH) {
        return getIndexedNode(fileExp, DPU_MY_SPACE_PATH);
    }

    const objectRecord = await resolveDpuConfidentialNodeAtPath(normalizedPath, {
        getRoots: async () => getDpuRoots(fileExp),
        listConfidential: async (args) => callDpuTool('dpu_confidential_list', args)
    });
    if (!objectRecord) {
        return null;
    }
    createConfidentialEntry(fileExp, fileExp.parentPath(normalizedPath) || DPU_MY_SPACE_PATH, objectRecord);
    return getIndexedNode(fileExp, normalizedPath);
}

async function resolveSharedNode(fileExp, normalizedPath) {
    const cached = getIndexedNode(fileExp, normalizedPath);
    if (cached) return cached;

    if (normalizedPath === DPU_SHARED_PATH) {
        await getDpuRoots(fileExp);
        return getIndexedNode(fileExp, DPU_SHARED_PATH);
    }

    const objectRecord = await resolveDpuConfidentialNodeAtPath(normalizedPath, {
        getRoots: async () => getDpuRoots(fileExp),
        listConfidential: async (args) => callDpuTool('dpu_confidential_list', args)
    });
    if (!objectRecord) {
        return null;
    }
    createConfidentialEntry(
        fileExp,
        fileExp.parentPath(normalizedPath) || DPU_SHARED_PATH,
        objectRecord,
        'shared-object',
        normalizedPath === fileExp.joinPath(DPU_SHARED_PATH, objectRecord.virtualName || '')
            ? { virtualName: objectRecord.virtualName }
            : {}
    );
    return getIndexedNode(fileExp, normalizedPath);
}

async function resolveSecretNode(fileExp, normalizedPath) {
    const cached = getIndexedNode(fileExp, normalizedPath);
    if (cached) return cached;

    const secretKey = resolveDpuSecretKey(normalizedPath);
    if (!secretKey) {
        return null;
    }
    const secrets = await callDpuTool('dpu_secret_list');
    const secret = Array.isArray(secrets.secrets)
        ? secrets.secrets.find((item) => item?.key === secretKey)
        : null;
    if (!secret) {
        return null;
    }
    createSecretEntry(fileExp, secret);
    return getIndexedNode(fileExp, normalizedPath);
}

export function isDpuVirtualPath(path) {
    return isAnyDpuVirtualPath(path);
}

export function isDpuSecretPath(path) {
    return isAnyDpuSecretPath(path);
}

export function isDpuManagedPath(path) {
    return isDpuVirtualPath(path);
}

export function shouldExposeDpuRoot() {
    return hasDpuClient();
}

export async function mergeDpuRootEntry(fileExp, entries = []) {
    if (!shouldExposeDpuRoot()) {
        return Array.isArray(entries) ? entries : [];
    }
    const filtered = (Array.isArray(entries) ? entries : []).filter((entry) => String(entry?.name || '') !== 'Confidential');
    return [
        ...filtered,
        {
            ...makeEntry('Confidential', 'directory'),
            path: DPU_ROOT_PATH
        }
    ];
}

export async function resolveDpuNode(fileExp, path) {
    const normalizedPath = normalizeManagedPath(fileExp, path);
    if (!isDpuVirtualPath(normalizedPath)) {
        return null;
    }

    if (normalizedPath === DPU_ROOT_PATH) {
        await getDpuRoots(fileExp);
        return getIndexedNode(fileExp, DPU_ROOT_PATH);
    }
    if (normalizedPath === DPU_MY_SPACE_PATH || normalizedPath.startsWith(`${DPU_MY_SPACE_PATH}/`)) {
        return resolveMySpaceNode(fileExp, normalizedPath);
    }
    if (normalizedPath === DPU_SHARED_PATH || normalizedPath.startsWith(`${DPU_SHARED_PATH}/`)) {
        return resolveSharedNode(fileExp, normalizedPath);
    }
    if (normalizedPath === DPU_SECRETS_PATH || normalizedPath.startsWith(`${DPU_SECRETS_PATH}/`)) {
        return resolveSecretNode(fileExp, normalizedPath);
    }

    return null;
}

export async function listDpuDirectory(fileExp, path) {
    const normalizedPath = normalizeManagedPath(fileExp, path);
    const roots = await getDpuRoots(fileExp);

    if (normalizedPath === DPU_ROOT_PATH) {
        return createRootEntries(fileExp, roots);
    }

    if (normalizedPath === DPU_SECRETS_PATH) {
        const parsed = await callDpuTool('dpu_secret_list');
        return (Array.isArray(parsed.secrets) ? parsed.secrets : [])
            .map((secret) => createSecretEntry(fileExp, secret));
    }

    if (normalizedPath === DPU_SHARED_PATH) {
        const parsed = await callDpuTool('dpu_confidential_list', { scope: 'shared' });
        return annotateSharedEntries(parsed.items)
            .map((item) => createConfidentialEntry(fileExp, DPU_SHARED_PATH, item, 'shared-object', {
                virtualName: item.virtualName
            }));
    }

    if (normalizedPath.startsWith(`${DPU_SHARED_PATH}/`)) {
        const parentNode = await resolveSharedNode(fileExp, normalizedPath);
        if (!parentNode || !isDpuFolderType(parentNode.type) || !parentNode.objectId) {
            return [];
        }
        const parsed = await callDpuTool('dpu_confidential_list', {
            scope: 'my-space',
            parentId: parentNode.objectId
        });
        return (Array.isArray(parsed.items) ? parsed.items : [])
            .map((item) => createConfidentialEntry(fileExp, normalizedPath, item, 'shared-object'));
    }

    const parentNode = await resolveMySpaceNode(fileExp, normalizedPath);
    if (!parentNode || !isDpuFolderType(parentNode.type) || !parentNode.objectId) {
        return [];
    }
    const parsed = await callDpuTool('dpu_confidential_list', {
        scope: 'my-space',
        parentId: parentNode.objectId
    });
    return (Array.isArray(parsed.items) ? parsed.items : [])
        .map((item) => createConfidentialEntry(fileExp, normalizedPath, item));
}

function buildSecretPreview(secret) {
    if (secret.valueVisible) {
        return String(secret.value ?? '');
    }
    if (secret.valueMasked) {
        return [
            `Key: ${secret.key}`,
            `Owner: ${secret.ownerId || '—'}`,
            `Role: ${secret.role || '—'}`,
            '',
            'Value is hidden.',
            'You have access to this secret, but not read permission.'
        ].join('\n');
    }
    return [
        `Key: ${secret.key}`,
        `Owner: ${secret.ownerId || '—'}`,
        `Role: ${secret.role || '—'}`,
        '',
        'Value is unavailable.'
    ].join('\n');
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

export async function openDpuFile(fileExp, filePath, { invalidate = true } = {}) {
    const normalizedPath = normalizeManagedPath(fileExp, filePath);
    const node = await resolveDpuNode(fileExp, normalizedPath);
    if (!node) {
        throw new Error(`Confidential resource not found: ${normalizedPath}`);
    }

    if (node.kind === 'secret') {
        const parsed = await callDpuTool('dpu_secret_get', { key: node.key });
        const secret = parsed.secret || {};
        const fileContent = buildSecretPreview(secret);
        fileExp.setPreviewState({
            fileContent,
            previewContent: renderCodePreview(fileContent, `${secret.key || 'secret'}.txt`),
            selectedIsMarkdown: false,
            previewMode: 'code',
            mediaType: null,
            fileLoadInfo: null,
            markdownTextView: false,
            documentId: null,
            dpuSelectedObjectId: null,
            dpuSelectedCanWrite: Boolean(secret.canWrite),
            dpuSelectedCanComment: false,
            dpuSelectedCommentCount: 0,
            dpuSelectedComments: [],
            dpuCommentsOpen: false,
            hasUnsavedChanges: false,
            isEditing: false
        });
        if (invalidate) {
            fileExp.invalidate();
        } else {
            fileExp.refreshPreviewUi();
        }
        return;
    }

    if (node.kind === 'confidential' || node.kind === 'shared-object') {
        await ensureDpuCommentsComponentRegistered();
        const parsed = await callDpuTool('dpu_confidential_get', { id: node.objectId });
        const objectRecord = parsed.object || {};
        const objectType = normalizeDpuObjectType(objectRecord.type, node.type);
        if (!isDpuFileType(objectType)) {
            throw new Error(`Confidential object is not a file: ${normalizedPath}`);
        }
        const content = String(objectRecord.content ?? '');
        const canRead = Boolean(objectRecord.contentVisible);
        const comments = Array.isArray(objectRecord.comments) ? objectRecord.comments : [];
        const fileContent = canRead
            ? content
            : [
                `File: ${objectRecord.name}`,
                `Owner: ${objectRecord.ownerId || '—'}`,
                `Role: ${objectRecord.role || '—'}`,
                '',
                'Content is hidden.',
                'You have access to this file, but not read permission.'
            ].join('\n');
        const previewContent = renderCodePreview(fileContent, objectRecord.name || '');

        fileExp.setPreviewState({
            fileContent,
            previewContent,
            selectedIsMarkdown: false,
            previewMode: 'code',
            mediaType: null,
            fileLoadInfo: null,
            markdownTextView: false,
            documentId: null,
            dpuSelectedObjectId: objectRecord.id || null,
            dpuSelectedCanWrite: Boolean(objectRecord.canWrite),
            dpuSelectedCanComment: Boolean(objectRecord.canComment),
            dpuSelectedCommentCount: Number.parseInt(String(objectRecord.commentCount || 0), 10) || 0,
            dpuSelectedComments: comments,
            dpuCommentsOpen: false,
            hasUnsavedChanges: false,
            isEditing: false
        });
        if (invalidate) {
            fileExp.invalidate();
        } else {
            fileExp.refreshPreviewUi();
        }
        return;
    }

    throw new Error(`Unsupported confidential resource: ${normalizedPath}`);
}

export async function getDpuPathCapabilities(fileExp, path) {
    const normalizedPath = normalizeManagedPath(fileExp, path);
    if (!isDpuManagedPath(normalizedPath)) {
        return {
            isDpu: false,
            canWrite: true,
            canCreateChildren: true,
            canRename: true,
            canDelete: true,
            canUpload: true
        };
    }

    const node = await resolveDpuNode(fileExp, normalizedPath);
    if (!node) {
        return {
            isDpu: true,
            canWrite: false,
            canCreateChildren: false,
            canRename: false,
            canDelete: false,
            canUpload: false
        };
    }

    const immutableRoot = Boolean(node.immutableRoot);
    const canWrite = Boolean(node.canWrite);
    const canCreateChildren = Boolean(node.canCreateChildren);
    const canCreateFiles = Object.prototype.hasOwnProperty.call(node, 'canCreateFiles')
        ? Boolean(node.canCreateFiles)
        : canCreateChildren;
    const canCreateDirectories = Object.prototype.hasOwnProperty.call(node, 'canCreateDirectories')
        ? Boolean(node.canCreateDirectories)
        : canCreateChildren;

    return {
        isDpu: true,
        node,
        canWrite,
        canCreateChildren,
        canCreateFiles,
        canCreateDirectories,
        canRename: canWrite && !immutableRoot,
        canDelete: canWrite && !immutableRoot,
        canUpload: canCreateChildren
    };
}

function invalidateDpuMutationState(fileExp, affectedPaths = []) {
    resetDpuCache(fileExp);
    for (const targetPath of affectedPaths) {
        if (!targetPath) continue;
        fileExp.caches.dirListing.invalidate(fileExp, targetPath);
        fileExp.caches.filePreview.invalidateForPath(targetPath);
    }
}

export function invalidateDpuState(fileExp, affectedPaths = []) {
    invalidateDpuMutationState(fileExp, affectedPaths);
}

async function ensureDpuWritableDirectory(fileExp, path) {
    const capabilities = await getDpuPathCapabilities(fileExp, path);
    if (!capabilities.isDpu) {
        throw new Error('Not a DPU path.');
    }
    if (!capabilities.canCreateChildren || !isDpuFolderType(capabilities.node?.type)) {
        throw new Error('This Confidential folder is not writable.');
    }
    return capabilities.node;
}

async function ensureDpuWritableEntry(fileExp, path) {
    const capabilities = await getDpuPathCapabilities(fileExp, path);
    if (!capabilities.isDpu) {
        throw new Error('Not a DPU path.');
    }
    if (!capabilities.canWrite) {
        throw new Error('You do not have write permission for this Confidential item.');
    }
    return capabilities.node;
}

export async function createDpuDirectory(fileExp, parentPath, name) {
    const parentNode = await ensureDpuWritableDirectory(fileExp, parentPath);
    const created = await callDpuTool('dpu_confidential_create', {
        parentId: parentNode.objectId,
        type: 'folder',
        name
    });
    invalidateDpuMutationState(fileExp, [parentPath]);
    if (!isDpuFolderType(created.object?.type)) {
        throw new Error('DPU returned an invalid object type for folder creation.');
    }
    return created.object || null;
}

export async function createDpuFile(fileExp, parentPath, name, { content = '', mimeType = '' } = {}) {
    if (isSecretsRootPath(parentPath)) {
        const normalizedKey = String(name || '').trim();
        await callDpuTool('dpu_secret_put', {
            key: normalizedKey,
            value: String(content ?? '')
        });
        invalidateDpuMutationState(fileExp, [DPU_SECRETS_PATH, fileExp.joinPath(DPU_SECRETS_PATH, normalizedKey)]);
        return {
            key: normalizedKey,
            name: normalizedKey,
            type: 'file'
        };
    }
    const parentNode = await ensureDpuWritableDirectory(fileExp, parentPath);
    const created = await callDpuTool('dpu_confidential_create', {
        parentId: parentNode.objectId,
        type: 'file',
        name,
        content,
        mimeType
    });
    invalidateDpuMutationState(fileExp, [parentPath]);
    if (!isDpuFileType(created.object?.type)) {
        throw new Error('DPU returned an invalid object type for file creation.');
    }
    return created.object || null;
}

export async function renameDpuEntry(fileExp, sourcePath, newName) {
    const sourceNode = await ensureDpuWritableEntry(fileExp, sourcePath);
    const updated = await callDpuTool('dpu_confidential_update', {
        id: sourceNode.objectId,
        name: newName
    });
    invalidateDpuMutationState(fileExp, [sourcePath, fileExp.parentPath(sourcePath) || '/']);
    return updated.object || null;
}

export async function deleteDpuEntry(fileExp, targetPath) {
    const targetNode = await ensureDpuWritableEntry(fileExp, targetPath);
    await callDpuTool('dpu_confidential_delete', { id: targetNode.objectId });
    invalidateDpuMutationState(fileExp, [targetPath, fileExp.parentPath(targetPath) || '/']);
    return true;
}

export async function updateDpuFile(fileExp, targetPath, { content, mimeType } = {}) {
    const targetNode = await ensureDpuWritableEntry(fileExp, targetPath);
    if (!isDpuFileType(targetNode?.type)) {
        throw new Error('This Confidential item is not a file.');
    }
    const payload = {
        id: targetNode.objectId,
        content: String(content ?? '')
    };
    if (mimeType !== undefined) {
        payload.mimeType = String(mimeType || '');
    }
    const updated = await callDpuTool('dpu_confidential_update', payload);
    if (!isDpuFileType(updated.object?.type, targetNode?.type)) {
        throw new Error('DPU returned an invalid object type for file update.');
    }
    invalidateDpuMutationState(fileExp, [targetPath, fileExp.parentPath(targetPath) || '/']);
    return updated.object || null;
}

export async function updateDpuSecret(fileExp, targetPath, { value } = {}) {
    const normalizedPath = normalizeManagedPath(fileExp, targetPath);
    const node = await resolveDpuNode(fileExp, normalizedPath);
    if (!node || node.kind !== 'secret' || !node.key) {
        throw new Error('This DPU item is not a secret.');
    }
    const updated = await callDpuTool('dpu_secret_put', {
        key: node.key,
        value: String(value ?? '')
    });
    invalidateDpuMutationState(fileExp, [normalizedPath, DPU_SECRETS_PATH]);
    return updated.secret || null;
}


function isSupportedConfidentialTextUpload(file) {
    const name = String(file?.name || '').toLowerCase();
    const type = String(file?.type || '').toLowerCase();
    if (type.startsWith('text/')) return true;
    return [
        '.txt', '.md', '.markdown', '.json', '.csv', '.tsv',
        '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
        '.html', '.css', '.xml', '.yml', '.yaml', '.toml',
        '.ini', '.env', '.log'
    ].some((suffix) => name.endsWith(suffix));
}

export async function uploadDpuFiles(fileExp, parentPath, files = []) {
    const parentNode = await ensureDpuWritableDirectory(fileExp, parentPath);
    const created = [];
    for (const file of files) {
        if (!isSupportedConfidentialTextUpload(file)) {
            throw new Error(`Binary upload is not supported yet in Confidential workspace: ${file.name}`);
        }
        const content = await file.text();
        const response = await callDpuTool('dpu_confidential_create', {
            parentId: parentNode.objectId,
            type: 'file',
            name: file.name,
            content,
            mimeType: file.type || 'text/plain'
        });
        created.push(response.object || null);
    }
    invalidateDpuMutationState(fileExp, [parentPath]);
    return created;
}

export async function getDpuPermissionsTarget(fileExp, targetPath) {
    const normalizedPath = normalizeManagedPath(fileExp, targetPath);
    const node = await resolveDpuNode(fileExp, normalizedPath);
    if (!node) {
        throw new Error('Confidential resource not found.');
    }
    if (node.immutableRoot) {
        throw new Error('Permissions are not available on this Confidential root.');
    }
    if (!node.canWrite) {
        throw new Error('Permissions are visible only for users with write access.');
    }
    if (node.kind === 'secret') {
        return {
            kind: 'secret',
            key: node.key,
            id: '',
            path: normalizedPath,
            name: node.key || normalizedPath.split('/').pop() || ''
        };
    }
    if (node.kind === 'confidential' || node.kind === 'shared-object') {
        return {
            kind: 'confidential',
            key: '',
            id: node.objectId || '',
            path: normalizedPath,
            name: node.name || normalizedPath.split('/').pop() || ''
        };
    }
    throw new Error('Permissions are not available for this item.');
}
