import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const pluginRoot = path.resolve(import.meta.dirname, '../IDE-plugins/scripta-variants');

test('Advanced Editor SCRIPTA variants use the Explorer shared view with a local persistence adapter', async () => {
    const [configText, template, source] = await Promise.all([
        fs.readFile(path.join(pluginRoot, 'config.json'), 'utf8'),
        fs.readFile(path.join(pluginRoot, 'scripta-variants.html'), 'utf8'),
        fs.readFile(path.join(pluginRoot, 'scripta-variants.js'), 'utf8')
    ]);
    const config = JSON.parse(configText);
    const dependency = config.dependencies.find((entry) => entry.component === 'scripta-variants-view');

    assert.equal(dependency.baseUrl, '/explorer/shared/ui/scripta-variants-view/scripta-variants-view');
    assert.match(template, /<scripta-variants-view data-presenter="scripta-variants-view"/);
    assert.match(source, /await this\.variantsView\.presenterReadyPromise/);
    assert.match(source, /scripta-p-variant-vote/);
    assert.match(source, /scripta-p-variant-add/);
    assert.match(source, /scripta-p-variant-edit/);
    assert.match(source, /scripta-p-variant-delete/);
    assert.match(source, /variant\.createdBy === this\.userHash/);
    assert.match(source, /participant-/);
    assert.doesNotMatch(source, /Math\.imul/);
    assert.match(source, /documentPresenter\.updateParagraphModel/);
    assert.doesNotMatch(template, /data-role="variantTabs"/);
});
