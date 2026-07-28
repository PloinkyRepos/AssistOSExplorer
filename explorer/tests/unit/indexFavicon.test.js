import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

test('Explorer declares an inline favicon without an extra failing request', () => {
    const html = fs.readFileSync(path.resolve(testDirectory, '../../index.html'), 'utf8');
    const favicon = html.match(/<link\s+rel="icon"\s+href="([^"]+)"/i);

    assert.ok(favicon, 'Explorer index should declare a favicon.');
    assert.match(favicon[1], /^data:image\/svg\+xml,/);
});
