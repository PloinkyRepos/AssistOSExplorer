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

import { normalizeRepoRelativePrefix } from './git-commit-modal-selection.js';

export function renderRepoChangesTree(repo, {
    isFileSelected,
    getAncestorCoveringPrefix,
    getCoveringPrefix,
    isFolderExpanded
} = {}) {
    const changesAll = Array.isArray(repo?.changesAll) ? repo.changesAll : null;
    const fallbackPaths = repo?.changes ? [
        ...(repo.changes.staged || []),
        ...(repo.changes.unstaged || []),
        ...(repo.changes.untracked || []),
        ...(repo.changes.conflicted || [])
    ].map((p) => ({ path: p, kind: 'unknown', x: null, y: null })) : [];
    const rows = (changesAll && changesAll.length) ? changesAll : fallbackPaths;
    if (!rows.length) return null;

    const root = document.createElement('div');
    root.className = 'git-tree';

    const buildTree = (items) => {
        const tree = { files: [], children: new Map() };
        for (const item of items) {
            const rel = String(item?.path || '').replace(/^\/+/, '');
            if (!rel) continue;
            const parts = rel.split('/').filter(Boolean);
            let node = tree;
            for (let i = 0; i < parts.length; i += 1) {
                const part = parts[i];
                const isLast = i === parts.length - 1;
                if (isLast) {
                    node.files.push({
                        name: part,
                        path: rel,
                        kind: item.kind,
                        flags: item.flags || null,
                        x: item.x,
                        y: item.y
                    });
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

    const renderNode = (node, depth, prefix) => {
        const out = document.createElement('div');
        out.className = 'git-tree-children';
        const indentStep = 18;
        const indent = (level) => `${level * indentStep}px`;

        const folderNames = Array.from(node.children.keys()).sort((a, b) => a.localeCompare(b));
        for (const folder of folderNames) {
            const childNode = node.children.get(folder);
            const nextPrefix = prefix ? `${prefix}${folder}/` : `${folder}/`;
            const normalizedPrefix = normalizeRepoRelativePrefix(nextPrefix);
            const expanded = isFolderExpanded ? Boolean(isFolderExpanded(repo.path, normalizedPrefix)) : true;

            const folderWrapper = document.createElement('div');
            folderWrapper.className = 'git-tree-folder-node';

            const row = document.createElement('div');
            row.className = 'git-tree-item';
            row.style.paddingLeft = indent(depth);

            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'secondary git-tree-folder-toggle';
            toggle.setAttribute('data-local-action', 'toggleTreeFolder');
            toggle.dataset.repoPath = repo.path;
            toggle.dataset.prefix = normalizedPrefix;
            toggle.textContent = expanded ? '▾' : '▸';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.dataset.fileFolderSelect = 'true';
            checkbox.dataset.repoPath = repo.path;
            checkbox.dataset.prefix = normalizedPrefix;
            checkbox.setAttribute('data-local-action', 'toggleTreePrefixSelectionCheckbox');

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
            const icon = document.createElement('span');
            icon.className = 'git-tree-folder-icon';
            icon.setAttribute('aria-hidden', 'true');
            icon.innerHTML = `
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3.5 6.5h6l2 2H20.5v10a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2v-12a2 2 0 0 1 2-2Z"></path>
                </svg>
            `.trim();
            const text = document.createElement('span');
            text.className = 'git-tree-folder-name';
            text.textContent = folder;
            label.appendChild(icon);
            label.appendChild(text);

            row.appendChild(toggle);
            row.appendChild(checkbox);
            row.appendChild(label);
            folderWrapper.appendChild(row);
            if (expanded) {
                folderWrapper.appendChild(renderNode(childNode, depth + 1, nextPrefix));
            }
            out.appendChild(folderWrapper);
        }

        const files = (node.files || []).slice().sort((a, b) => a.name.localeCompare(b.name));
        for (const file of files) {
            const row = document.createElement('div');
            row.className = 'git-tree-item git-tree-file-row';
            row.style.paddingLeft = indent(depth);
            const x = file.x || ' ';
            const y = file.y || ' ';
            const flags = file.flags || {};
            const kind = String(file.kind || '');
            const isUntracked = Boolean(flags.untracked) || kind === 'untracked' || (x === '?' && y === '?');
            const isNewTracked = !isUntracked && (x === 'A' || y === 'A');
            const isModified = !isUntracked && !isNewTracked && (
                x === 'M' || y === 'M' || x === 'R' || y === 'R' || x === 'C' || y === 'C'
                || kind === 'staged' || kind === 'unstaged' || kind === 'staged+unstaged' || kind === 'conflicted'
            );
            row.classList.toggle('is-untracked', isUntracked);
            row.classList.toggle('is-new', isNewTracked);
            row.classList.toggle('is-modified', isModified);

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.dataset.fileSelect = 'true';
            checkbox.dataset.repoPath = repo.path;
            checkbox.dataset.filePath = file.path;
            checkbox.setAttribute('data-local-action', 'toggleTreeFileSelectionCheckbox');
            checkbox.checked = Boolean(isFileSelected?.(repo.path, file.path));
            checkbox.disabled = Boolean(getCoveringPrefix?.(repo.path, file.path));

            const button = document.createElement('div');
            button.className = 'git-tree-file';
            button.setAttribute('role', 'button');
            button.setAttribute('tabindex', '0');
            button.setAttribute('data-local-action', 'openDiff');
            button.dataset.repoPath = repo.path;
            button.dataset.filePath = file.path;
            button.textContent = file.name;

            row.appendChild(checkbox);
            row.appendChild(button);
            out.appendChild(row);
        }
        return out;
    };

    const tree = buildTree(rows);
    root.appendChild(renderNode(tree, 1, ''));
    return root;
}
