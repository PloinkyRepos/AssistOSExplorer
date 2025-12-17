export async function filterEntriesForSpecs(fileExp, entries = []) {
    const result = [];
    for (const entry of entries) {
        if (!entry) continue;
        if (entry.type === 'file' && fileExp.isMarkdownFile(entry.name)) {
            result.push(entry);
            continue;
        }
        if (entry.type === 'directory') {
            const hasMd = await hasMarkdownInTree(fileExp, entry.path);
            if (hasMd) {
                result.push(entry);
            }
        }
    }
    return result;
}

export async function hasMarkdownInTree(fileExp, dirPath) {
    if (!dirPath) return false;
    const normalizedRoot = fileExp.normalizePath(dirPath);
    const cachedRoot = fileExp.caches.mdTree.get(fileExp, normalizedRoot);
    if (cachedRoot !== null) {
        return cachedRoot;
    }

    const stack = [dirPath];
    while (stack.length) {
        const current = stack.pop();
        try {
            const items = await fileExp.loadDirectoryContent(current);
            for (const item of items) {
                if (!item?.name) continue;
                if (item.type === 'file' && fileExp.isMarkdownFile(item.name)) {
                    fileExp.caches.mdTree.set(fileExp, normalizedRoot, true);
                    return true;
                }
                if (item.type === 'directory') {
                    stack.push(item.path);
                }
            }
        } catch (err) {
            console.warn('Failed to scan directory for specs', current, err);
            fileExp.caches.mdTree.set(fileExp, normalizedRoot, false);
            return false;
        }
    }
    fileExp.caches.mdTree.set(fileExp, normalizedRoot, false);
    return false;
}

