import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXCLUDED_FILES = new Set(['helpers.mjs', 'runAll.mjs']);

async function listCurrentFolderTestFiles() {
    const entries = await fs.readdir(TESTS_DIR, { withFileTypes: true });

    return entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => /\.(mjs|js)$/i.test(name) && !EXCLUDED_FILES.has(name))
        .sort((left, right) => left.localeCompare(right))
        .map((name) => path.join(TESTS_DIR, name));
}

async function runTests(files) {
    if (files.length === 0) {
        process.stdout.write('No test files found.\n');
        return 0;
    }

    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--test', ...files], {
            stdio: 'inherit',
        });

        child.on('error', reject);
        child.on('close', (code) => resolve(code ?? 1));
    });
}

async function main() {
    const testFiles = await listCurrentFolderTestFiles();
    const code = await runTests(testFiles);
    process.exitCode = code;
}

main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
});
