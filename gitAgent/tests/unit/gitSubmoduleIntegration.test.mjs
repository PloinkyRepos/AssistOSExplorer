import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const agentRoot = new URL('../../', import.meta.url);

async function readAgentFile(relativePath) {
    return fs.readFile(new URL(relativePath, agentRoot), 'utf8');
}

test('MCP config declares the git_submodule_add contract and secret delegation', async () => {
    const config = JSON.parse(await readAgentFile('mcp-config.json'));
    const tool = config.tools.find((entry) => entry.name === 'git_submodule_add');

    assert.ok(tool);
    assert.equal(tool.env.TOOL_NAME, 'git_submodule_add');
    assert.deepEqual(Object.keys(tool.inputSchema), ['path', 'name', 'remoteUrl']);
    assert.equal(tool.inputSchema.path.optional, false);
    assert.equal(tool.inputSchema.name.optional, false);
    assert.equal(tool.inputSchema.remoteUrl.optional, false);
    assert.deepEqual(tool.delegations[0].tools, ['dpu_secret_get']);
    assert.deepEqual(tool.delegations[0].scopes, ['secret:read']);
});

test('Explorer new-repository flow switches to the submodule tool inside a repository', async () => {
    const menuSource = await readAgentFile('IDE-plugins/git-menu-contributions/menu-contributions.js');
    const modalSource = await readAgentFile('IDE-plugins/git-tool-button/components/git-new-repository-modal/git-new-repository-modal.js');
    const modalHtml = await readAgentFile('IDE-plugins/git-tool-button/components/git-new-repository-modal/git-new-repository-modal.html');

    assert.match(menuSource, /callGitTool\('git_info', \{ path: basePath \}\)/);
    assert.match(menuSource, /openNewRepositoryModal\(basePath, \{ submoduleMode \}\)/);
    assert.match(menuSource, /callGitTool\('git_submodule_add'/);
    assert.match(modalSource, /data-submoduleMode/);
    assert.match(modalSource, /this\.submoduleMode \? 'clone-github' : 'create-github'/);
    assert.match(modalSource, /createTab\.hidden = this\.submoduleMode/);
    assert.match(modalSource, /Add Git submodule/);
    assert.match(modalHtml, /data-git-new-repository-title/);
});
