import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { AgenticKnowledgeUnits } from 'achillesAgentLib';

import { createWebAssistSandbox, ensureSiteAku } from './helpers.mjs';
import { loadAkuContext } from '../src/runtime/load-aku-context.mjs';

const SITE_ID = 'demo-site';

async function listDebugFiles(debugDir) {
    try {
        return (await fs.readdir(debugDir)).sort();
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}

test('loadAkuContext writes AKU search debug payload when ACHILLES_DEBUG is enabled', async (t) => {
    const sandbox = await createWebAssistSandbox();
    const debugDir = path.join(sandbox.sandboxRoot, 'debuglogs');
    const originalDebug = process.env.ACHILLES_DEBUG;
    const originalDebugDir = process.env.WEBASSIST_DEBUG_DIR;
    t.after(async () => {
        if (originalDebug !== undefined) {
            process.env.ACHILLES_DEBUG = originalDebug;
        } else {
            delete process.env.ACHILLES_DEBUG;
        }
        if (originalDebugDir !== undefined) {
            process.env.WEBASSIST_DEBUG_DIR = originalDebugDir;
        } else {
            delete process.env.WEBASSIST_DEBUG_DIR;
        }
        await sandbox.cleanup();
    });

    await ensureSiteAku({ siteId: SITE_ID });
    const aku = new AgenticKnowledgeUnits({
        rootDir: path.join(sandbox.webAssistDataDir, 'sites', SITE_ID),
        actor: `webassist/${SITE_ID}`,
    });
    await aku.loadAKU();
    await aku.initKU({
        ku_id: 'ku_site_debug',
        ku_name: 'Debug Site Info',
        ku_type: 'site',
        tags: ['site'],
        keywords: ['debug', 'billing'],
        summary: 'Billing integration debug information',
        state: 'The site supports billing API integrations and setup guidance.',
    });

    process.env.ACHILLES_DEBUG = '1';
    process.env.WEBASSIST_DEBUG_DIR = debugDir;

    await loadAkuContext({
        siteId: SITE_ID,
        sessionId: 'debug-session',
        message: 'billing integration',
    });

    const debugFiles = await listDebugFiles(debugDir);
    const searchLog = debugFiles.find((file) => file.startsWith('aku-search-') && file.endsWith('.json'));
    assert.ok(searchLog, 'expected an aku-search debug log');

    const payload = JSON.parse(await fs.readFile(path.join(debugDir, searchLog), 'utf8'));
    assert.equal(payload.siteId, SITE_ID);
    assert.equal(payload.sessionId, 'debug-session');
    assert.equal(payload.query, 'billing integration');
    assert.deepEqual(payload.searchOptions, {
        explain: true,
        limit: 20,
        maxResultsPerKU: 0,
    });
    assert.ok(Array.isArray(payload.rawResults));
    assert.ok(payload.rawResults.some((result) => result.ku_id === 'ku_site_debug'));
    assert.ok(Array.isArray(payload.profileCatalog));
    assert.ok(payload.contextPack);
    assert.equal(typeof payload.akuContextText, 'string');
});

test('loadAkuContext does not write debug payload when ACHILLES_DEBUG is disabled', async (t) => {
    const sandbox = await createWebAssistSandbox();
    const debugDir = path.join(sandbox.sandboxRoot, 'debuglogs-disabled');
    const originalDebug = process.env.ACHILLES_DEBUG;
    const originalDebugDir = process.env.WEBASSIST_DEBUG_DIR;
    t.after(async () => {
        if (originalDebug !== undefined) {
            process.env.ACHILLES_DEBUG = originalDebug;
        } else {
            delete process.env.ACHILLES_DEBUG;
        }
        if (originalDebugDir !== undefined) {
            process.env.WEBASSIST_DEBUG_DIR = originalDebugDir;
        } else {
            delete process.env.WEBASSIST_DEBUG_DIR;
        }
        await sandbox.cleanup();
    });

    await ensureSiteAku({ siteId: SITE_ID });
    delete process.env.ACHILLES_DEBUG;
    process.env.WEBASSIST_DEBUG_DIR = debugDir;

    await loadAkuContext({
        siteId: SITE_ID,
        sessionId: 'debug-disabled-session',
        message: 'billing integration',
    });

    assert.deepEqual(await listDebugFiles(debugDir), []);
});
