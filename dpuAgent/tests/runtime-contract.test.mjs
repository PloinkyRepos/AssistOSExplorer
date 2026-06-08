import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const agentRoot = path.resolve(new URL('..', import.meta.url).pathname);

test('package metadata does not expose the retired standalone MCP server', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(agentRoot, 'package.json'), 'utf8'));
  const serializedPackage = JSON.stringify(packageJson);

  assert.equal(fs.existsSync(path.join(agentRoot, 'server', 'standalone-mcp-server.mjs')), false);
  assert.equal(Object.prototype.hasOwnProperty.call(packageJson, 'bin'), false);
  assert.notEqual(packageJson.scripts?.start, 'node ./server/standalone-mcp-server.mjs');
  assert.equal(serializedPackage.includes('standalone-mcp-server'), false);
  assert.equal(serializedPackage.includes('mcp-sdk'), false);
});
