import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgenticKnowledgeUnits } from 'achillesAgentLib';
import { resolveSiteDataDir } from '../src/runtime/akuStore.mjs';

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const SEED_DATA_DIR = path.join(FIXTURES_DIR, 'seed-data');

export function plannerDecision({ tool, toolPrompt, reason }) {
    return `## Tool\n${tool}\n\n## Prompt\n${toolPrompt}\n\n## Reason\n${reason}`;
}

export async function createWebAssistSandbox() {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webassist-agent-'));
    const workspaceRoot = path.join(sandboxRoot, 'workspace');
    const webAssistDataDir = path.join(workspaceRoot, '.data', 'webAssist', 'data');

    await fs.mkdir(webAssistDataDir, { recursive: true });
    await fs.cp(path.join(SEED_DATA_DIR, 'sites'), path.join(webAssistDataDir, 'sites'), { recursive: true });

    const originalDataRoot = process.env.WEBASSIST_DATA_ROOT;
    process.env.WEBASSIST_DATA_ROOT = webAssistDataDir;

    return {
        sandboxRoot,
        workspaceRoot,
        webAssistDataDir,
        async cleanup() {
            if (originalDataRoot !== undefined) {
                process.env.WEBASSIST_DATA_ROOT = originalDataRoot;
            } else {
                delete process.env.WEBASSIST_DATA_ROOT;
            }
            await fs.rm(sandboxRoot, { recursive: true, force: true });
        },
    };
}

export async function ensureSiteAku({ siteId }) {
    const normalizedSiteId = String(siteId || '').trim();
    if (!normalizedSiteId) {
        throw new Error('ensureSiteAku requires siteId.');
    }

    const akuRootDir = resolveSiteDataDir(normalizedSiteId);
    const actor = `webassist/${normalizedSiteId}`;
    const aku = new AgenticKnowledgeUnits({
        rootDir: akuRootDir,
        actor,
    });

    const akuExists = await aku.exists();
    if (!akuExists) {
        await aku.initAKU({ actor });
    }

    try {
        await aku.loadKU('ku_site');
    } catch (error) {
        if (!error?.message?.includes('not found')) {
            throw error;
        }
        await aku.initKU({
            ku_id: 'ku_site',
            ku_name: `Site ${normalizedSiteId}`,
            ku_type: 'site',
            keywords: ['site', normalizedSiteId],
            tags: ['site'],
            summary: `Site context for ${normalizedSiteId}`,
            state: '',
            metadata: {
                siteId: normalizedSiteId,
            },
        });
    }

    return aku;
}
