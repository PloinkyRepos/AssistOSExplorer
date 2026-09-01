import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

import { AgenticKnowledgeUnits } from 'achillesAgentLib';
import { resolveSiteDataDir } from '../src/runtime/akuStore.mjs';
import { loadAkuContext } from '../src/runtime/load-aku-context.mjs';
import { updateSessionProfile, appendSessionTurn } from '../src/runtime/update-session.mjs';

const TEST_SITE_URL = 'https://test-site.example.com';
const TEST_SITE_ID = 'test-site.example.com';
const TEST_SESSION_ID = 'test-session-123';

const SAMPLE_WAC = {
    siteInfo: 'TestCorp is a software testing company specializing in CI/CD pipeline automation and quality assurance tools.',
    profilesInfo: {
        developer: 'Software developers and engineers who need help with testing frameworks and CI/CD pipelines.',
        qa: 'Quality assurance professionals who manage test suites and automate regression testing.',
    },
    contactInfo: 'Email: owner@testcorp.com, Phone: +1-555-0123. Business hours: Mon-Fri 9am-5pm EST.',
    siteMap: [
        'https://testcorp.example.com/',
        'https://testcorp.example.com/services',
        'https://testcorp.example.com/contact',
    ],
};

function wacToKuSpecs(wac) {
    return [
        {
            ku_name: 'TestCorp',
            ku_type: 'site',
            keywords: ['testcorp', 'testing', 'ci/cd', 'quality assurance'],
            tags: ['identity'],
            summary: wac.siteInfo,
            state: wac.siteInfo,
        },
        ...Object.entries(wac.profilesInfo).map(([id, desc]) => ({
            ku_name: `${id} Profile`,
            ku_type: 'profile',
            keywords: [id, ...desc.split(' ').slice(0, 3).map(w => w.toLowerCase().replace(/[^a-z]/g, ''))],
            tags: ['profile'],
            summary: desc,
            state: desc,
        })),
        {
            ku_name: 'Owner Contact',
            ku_type: 'contact',
            keywords: ['contact', 'email', 'phone'],
            tags: ['config'],
            summary: wac.contactInfo,
            state: wac.contactInfo,
        },
    ];
}

function createTempDir() {
    return fs.mkdtemp(path.join(os.tmpdir(), 'webassist-aku-test-'));
}

async function cleanupTempDir(tempDir) {
    try {
        await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
    }
}

describe('AKU Integration Tests', () => {
    let tempDir;
    let originalDataRoot;

    beforeEach(async () => {
        tempDir = await createTempDir();
        originalDataRoot = process.env.WEBASSIST_DATA_ROOT;
        process.env.WEBASSIST_DATA_ROOT = path.join(tempDir, '.data', 'webAssist', 'data');
        await fs.mkdir(path.join(process.env.WEBASSIST_DATA_ROOT, 'sites'), { recursive: true });
    });

    afterEach(async () => {
        if (originalDataRoot !== undefined) {
            process.env.WEBASSIST_DATA_ROOT = originalDataRoot;
        } else {
            delete process.env.WEBASSIST_DATA_ROOT;
        }
        await cleanupTempDir(tempDir);
    });

    describe('WAC.json to KU specs conversion', () => {
        test('should convert WAC.json to KU specs', () => {
            const specs = wacToKuSpecs(SAMPLE_WAC);

            assert.ok(Array.isArray(specs), 'Should return an array');
            assert.equal(specs.length, 4, 'Should have 4 KUs (1 site + 2 profiles + 1 contact)');

            const siteKu = specs.find(k => k.ku_type === 'site');
            assert.ok(siteKu, 'Should have site KU');
            assert.equal(siteKu.ku_name, 'TestCorp');
            assert.ok(siteKu.keywords.length > 0, 'Site KU should have keywords');
            assert.equal(siteKu.state, SAMPLE_WAC.siteInfo);

            const profileKus = specs.filter(k => k.ku_type === 'profile');
            assert.equal(profileKus.length, 2, 'Should have 2 profile KUs');

            const contactKu = specs.find(k => k.ku_type === 'contact');
            assert.ok(contactKu, 'Should have contact KU');
            assert.equal(contactKu.state, SAMPLE_WAC.contactInfo);
        });

        test('should handle empty profilesInfo', () => {
            const wac = {
                siteInfo: 'Minimal site',
                profilesInfo: {},
                contactInfo: 'No contact',
                siteMap: ['https://example.com'],
            };
            const specs = wacToKuSpecs(wac);
            const profileKus = specs.filter(k => k.ku_type === 'profile');
            assert.equal(profileKus.length, 0, 'Should have no profile KUs');
            assert.equal(specs.length, 2, 'Should have only site and contact KUs');
        });
    });

    describe('AKU initialization and KU creation from WAC', () => {
        test('should initialize AKU and create KUs from WAC specs', async () => {
            const akuRootDir = resolveSiteDataDir(TEST_SITE_ID);
            const aku = new AgenticKnowledgeUnits({
                rootDir: akuRootDir,
                actor: `webassist/${TEST_SITE_ID}`,
            });

            assert.equal(await aku.exists(), false, 'AKU should not exist initially');

            await aku.initAKU({ actor: `webassist/${TEST_SITE_ID}` });
            assert.equal(await aku.exists(), true, 'AKU should exist after init');

            const specs = wacToKuSpecs(SAMPLE_WAC);
            for (let i = 0; i < specs.length; i++) {
                const spec = specs[i];
                const kuId = `ku_${spec.ku_type}_${i}`;
                await aku.initKU({
                    ku_id: kuId,
                    ku_name: spec.ku_name,
                    ku_type: spec.ku_type,
                    keywords: spec.keywords,
                    tags: spec.tags,
                    summary: spec.summary,
                    state: spec.state,
                });
            }

            const siteKu = await aku.loadKU('ku_site_0');
            assert.equal(siteKu.manifest.ku_name, 'TestCorp');
            assert.equal(siteKu.manifest.ku_type, 'site');
        });
    });

    describe('AKU search and context pack', () => {
        let aku;
        let akuRootDir;

        beforeEach(async () => {
            akuRootDir = resolveSiteDataDir(TEST_SITE_ID);
            aku = new AgenticKnowledgeUnits({
                rootDir: akuRootDir,
                actor: `webassist/${TEST_SITE_ID}`,
            });

            await aku.initAKU({ actor: `webassist/${TEST_SITE_ID}` });

            const specs = wacToKuSpecs(SAMPLE_WAC);
            for (let i = 0; i < specs.length; i++) {
                const spec = specs[i];
                const kuId = `ku_${spec.ku_type}_${i}`;
                await aku.initKU({
                    ku_id: kuId,
                    ku_name: spec.ku_name,
                    ku_type: spec.ku_type,
                    keywords: spec.keywords,
                    tags: spec.tags,
                    summary: spec.summary,
                    state: spec.state,
                });
            }
        });

        test('should search for relevant KUs', async () => {
            const searchResult = await aku.search('developer help');
            assert.ok(searchResult.results, 'Should return results');
            assert.ok(searchResult.results.length > 0, 'Should find at least one result');

            const profileKu = searchResult.results.find(r => r.ku_type === 'profile');
            assert.ok(profileKu, 'Should find profile KU for developer query');
        });

        test('should build context pack with budget', async () => {
            const contextPack = await aku.buildScopedContextPack('developer', {
                linkDepth: 1,
                maxResultsPerKU: 2,
            });

            assert.ok(contextPack, 'Should return context pack');
            assert.ok(contextPack.results, 'Should have results');
            assert.ok(contextPack.used_chars <= 6000, 'Should respect budget');
        });
    });

    describe('Session profile KU', () => {
        test('should create and update session profile KU', async () => {
            const akuRootDir = resolveSiteDataDir(TEST_SITE_ID);
            const aku = new AgenticKnowledgeUnits({
                rootDir: akuRootDir,
                actor: `webassist/${TEST_SITE_ID}`,
            });

            await aku.initAKU({ actor: `webassist/${TEST_SITE_ID}` });

            const result = await updateSessionProfile({
                siteId: TEST_SITE_ID,
                sessionId: TEST_SESSION_ID,
                profileDetails: ['Looking for testing help', 'Uses Node.js'],
                contactInformation: { email: 'visitor@test.com' },
            });

            assert.equal(result.success, true);
            assert.equal(result.sessionProfileKuId, `ku_sess_${TEST_SESSION_ID}`);

            const sessionKU = await aku.loadKU(`ku_sess_${TEST_SESSION_ID}`);
            assert.equal(sessionKU.manifest.ku_type, 'session-profile');
            assert.ok(sessionKU.state.includes('Looking for testing help'));
            assert.ok(sessionKU.state.includes('visitor@test.com'));
        });

        test('should append conversation turns as events', async () => {
            const akuRootDir = resolveSiteDataDir(TEST_SITE_ID);
            const aku = new AgenticKnowledgeUnits({
                rootDir: akuRootDir,
                actor: `webassist/${TEST_SITE_ID}`,
            });

            await aku.initAKU({ actor: `webassist/${TEST_SITE_ID}` });

            await updateSessionProfile({
                siteId: TEST_SITE_ID,
                sessionId: TEST_SESSION_ID,
                profileDetails: [],
                contactInformation: {},
            });

            await appendSessionTurn({
                siteId: TEST_SITE_ID,
                sessionId: TEST_SESSION_ID,
                userMessage: 'Hello, I need help with testing.',
                agentResponse: 'Sure, I can help you with testing frameworks.',
            });

            const sessionKU = await aku.loadKU(`ku_sess_${TEST_SESSION_ID}`);
            const turnEvents = sessionKU.events.filter(e => e.event_type === 'turn');
            assert.equal(turnEvents.length, 2, 'Should have 2 turn events');
            assert.equal(turnEvents[0].metadata.speaker, 'user');
            assert.equal(turnEvents[1].metadata.speaker, 'agent');
        });
    });

    describe('Lead KU', () => {
        test('should create lead KU and link to session', async () => {
            const akuRootDir = resolveSiteDataDir(TEST_SITE_ID);
            const aku = new AgenticKnowledgeUnits({
                rootDir: akuRootDir,
                actor: `webassist/${TEST_SITE_ID}`,
            });

            await aku.initAKU({ actor: `webassist/${TEST_SITE_ID}` });

            await aku.initKU({
                ku_id: `ku_sess_${TEST_SESSION_ID}`,
                ku_name: `Session ${TEST_SESSION_ID}`,
                ku_type: 'session-profile',
                state: 'Session state',
            });

            const leadKuId = `ku_lead_${TEST_SESSION_ID}`;
            await aku.initKU({
                ku_id: leadKuId,
                ku_name: `Lead ${TEST_SESSION_ID}`,
                ku_type: 'lead',
                keywords: ['lead', 'developer'],
                tags: ['lead', 'qualified'],
                summary: 'Lead for profile: Developer',
                state: 'Lead information for Developer profile',
                metadata: {
                    sessionId: TEST_SESSION_ID,
                    profile: 'Developer',
                    contactInfo: { email: 'lead@test.com' },
                },
            });

            await aku.linkKU(`ku_sess_${TEST_SESSION_ID}`, leadKuId, {
                relation: 'produced_result',
                summary: 'Session produced lead',
            });

            const leadKU = await aku.loadKU(leadKuId);
            assert.equal(leadKU.manifest.ku_type, 'lead');
            assert.ok(leadKU.state.includes('Developer'), 'State should contain profile info');

            const links = await aku.listKULinks(`ku_sess_${TEST_SESSION_ID}`);
            assert.equal(links.length, 1, 'Should have 1 link');
            assert.equal(links[0].target_ku_id, leadKuId);
            assert.equal(links[0].relation, 'produced_result');
        });
    });

    describe('loadAkuContext', () => {
        let aku;
        let akuRootDir;

        beforeEach(async () => {
            akuRootDir = resolveSiteDataDir(TEST_SITE_ID);
            aku = new AgenticKnowledgeUnits({
                rootDir: akuRootDir,
                actor: `webassist/${TEST_SITE_ID}`,
            });

            await aku.initAKU({ actor: `webassist/${TEST_SITE_ID}` });

            const specs = wacToKuSpecs(SAMPLE_WAC);
            for (let i = 0; i < specs.length; i++) {
                const spec = specs[i];
                const kuId = `ku_${spec.ku_type}_${i}`;
                await aku.initKU({
                    ku_id: kuId,
                    ku_name: spec.ku_name,
                    ku_type: spec.ku_type,
                    keywords: spec.keywords,
                    tags: spec.tags,
                    summary: spec.summary,
                    state: spec.state,
                });
            }
        });

        test('should load context with AKU search', async () => {
            const context = await loadAkuContext({
                siteId: TEST_SITE_ID,
                sessionId: TEST_SESSION_ID,
                message: 'I am a developer looking for help',
            });

            assert.equal(context.siteId, TEST_SITE_ID);
            assert.equal(context.sessionId, TEST_SESSION_ID);
            assert.ok(context.akuContext, 'Should have akuContext');
            assert.ok(context.akuContextText, 'Should have akuContextText');
            assert.equal(context.profileCatalog.length, 2, 'Should always load all predefined profile KUs');
            assert.match(context.profileCatalogText, /developer Profile/);
            assert.match(context.profileCatalogText, /qa Profile/);
            assert.ok(context.sessionProfile, 'Should have sessionProfile');
            assert.equal(context.sessionProfile.isNewSession, true, 'Should be new session');
        });

        test('should return empty context when AKU not initialized', async () => {
            const context = await loadAkuContext({
                siteId: 'nonexistent-site',
                sessionId: TEST_SESSION_ID,
                message: 'test',
            });

            assert.equal(context.akuContext, null);
            assert.equal(context.akuContextText, 'No site context available.');
            assert.deepEqual(context.profileCatalog, []);
            assert.equal(context.profileCatalogText, 'No predefined target profiles found.');
        });
    });
});
