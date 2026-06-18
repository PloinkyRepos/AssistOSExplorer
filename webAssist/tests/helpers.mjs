import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AgenticKnowledgeUnits } from 'achillesAgentLib';
import { resolveSiteAkuDir } from '../src/runtime/akuStore.mjs';

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const SEED_DATA_DIR = path.join(FIXTURES_DIR, 'seed-data');
const SOURCE_SKILLS_DIR = path.resolve(FIXTURES_DIR, '..', '..', 'skills');
const SOURCE_SRC_DIR = path.resolve(FIXTURES_DIR, '..', '..', 'src');
const SOURCE_ACHILLES_DIR = path.resolve(FIXTURES_DIR, '..', '..', 'node_modules', 'achillesAgentLib');

export async function createWebAssistSandbox() {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webassist-agent-'));
    const agentRoot = path.join(sandboxRoot, 'agent-root');
    const workspacePath = path.join(sandboxRoot, 'workspace');
    const dataDir = path.join(workspacePath, 'webassist-data');
    const skillsDir = path.join(agentRoot, 'skills');
    const srcDir = path.join(agentRoot, 'src');
    const nodeModulesDir = path.join(agentRoot, 'node_modules');

    await fs.mkdir(agentRoot, { recursive: true });
    await fs.mkdir(workspacePath, { recursive: true });
    await fs.cp(SEED_DATA_DIR, dataDir, { recursive: true });
    await fs.cp(SOURCE_SKILLS_DIR, skillsDir, { recursive: true });
    await fs.cp(SOURCE_SRC_DIR, srcDir, { recursive: true });
    await fs.mkdir(nodeModulesDir, { recursive: true });
    await fs.cp(SOURCE_ACHILLES_DIR, path.join(nodeModulesDir, 'achillesAgentLib'), { recursive: true });

    const originalPloinkyWorkspaceRoot = process.env.PLOINKY_WORKSPACE_ROOT;
    process.env.PLOINKY_WORKSPACE_ROOT = workspacePath;

    return {
        sandboxRoot,
        agentRoot,
        dataDir,
        workspacePath,
        async cleanup() {
            if (originalPloinkyWorkspaceRoot !== undefined) {
                process.env.PLOINKY_WORKSPACE_ROOT = originalPloinkyWorkspaceRoot;
            } else {
                delete process.env.PLOINKY_WORKSPACE_ROOT;
            }
            await fs.rm(sandboxRoot, { recursive: true, force: true });
        },
    };
}

export async function initializeSiteAku({ agentRoot, dataDir }, siteId) {
    const akuRootDir = resolveSiteAkuDir(agentRoot, siteId, dataDir);
    const aku = new AgenticKnowledgeUnits({
        rootDir: akuRootDir,
        actor: `webassist/${siteId}`,
    });

    await aku.initAKU({ actor: `webassist/${siteId}` });
    await aku.initKU({
        ku_id: 'ku_site',
        ku_name: siteId,
        ku_type: 'site',
        keywords: [siteId],
        tags: ['site'],
        summary: `Site memory for ${siteId}`,
        state: `Site memory for ${siteId}`,
    });

    return aku;
}
