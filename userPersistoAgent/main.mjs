#!/usr/bin/env node
import { ensureUserPersistoSchema } from './lib/storage/ensure-schema.mjs';
import { ensureDefaultAdmin } from './lib/bootstrap.mjs';

async function main() {
  await ensureUserPersistoSchema();
  await ensureDefaultAdmin();
  console.log('UserPersisto Agent ready.');
  setInterval(() => {}, 60 * 60 * 1000);
}

main().catch((error) => {
  console.error('[UserPersisto] fatal:', error);
  process.exit(1);
});
