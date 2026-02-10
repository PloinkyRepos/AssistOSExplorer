export function normalizeFsPath(fileExp, pathValue) {
    if (!fileExp?.normalizePath) return '';
    return fileExp.normalizePath(pathValue || '');
}

export function isSameOrDescendantPath(fileExp, candidatePath, basePath) {
    const normalizedCandidate = normalizeFsPath(fileExp, candidatePath);
    const normalizedBase = normalizeFsPath(fileExp, basePath);
    if (!normalizedCandidate || !normalizedBase) return false;
    return normalizedCandidate === normalizedBase
        || normalizedCandidate.startsWith(`${normalizedBase}/`);
}

export function invalidateDirectoryCache(fileExp, dirPath) {
    if (!dirPath) return;
    fileExp?.caches?.dirListing?.invalidate?.(fileExp, dirPath);
}

export function invalidateDirectoryBranchCache(fileExp, basePath) {
    const normalizedBasePath = normalizeFsPath(fileExp, basePath);
    if (!normalizedBasePath) return;
    const cachedPaths = fileExp?.caches?.dirListing?.keys?.() || [];
    for (const cachedPath of cachedPaths) {
        if (isSameOrDescendantPath(fileExp, cachedPath, normalizedBasePath)) {
            invalidateDirectoryCache(fileExp, cachedPath);
        }
    }
}

export function invalidateFilePreviewCache(fileExp, filePath) {
    if (!filePath) return;
    fileExp?.caches?.filePreview?.invalidateForPath?.(filePath);
}

export function invalidateFsMutationCaches(
    fileExp,
    {
        directories = [],
        directoryBranches = [],
        files = []
    } = {}
) {
    const uniqueDirectories = new Set(
        (directories || [])
            .map((pathValue) => normalizeFsPath(fileExp, pathValue))
            .filter(Boolean)
    );
    uniqueDirectories.forEach((dirPath) => invalidateDirectoryCache(fileExp, dirPath));

    const uniqueBranches = new Set(
        (directoryBranches || [])
            .map((pathValue) => normalizeFsPath(fileExp, pathValue))
            .filter(Boolean)
    );
    uniqueBranches.forEach((branchPath) => invalidateDirectoryBranchCache(fileExp, branchPath));

    const uniqueFiles = new Set(
        (files || [])
            .map((pathValue) => normalizeFsPath(fileExp, pathValue))
            .filter(Boolean)
    );
    uniqueFiles.forEach((filePath) => invalidateFilePreviewCache(fileExp, filePath));
}
