#!/usr/bin/env node

import fs from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_CONFIG_FILE = '/etc/onlyoffice/documentserver/local.json';

function requireExact(value, expected, message) {
  if (value !== expected) {
    throw new Error(message);
  }
}

function requireSecretAgreement(secretConfig, expectedSecret, name) {
  if (
    !secretConfig
    || typeof secretConfig !== 'object'
    || Array.isArray(secretConfig)
    || typeof secretConfig.string !== 'string'
    || secretConfig.string !== expectedSecret
  ) {
    throw new Error(`OnlyOffice DocumentServer ${name} JWT secret does not match the shared runtime secret.`);
  }
}

export function verifyDocumentServerJwtConfig({
  configFile = DEFAULT_CONFIG_FILE,
  env = process.env,
} = {}) {
  const stat = fs.lstatSync(configFile);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('OnlyOffice DocumentServer local configuration must be a non-symlink regular file.');
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch {
    throw new Error('OnlyOffice DocumentServer local configuration is not valid JSON.');
  }

  const decoratorSecret = String(env.ONLYOFFICE_JWT_SECRET || '');
  const documentServerSecret = String(env.JWT_SECRET || '');
  if (!decoratorSecret || !documentServerSecret || decoratorSecret !== documentServerSecret) {
    throw new Error('OnlyOffice decorator and DocumentServer JWT secrets must be present and identical.');
  }

  const coAuthoring = config?.services?.CoAuthoring;
  const token = coAuthoring?.token;
  const secret = coAuthoring?.secret;
  requireExact(
    token?.enable?.browser,
    true,
    'OnlyOffice DocumentServer browser JWT validation must be boolean true.',
  );
  requireExact(
    token?.enable?.request?.inbox,
    true,
    'OnlyOffice DocumentServer inbox JWT validation must be boolean true.',
  );
  requireExact(
    token?.enable?.request?.outbox,
    true,
    'OnlyOffice DocumentServer outbox JWT signing must be boolean true.',
  );
  requireExact(
    token?.inbox?.inBody,
    true,
    'OnlyOffice DocumentServer inbox in-body JWT mode must be boolean true.',
  );
  requireExact(
    token?.outbox?.inBody,
    true,
    'OnlyOffice DocumentServer outbox in-body JWT mode must be boolean true.',
  );
  requireExact(
    token?.outbox?.algorithm,
    'HS256',
    'OnlyOffice DocumentServer outbox JWT algorithm must be HS256.',
  );

  for (const name of ['browser', 'inbox', 'outbox', 'session']) {
    requireSecretAgreement(secret?.[name], decoratorSecret, name);
  }
  return true;
}

function isMainModule() {
  return process.argv[1]
    && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1]);
}

if (isMainModule()) {
  if (process.argv.length !== 2) {
    throw new Error('Usage: verify-document-server-jwt-config.mjs');
  }
  verifyDocumentServerJwtConfig({
    configFile: process.env.ONLYOFFICE_LOCAL_CONFIG_FILE || DEFAULT_CONFIG_FILE,
  });
}
