// Unit tests for docs consistency validation
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
    const developmentHtml = readText('docs/development.html');

    const requiredSnippets = [
        '/.ploinky/repos/AchillesIDE/docs/development.html'
    ];

    for (const snippet of requiredSnippets) {
        assert.ok(rootReadme.includes(snippet), `README.md missing snippet: ${snippet}`);
        assert.ok(explorerReadme.includes(snippet), `explorer/README.md missing snippet: ${snippet}`);
        assert.ok(developmentHtml.includes(snippet), `docs/development.html missing snippet: ${snippet}`);
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

test('docs consistency does not depend on legacy fileExplorer symlink layout', () => {
    const symlinkPath = path.resolve(explorerRoot, '.ploinky/repos/fileExplorer');
    assert.equal(
        fs.existsSync(symlinkPath),
        false,
        'legacy explorer/.ploinky/repos/fileExplorer path should not be required by docs consistency checks'
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
