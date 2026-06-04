import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const SEED_DATA_DIR = path.join(FIXTURES_DIR, 'seed-data');
const SOURCE_SKILLS_DIR = path.resolve(FIXTURES_DIR, '..', '..', 'skills');
const SOURCE_SRC_DIR = path.resolve(FIXTURES_DIR, '..', '..', 'src');
const SOURCE_ACHILLES_DIR = path.resolve(FIXTURES_DIR, '..', '..', 'node_modules', 'achillesAgentLib');
const SOURCE_FLEXSEARCH_DIR = path.resolve(FIXTURES_DIR, '..', '..', 'node_modules', 'flexsearch');
const SOURCE_MCP_SDK_DIR = path.resolve(FIXTURES_DIR, '..', '..', 'node_modules', 'mcp-sdk');
const SOURCE_DATA_DIR = path.resolve(FIXTURES_DIR, '..', '..', '..', 'data');

export async function createWebAssistSandbox() {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webassist-agent-'));
    const agentRoot = path.join(sandboxRoot, 'agent-root');
    const dataDir = path.join(agentRoot, 'data');
    const workspacePath = path.join(sandboxRoot, 'workspace');
    const skillsDir = path.join(agentRoot, 'skills');
    const srcDir = path.join(agentRoot, 'src');
    const nodeModulesDir = path.join(agentRoot, 'node_modules');
    const rootDataDir = path.join(sandboxRoot, 'data');

    await fs.mkdir(agentRoot, { recursive: true });
    await fs.mkdir(workspacePath, { recursive: true });
    await fs.cp(SEED_DATA_DIR, dataDir, { recursive: true });
    await fs.cp(SOURCE_SKILLS_DIR, skillsDir, { recursive: true });
    await fs.cp(SOURCE_SRC_DIR, srcDir, { recursive: true });
    await fs.mkdir(nodeModulesDir, { recursive: true });
    await fs.cp(SOURCE_ACHILLES_DIR, path.join(nodeModulesDir, 'achillesAgentLib'), { recursive: true });
    await fs.cp(SOURCE_FLEXSEARCH_DIR, path.join(nodeModulesDir, 'flexsearch'), { recursive: true });
    await fs.cp(SOURCE_MCP_SDK_DIR, path.join(nodeModulesDir, 'mcp-sdk'), { recursive: true });
    await fs.cp(SOURCE_DATA_DIR, rootDataDir, { recursive: true });

    const originalWorkspacePath = process.env.WORKSPACE_PATH;
    process.env.WORKSPACE_PATH = workspacePath;

    return {
        sandboxRoot,
        agentRoot,
        dataDir,
        workspacePath,
        async cleanup() {
            if (originalWorkspacePath !== undefined) {
                process.env.WORKSPACE_PATH = originalWorkspacePath;
            } else {
                delete process.env.WORKSPACE_PATH;
            }
            await fs.rm(sandboxRoot, { recursive: true, force: true });
        },
    };
}
