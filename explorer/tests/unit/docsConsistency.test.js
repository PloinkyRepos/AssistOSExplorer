import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const explorerRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(explorerRoot, '..');

const readText = (relativePath, base = repoRoot) =>
    fs.readFileSync(path.resolve(base, relativePath), 'utf8');

const readExplorerText = (relativePath) =>
    fs.readFileSync(path.resolve(explorerRoot, relativePath), 'utf8');

test('docs include repo-scoped HTML preview guidance', () => {
    const rootReadme = readText('README.md');
    const explorerReadme = readExplorerText('README.md');
    const detailedGuide = readText('docs/EXPLORER_AGENT_DOCS.md');

    const requiredSnippets = [
        '/.ploinky/repos/fileExplorer/docs/development.html',
        'explorer/.ploinky/repos/fileExplorer -> ../../..'
    ];

    for (const snippet of requiredSnippets) {
        assert.ok(rootReadme.includes(snippet), `README.md missing snippet: ${snippet}`);
        assert.ok(explorerReadme.includes(snippet), `explorer/README.md missing snippet: ${snippet}`);
        assert.ok(detailedGuide.includes(snippet), `docs/EXPLORER_AGENT_DOCS.md missing snippet: ${snippet}`);
    }
});

test('mcp tools documentation matches current tool definitions', () => {
    const definitionsSource = readExplorerText('utils/server/tool-definitions.mjs');
    const docsToolsHtml = readText('docs/mcp-tools.html');

    const toolNames = new Set();
    const regex = /name:\s*'([^']+)'/g;
    let match = regex.exec(definitionsSource);
    while (match) {
        toolNames.add(match[1]);
        match = regex.exec(definitionsSource);
    }

    assert.ok(toolNames.size > 0, 'No MCP tools extracted from tool-definitions.mjs');

    for (const toolName of toolNames) {
        assert.ok(
            docsToolsHtml.includes(`<code>${toolName}</code>`),
            `docs/mcp-tools.html is missing MCP tool: ${toolName}`
        );
    }
});

test('versioned repo-scoped symlink exists for docs preview portability', () => {
    const symlinkPath = path.resolve(explorerRoot, '.ploinky/repos/fileExplorer');
    const stats = fs.lstatSync(symlinkPath);
    assert.ok(stats.isSymbolicLink(), 'explorer/.ploinky/repos/fileExplorer must be a symlink');

    const linkTarget = fs.readlinkSync(symlinkPath);
    assert.equal(
        linkTarget,
        '../../..',
        'explorer/.ploinky/repos/fileExplorer symlink target must stay ../../..'
    );
});

test('architecture and development docs mention split file-exp presenters', () => {
    const architectureHtml = readText('docs/architecture.html');
    const developmentHtml = readText('docs/development.html');

    const requiredComponentMentions = [
        'file-exp-entries',
        'file-exp-preview',
        'html-web-view'
    ];

    for (const componentName of requiredComponentMentions) {
        assert.ok(
            architectureHtml.includes(componentName),
            `docs/architecture.html missing component mention: ${componentName}`
        );
        assert.ok(
            developmentHtml.includes(componentName),
            `docs/development.html missing component mention: ${componentName}`
        );
    }
});
