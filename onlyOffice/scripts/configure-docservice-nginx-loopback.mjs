#!/usr/bin/env node

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const SOURCE_DIRECTIVE = '  server localhost:8000 max_fails=0 fail_timeout=0s;';
const TARGET_DIRECTIVE = '  server [::1]:8000 max_fails=0 fail_timeout=0s;';
const PINNED_CONFIG_PATHS = Object.freeze([
  '/etc/onlyoffice/documentserver/nginx/includes/http-common.conf',
  '/etc/nginx/includes/http-common.conf',
]);

function directiveLines(content) {
  return String(content).split(/\r\n|\n/).filter((line) => (
    /^[ \t]*server[ \t]+\S*:8000(?:[ \t]+[^;]*)?;[ \t]*$/.test(line)
  ));
}

function readPinnedShape(configPath, expectedDirective) {
  const stat = fs.lstatSync(configPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`OnlyOffice DocService nginx configuration is not a regular file: ${configPath}`);
  }
  const content = fs.readFileSync(configPath, 'utf8');
  const matches = directiveLines(content);
  if (matches.length !== 1 || matches[0] !== expectedDirective) {
    throw new Error(
      `OnlyOffice DocService nginx upstream must contain exactly one pinned ${expectedDirective} directive: ${configPath}`,
    );
  }
  return content;
}

export function configureDocServiceNginxLoopback(configPaths = PINNED_CONFIG_PATHS) {
  const paths = Array.from(configPaths);
  if (paths.length !== PINNED_CONFIG_PATHS.length || new Set(paths).size !== paths.length) {
    throw new Error('OnlyOffice DocService nginx configuration requires two distinct pinned files.');
  }

  const pending = paths.map((configPath) => ({
    configPath,
    content: readPinnedShape(configPath, SOURCE_DIRECTIVE),
  }));
  for (const { configPath, content } of pending) {
    fs.writeFileSync(configPath, content.replace(SOURCE_DIRECTIVE, TARGET_DIRECTIVE), 'utf8');
  }
  verifyDocServiceNginxLoopback(paths);
}

export function verifyDocServiceNginxLoopback(configPaths = PINNED_CONFIG_PATHS) {
  const paths = Array.from(configPaths);
  if (paths.length !== PINNED_CONFIG_PATHS.length || new Set(paths).size !== paths.length) {
    throw new Error('OnlyOffice DocService nginx verification requires two distinct pinned files.');
  }
  for (const configPath of paths) {
    readPinnedShape(configPath, TARGET_DIRECTIVE);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    configureDocServiceNginxLoopback();
  } else if (args.length === 1 && args[0] === '--verify') {
    verifyDocServiceNginxLoopback();
  } else {
    throw new Error('Usage: configure-docservice-nginx-loopback.mjs [--verify]');
  }
}
