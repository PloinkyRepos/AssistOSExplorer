#!/usr/bin/env node

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const SOURCE_DIRECTIVE = '  server localhost:8000 max_fails=0 fail_timeout=0s;';
const TARGET_DIRECTIVE = '  server [::1]:8000 max_fails=0 fail_timeout=0s;';
const PINNED_CONFIG_PATHS = Object.freeze({
  canonicalPath: '/etc/onlyoffice/documentserver/nginx/includes/http-common.conf',
  aliasPath: '/etc/nginx/includes/http-common.conf',
});
const PINNED_ALIAS_TARGET = '../../onlyoffice/documentserver/nginx/includes/http-common.conf';

function directiveLines(content) {
  return String(content).split(/\r\n|\n/).filter((line) => (
    /^[ \t]*server[ \t]+\S*:8000(?:[ \t]+[^;]*)?;[ \t]*$/.test(line)
  ));
}

function pinnedPaths(configPaths = PINNED_CONFIG_PATHS) {
  const canonicalPath = configPaths?.canonicalPath;
  const aliasPath = configPaths?.aliasPath;
  if (
    typeof canonicalPath !== 'string'
    || typeof aliasPath !== 'string'
    || canonicalPath.length === 0
    || aliasPath.length === 0
    || canonicalPath === aliasPath
  ) {
    throw new Error('OnlyOffice DocService nginx configuration requires distinct canonical and alias paths.');
  }
  return { canonicalPath, aliasPath };
}

function validatePinnedTopology(configPaths = PINNED_CONFIG_PATHS) {
  const paths = pinnedPaths(configPaths);
  const canonicalStat = fs.lstatSync(paths.canonicalPath);
  if (!canonicalStat.isFile() || canonicalStat.isSymbolicLink()) {
    throw new Error(`OnlyOffice DocService nginx canonical configuration is not a regular file: ${paths.canonicalPath}`);
  }
  const aliasStat = fs.lstatSync(paths.aliasPath);
  if (!aliasStat.isSymbolicLink()) {
    throw new Error(`OnlyOffice DocService nginx alias is not a symbolic link: ${paths.aliasPath}`);
  }
  const aliasTarget = fs.readlinkSync(paths.aliasPath);
  if (aliasTarget !== PINNED_ALIAS_TARGET) {
    throw new Error(`OnlyOffice DocService nginx alias has an unexpected target: ${paths.aliasPath}`);
  }
  const canonicalRealPath = fs.realpathSync(paths.canonicalPath);
  const aliasRealPath = fs.realpathSync(paths.aliasPath);
  if (canonicalRealPath !== aliasRealPath) {
    throw new Error('OnlyOffice DocService nginx canonical and alias paths resolve to different files.');
  }
  return paths;
}

function readPinnedShape(configPath, expectedDirective) {
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
  const paths = validatePinnedTopology(configPaths);
  const content = readPinnedShape(paths.canonicalPath, SOURCE_DIRECTIVE);
  fs.writeFileSync(
    paths.canonicalPath,
    content.replace(SOURCE_DIRECTIVE, TARGET_DIRECTIVE),
    'utf8',
  );
  verifyDocServiceNginxLoopback(paths);
}

export function verifyDocServiceNginxLoopback(configPaths = PINNED_CONFIG_PATHS) {
  const paths = validatePinnedTopology(configPaths);
  readPinnedShape(paths.canonicalPath, TARGET_DIRECTIVE);
  readPinnedShape(paths.aliasPath, TARGET_DIRECTIVE);
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
