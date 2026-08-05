#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MASTER_KEY_VAR = 'PLOINKY_MASTER_KEY';
const STORAGE_SUBKEY_PURPOSE = 'storage/secrets';

function parseKeyValueText(raw = '') {
    const result = {};
    for (const line of String(raw || '').split(/\r?\n/)) {
        let trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        if (trimmed.startsWith('export ')) {
            trimmed = trimmed.slice('export '.length).trim();
        }
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex <= 0) continue;
        const key = trimmed.slice(0, eqIndex).trim();
        let value = trimmed.slice(eqIndex + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"'))
            || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (key) result[key] = value;
    }
    return result;
}

function findEnvFile(startDir) {
    let current = path.resolve(startDir || process.cwd());
    const { root } = path.parse(current);
    while (true) {
        const candidate = path.join(current, '.env');
        if (fs.existsSync(candidate)) return candidate;
        if (current === root) return '';
        current = path.dirname(current);
    }
}

function loadEnvFile(startDir) {
    const envFile = findEnvFile(startDir);
    return envFile ? parseKeyValueText(fs.readFileSync(envFile, 'utf8')) : {};
}

function resolveMasterKey(workspaceRoot) {
    const raw = String(process.env[MASTER_KEY_VAR] || loadEnvFile(workspaceRoot)[MASTER_KEY_VAR] || '').trim();
    if (!raw) throw new Error(`${MASTER_KEY_VAR} is required to update .ploinky/.secrets.`);
    return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

function deriveStorageKey(workspaceRoot) {
    return Buffer.from(crypto.hkdfSync(
        'sha256',
        resolveMasterKey(workspaceRoot),
        Buffer.alloc(0),
        Buffer.from(`ploinky/${STORAGE_SUBKEY_PURPOSE}/v1`, 'utf8'),
        32,
    ));
}

function getSecretsFile(workspaceRoot) {
    return path.join(workspaceRoot, '.ploinky', '.secrets');
}

function normalizeSecrets(input = {}) {
    const result = {};
    for (const [name, value] of Object.entries(input || {})) {
        const key = String(name || '').trim();
        if (key) result[key] = String(value ?? '');
    }
    return result;
}

function decryptPacked(workspaceRoot, packedText) {
    const buf = Buffer.from(String(packedText || '').trim(), 'base64');
    if (buf.length < IV_BYTES + TAG_BYTES + 1) {
        throw new Error('Encrypted .secrets envelope is incomplete.');
    }
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
    const decipher = crypto.createDecipheriv(ALGORITHM, deriveStorageKey(workspaceRoot), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    const payload = JSON.parse(plaintext);
    return normalizeSecrets(payload?.secrets);
}

function encryptSecretsToPacked(workspaceRoot, secrets) {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, deriveStorageKey(workspaceRoot), iv);
    const plaintext = Buffer.from(JSON.stringify({ version: 1, secrets: normalizeSecrets(secrets) }), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

function writeSecrets(workspaceRoot, secrets) {
    const file = getSecretsFile(workspaceRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const packed = encryptSecretsToPacked(workspaceRoot, secrets);
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, `${packed}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, file);
    try { fs.chmodSync(file, 0o600); } catch (_) { }
}

function readSecrets(workspaceRoot) {
    const file = getSecretsFile(workspaceRoot);
    if (!fs.existsSync(file)) return {};
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) return {};
    return decryptPacked(workspaceRoot, raw);
}

function main() {
    const [workspaceRootArg, command, name, ...valueParts] = process.argv.slice(2);
    const workspaceRoot = path.resolve(workspaceRootArg || process.cwd());
    if (!command) throw new Error('Usage: encrypted-secrets.mjs <workspaceRoot> <get|resolve|set|delete> [name] [value]');
    if (command === 'get') {
        process.stdout.write(readSecrets(workspaceRoot)[name] || '');
        return;
    }
    if (command === 'resolve') {
        const processValue = String(process.env[name] || '').trim();
        if (processValue) {
            process.stdout.write(processValue);
            return;
        }
        const envValue = String(loadEnvFile(workspaceRoot)[name] || '').trim();
        if (envValue) {
            process.stdout.write(envValue);
            return;
        }
        process.stdout.write(readSecrets(workspaceRoot)[name] || '');
        return;
    }
    if (command === 'set') {
        const secrets = readSecrets(workspaceRoot);
        secrets[name] = valueParts.join(' ');
        writeSecrets(workspaceRoot, secrets);
        return;
    }
    if (command === 'delete') {
        const secrets = readSecrets(workspaceRoot);
        delete secrets[name];
        writeSecrets(workspaceRoot, secrets);
        return;
    }
    throw new Error(`Unknown command '${command}'.`);
}

try {
    main();
} catch (error) {
    console.error(error?.message || String(error));
    process.exit(1);
}
