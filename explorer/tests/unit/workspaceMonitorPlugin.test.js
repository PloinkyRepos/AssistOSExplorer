import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const explorerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('Workspace Monitor is an admin-only Explorer application plugin', () => {
    const explorerManifest = JSON.parse(fs.readFileSync(path.join(explorerRoot, 'manifest.json'), 'utf8'));
    const plugin = JSON.parse(fs.readFileSync(path.join(explorerRoot, 'IDE-plugins', 'workspace-monitor', 'config.json'), 'utf8'));
    assert.ok(!explorerManifest.enable.includes('workspaceMonitorAgent global'));
    assert.equal(explorerManifest.applicationPlugins['workspace-monitor'], true);
    assert.equal(plugin.pluginCategory, 'application');
    assert.equal(plugin.adminOnly, true);
    assert.equal(plugin.dependencies[0].type, 'embedded');
    assert.deepEqual(plugin.location, ['file-exp:account-menu']);
});

test('Workspace Monitor keeps read-only concerns in separate tabs', () => {
    const base = path.join(explorerRoot, 'IDE-plugins', 'workspace-monitor', 'components', 'workspace-monitor-dashboard');
    const html = fs.readFileSync(path.join(base, 'workspace-monitor-dashboard.html'), 'utf8');
    const script = fs.readFileSync(path.join(base, 'workspace-monitor-dashboard.js'), 'utf8');
    const css = fs.readFileSync(path.join(base, 'workspace-monitor-dashboard.css'), 'utf8');
    const buttonScript = fs.readFileSync(path.join(explorerRoot, 'IDE-plugins', 'workspace-monitor', 'workspace-monitor-button.js'), 'utf8');
    const buttonHtml = fs.readFileSync(path.join(explorerRoot, 'IDE-plugins', 'workspace-monitor', 'workspace-monitor-button.html'), 'utf8');
    for (const label of ['Overview', 'Resources', 'Router Logs', 'Policy Audit', 'DPU Audit']) {
        assert.match(html, new RegExp(`>${label}<`));
    }
    for (const sharedClass of ['panel', 'workspace-monitor-tabs', 'workspace-monitor-tab-shell', 'workspace-monitor-tab', 'status visible']) {
        assert.match(html, new RegExp(`class="[^"]*${sharedClass}`));
    }
    assert.doesNotMatch(html, /settings-tabs|settings-tab|application-tabs|application-tab/);
    assert.match(css, /\.workspace-monitor-tab-shell:has\(\.workspace-monitor-tab\[aria-selected="true"\]\)/);
    assert.match(css, /border-radius:\s*10px 10px 0 0/);
    assert.match(html, /<header>\s*<h1>Workspace monitor<\/h1>/);
    assert.match(html, /data-panel="overview"[\s\S]*class="cpu-monitor"[\s\S]*data-panel="resources"/);
    assert.match(html, /class="general-button secondary"/);
    assert.match(script, /className='panel metric-card'/);
    assert.doesNotMatch(`${html}\n${css}`, /workspace-monitor-header|modal-header|modal-title|modal-subtitle/);
    assert.match(script, /\/status\/data\?follow=1/);
    assert.match(script, /if \(tab === 'overview'\) this\.startOverview\(\)/);
    assert.match(script, /setAttribute\('aria-selected', String\(active\)\)/);
    assert.match(script, /createElementNS\(SVG_NAMESPACE, 'svg'\)/);
    assert.match(script, /appendChartSeries\(svg, workspaceSamples, scale, 'workspace'\)/);
    assert.match(script, /appendChartSeries\(svg, routerSamples, scale, 'router'\)/);
    assert.match(script, / C \$\{controlX\}/);
    assert.doesNotMatch(script, /createElement\('i'\)/);
    assert.match(css, /\.chart-line\s*\{[^}]*stroke:\s*currentColor/s);
    assert.match(css, /\.chart-line-workspace\s*\{[^}]*var\(--accent\)/s);
    assert.match(css, /\.chart-line-router\s*\{[^}]*var\(--red\)/s);
    assert.match(script, /\/dashboard\/tail\?source=/);
    assert.match(script, /dpu_audit_list/);
    assert.match(script, /dpu_audit_get/);
    assert.match(script, /MAX_LOG_CHARS/);
    assert.match(script, /appendData\(chunk\)/);
    assert.match(script, /deleteData\(0,/);
    assert.doesNotMatch(script, /output\.textContent\s*\+/);
    assert.match(script, /MAX_AUDIT_BYTES/);
    assert.match(script, /maxBytes:MAX_AUDIT_BYTES/);
    assert.match(buttonScript, /open\(targetUrl\.toString\(\), '_blank'/);
    assert.match(buttonScript, /this\.hostContext\?\.pluginIcon/);
    assert.match(buttonScript, /getAttribute\('data-plugin-icon'\)/);
    assert.doesNotMatch(buttonHtml, /src="\.\/icon\.svg"/);
    assert.doesNotMatch(`${script}\n${buttonScript}`, /showModal|closeModal/);
    assert.doesNotMatch(css, /dialog\.modal|(^|})\s*(table|pre|footer|th|td)\s*\{/m);
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
    for (const variable of ['--bg', '--text', '--text-soft', '--accent', '--border']) {
        assert.match(css, new RegExp(`var\\(${variable}\\)`));
    }
    assert.doesNotMatch(`${html}\n${script}`, /dashboard\/run|restart|execute command/i);
});

test('Explorer rejects direct admin-only component routes for non-admin users', () => {
    const mainSource = fs.readFileSync(path.join(explorerRoot, 'main.js'), 'utf8');
    assert.match(mainSource, /getRuntimeComponentPolicy\(runtimePlugins, pageName\)/);
    assert.match(mainSource, /routePolicy\?\.adminOnly && !isAdminUser\(authenticatedUser\)/);
    assert.match(mainSource, /componentPolicy\?\.adminOnly && !isAdminUser\(authenticatedUser\)/);
    assert.match(mainSource, /error\.code = 'ADMIN_REQUIRED'/);
});
