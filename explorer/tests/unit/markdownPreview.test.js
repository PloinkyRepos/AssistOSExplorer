import test from 'node:test';
import assert from 'node:assert/strict';

import {
    extractScriptaPreviewImages,
    prepareMarkdownPreviewContent,
    renderMarkdownPreview,
} from '../../web-components/pages/file-exp/file-exp-utils.js';

test('Markdown preview preserves underscores in image resource URLs', () => {
    const workspaceUrl = '/document-multimedia/webmeet/room_e0cf0694-bd76-4e9d-8f74-a15bceeda8f4/assets/asset_0b5aab1a-18c7-4e44-8829-479931987e3e.png';
    const html = renderMarkdownPreview(`![1.png](${workspaceUrl})`, {
        buildResourceUrl: (resourcePath) => `/workspace-files${resourcePath}`
    });

    assert.match(html, new RegExp(`src="/workspace-files${workspaceUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    assert.doesNotMatch(html, /<em>/);
});

test('Markdown preview does not apply emphasis inside links or inline code', () => {
    const html = renderMarkdownPreview('[asset_name](/folder/file_name.png) and `room_id`');

    assert.match(html, /<a href="\/folder\/file_name\.png"[^>]*>asset_name<\/a>/);
    assert.match(html, /<code>room_id<\/code>/);
    assert.doesNotMatch(html, /<em>/);
});

test('Markdown preview consumes SCRIPTA image layout before structural comments are removed', () => {
    const workspaceUrl = '/document-multimedia/webmeet/room_1/assets/asset_1.png';
    const raw = `<!-- {"achilles-ide-document":{"id":"document-1","title":"Layout"}} -->
<!-- {"achilles-ide-chapter":{"id":"chapter-1","title":"Chapter"}} -->
## Chapter
<!-- {"achilles-ide-paragraph":{"id":"paragraph-1","pluginState":{"scripta":{"activeVariantId":"variant-1","variants":[{"id":"variant-1","text":"","images":[{"imageId":"image-1","assetId":"asset_1","alt":"Diagram","workspaceUrl":"${workspaceUrl}","position":0,"layout":{"widthPercent":30,"aspectRatio":"16:9","fit":"cover","alignment":"right"}}]}]}}}} -->
![Diagram](${workspaceUrl})`;

    const scriptaImages = extractScriptaPreviewImages(raw);
    assert.deepEqual(scriptaImages, [{
        workspaceUrl,
        widthPercent: 30,
        aspectRatio: '16:9',
        fit: 'cover',
        alignment: 'right',
    }]);

    const html = renderMarkdownPreview(prepareMarkdownPreviewContent(raw), {
        buildResourceUrl: (resourcePath) => `/workspace-files${resourcePath}`,
        scriptaImages,
    });
    assert.match(html, /class="markdown-image scripta-layout-image is-right"/);
    assert.match(html, /style="width:30%;aspect-ratio:16 \/ 9;object-fit:cover;margin-inline:auto 0"/);
    assert.doesNotMatch(html, /achilles-ide-paragraph/);
});
