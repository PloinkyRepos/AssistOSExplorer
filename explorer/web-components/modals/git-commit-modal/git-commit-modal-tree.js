import { normalizeRepoRelativePrefix } from './git-commit-modal-selection.js';

export function formatRepoSummary(repo) {
    if (!repo || !repo.ok) {
        return 'Not a git repository.';
    }
    const counts = repo.counts || { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 };
    const hasChanges = counts.staged || counts.unstaged || counts.untracked || counts.conflicted;
    if (!hasChanges) return 'Clean.';

    const sample = repo.sample || {};
    const parts = [];

    const addPart = (label, count, items) => {
        if (!count) return;
        const list = Array.isArray(items) ? items : [];
        const base = `${label}(${count})`;
        if (!list.length) {
            parts.push(base);
            return;
        }
        const shown = list.slice(0, 4);
        const more = count - shown.length;
        parts.push(`${base}: ${shown.join(', ')}${more > 0 ? `, +${more} more` : ''}`);
    };

    addPart('staged', counts.staged, sample.staged);
    addPart('unstaged', counts.unstaged, sample.unstaged);
    addPart('untracked', counts.untracked, sample.untracked);
    addPart('conflicts', counts.conflicted, sample.conflicted);

    return parts.join(' | ');
}

export function renderRepoChangesTree(repo, {
    isFileSelected,
    getAncestorCoveringPrefix,
    getCoveringPrefix
} = {}) {
    const changes = repo?.changes || repo?.sample || {};
    const groups = [
        { key: 'staged', label: 'Staged', items: changes.staged || [] },
        { key: 'unstaged', label: 'Unstaged', items: changes.unstaged || [] },
        { key: 'untracked', label: 'Untracked', items: changes.untracked || [] },
        { key: 'conflicted', label: 'Conflicts', items: changes.conflicted || [] }
    ].filter((g) => Array.isArray(g.items) && g.items.length);

    if (!groups.length) return null;

    const root = document.createElement('div');
    root.className = 'git-tree';

    const buildTree = (paths) => {
        const tree = { files: [], children: new Map() };
        for (const p of paths) {
            const rel = String(p || '').replace(/^\/+/, '');
            if (!rel) continue;
            const parts = rel.split('/').filter(Boolean);
            let node = tree;
            for (let i = 0; i < parts.length; i += 1) {
                const part = parts[i];
                const isLast = i === parts.length - 1;
                if (isLast) {
                    node.files.push({ name: part, path: rel });
                } else {
                    if (!node.children.has(part)) {
                        node.children.set(part, { files: [], children: new Map() });
                    }
                    node = node.children.get(part);
                }
            }
        }
        return tree;
    };

    const collectSubtreeFilePaths = (node) => {
        const paths = [];
        const stack = [node];
        while (stack.length) {
            const current = stack.pop();
            const files = Array.isArray(current?.files) ? current.files : [];
            for (const f of files) {
                if (f?.path) paths.push(f.path);
            }
            const children = current?.children;
            if (children && typeof children.values === 'function') {
                for (const child of children.values()) {
                    stack.push(child);
                }
            }
        }
        return paths;
    };

    const renderNode = (node, depth, section, prefix) => {
        const out = document.createElement('div');
        out.className = 'git-tree-children';
        const indentStep = 12;
        const indent = (level) => `${level * indentStep}px`;

        const folderNames = Array.from(node.children.keys()).sort((a, b) => a.localeCompare(b));
        for (const folder of folderNames) {
            const childNode = node.children.get(folder);
            const nextPrefix = prefix ? `${prefix}${folder}/` : `${folder}/`;

            const folderWrapper = document.createElement('div');
            folderWrapper.className = 'git-tree-folder-node';

            const row = document.createElement('div');
            row.className = 'git-tree-item';
            row.style.paddingLeft = indent(depth);

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.dataset.fileFolderSelect = 'true';
            checkbox.dataset.repoPath = repo.path;
            const normalizedPrefix = normalizeRepoRelativePrefix(nextPrefix);
            checkbox.dataset.prefix = normalizedPrefix;

            const subtreeFiles = collectSubtreeFilePaths(childNode);
            const ancestorPrefix = getAncestorCoveringPrefix?.(repo.path, normalizedPrefix) || null;
            const explicitlySelected = Boolean(getCoveringPrefix?.(repo.path, normalizedPrefix) === normalizedPrefix);

            if (ancestorPrefix) {
                checkbox.checked = true;
                checkbox.disabled = true;
            } else if (explicitlySelected) {
                checkbox.checked = true;
            } else {
                const selectedCount = subtreeFiles.reduce((acc, p) => acc + (isFileSelected?.(repo.path, p) ? 1 : 0), 0);
                checkbox.checked = subtreeFiles.length > 0 && selectedCount === subtreeFiles.length;
                checkbox.indeterminate = selectedCount > 0 && selectedCount < subtreeFiles.length;
            }

            const label = document.createElement('div');
            label.className = 'git-tree-folder';
            label.textContent = folder;

            row.appendChild(checkbox);
            row.appendChild(label);
            folderWrapper.appendChild(row);
            folderWrapper.appendChild(renderNode(childNode, depth + 1, section, nextPrefix));
            out.appendChild(folderWrapper);
        }

        const files = (node.files || []).slice().sort((a, b) => a.name.localeCompare(b.name));
        for (const file of files) {
            const row = document.createElement('div');
            row.className = 'git-tree-item';
            row.style.paddingLeft = indent(depth);

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.dataset.fileSelect = 'true';
            checkbox.dataset.repoPath = repo.path;
            checkbox.dataset.filePath = file.path;
            checkbox.dataset.section = section;
            checkbox.checked = Boolean(isFileSelected?.(repo.path, file.path));
            checkbox.disabled = Boolean(getCoveringPrefix?.(repo.path, file.path));

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'git-tree-file';
            button.setAttribute('data-local-action', 'openDiff');
            button.dataset.repoPath = repo.path;
            button.dataset.filePath = file.path;
            button.dataset.section = section;
            button.textContent = file.name;

            row.appendChild(checkbox);
            row.appendChild(button);
            out.appendChild(row);
        }
        return out;
    };

    for (const group of groups) {
        const header = document.createElement('div');
        header.className = 'git-tree-item git-tree-meta';
        header.textContent = group.label;
        root.appendChild(header);
        const tree = buildTree(group.items);
        root.appendChild(renderNode(tree, 1, group.key, ''));
    }
    return root;
}
