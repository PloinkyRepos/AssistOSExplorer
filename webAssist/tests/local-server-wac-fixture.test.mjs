import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_SERVER_DIR = path.join(TESTS_DIR, 'localServer');
const WAC_PATH = path.join(LOCAL_SERVER_DIR, 'WAC.json');
const PROFILES_DIR = path.join(LOCAL_SERVER_DIR, 'profiles');
const ASSISTOS_INFO_DIR = path.join(LOCAL_SERVER_DIR, 'assistos-info');

function compareChapterFiles(a, b) {
    const chapterA = Number(a.match(/^chapter[-_](\d+)/)?.[1] ?? Number.MAX_SAFE_INTEGER);
    const chapterB = Number(b.match(/^chapter[-_](\d+)/)?.[1] ?? Number.MAX_SAFE_INTEGER);
    return chapterA - chapterB || a.localeCompare(b);
}

test('local WAC fixture mirrors profile files exactly and links assistos info files', async () => {
    const wac = JSON.parse(await fs.readFile(WAC_PATH, 'utf8'));

    const profileFiles = (await fs.readdir(PROFILES_DIR))
        .filter((fileName) => fileName.endsWith('.md'))
        .sort();
    const expectedProfiles = Object.fromEntries(await Promise.all(profileFiles.map(async (fileName) => {
        const profileId = path.basename(fileName, '.md');
        const content = await fs.readFile(path.join(PROFILES_DIR, fileName), 'utf8');
        return [profileId, content];
    })));

    assert.deepEqual(wac.profilesInfo, expectedProfiles);

    const assistosFiles = (await fs.readdir(ASSISTOS_INFO_DIR))
        .filter((fileName) => fileName.endsWith('.md'))
        .sort(compareChapterFiles);
    const expectedSiteMap = assistosFiles.map((fileName) => `http://localhost:3000/assistos-info/${fileName}`);

    assert.deepEqual(wac.siteMap, expectedSiteMap);
    for (const url of wac.siteMap) {
        assert.doesNotThrow(() => new URL(url));
    }
});
