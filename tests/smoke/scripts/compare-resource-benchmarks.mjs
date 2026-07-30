#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { compareResourceReports } from '../lib/resource-benchmark-metrics.mjs';
import { sanitizeError } from '../lib/ui-benchmark-metrics.mjs';

function printHelp() {
  console.log(`Compare Explorer deployment resource benchmark reports

Usage:
  npm run benchmark:resources:compare -- \\
    <master-result.json> \\
    <ploinky-proxy-result.json> \\
    [--output <comparison.json>]

The first report must be a direct-host master deployment. Positive deltas mean
the ploinky-proxy candidate consumed more than the master reference.`);
}

function parseArgs(argv) {
  if (argv.includes('--help')) return { help: true };
  const positional = [];
  let output = '';
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--output') {
      if (!argv[index + 1] || argv[index + 1].startsWith('--')) {
        throw new Error('Missing value for --output.');
      }
      output = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (argument.startsWith('--')) {
      throw new Error(`Unknown resource benchmark comparison option: ${argument}`);
    }
    positional.push(path.resolve(argument));
  }
  if (positional.length !== 2) {
    throw new Error('Resource comparison requires master and ploinky-proxy result files.');
  }
  return {
    help: false,
    baselinePath: positional[0],
    candidatePath: positional[1],
    output,
  };
}

function readReport(filePath) {
  const report = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error(`Resource benchmark report is invalid: ${filePath}`);
  }
  return report;
}

function display(value) {
  return Number.isFinite(value) ? String(value) : 'n/a';
}

function printRows(title, rows) {
  console.log('');
  console.log(title);
  console.log('Metric                         statistic          master          candidate           delta        delta %');
  for (const row of rows) {
    console.log([
      row.name.padEnd(31),
      row.statistic.padEnd(15),
      display(row.baseline).padStart(15),
      display(row.candidate).padStart(19),
      display(row.delta).padStart(16),
      display(row.deltaPercent).padStart(15),
    ].join(''));
  }
}

function printComparison(comparison) {
  console.log(
    `Explorer resource comparison: ${comparison.reference.label} -> ${comparison.candidate.label}`,
  );
  console.log('Positive deltas mean the candidate consumed more than the master reference.');
  printRows('Steady-state distributions', comparison.metrics);
  printRows('Growth rates', comparison.slopes);
}

function writeComparison(outputPath, comparison) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(outputPath, `${JSON.stringify(comparison, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(outputPath, 0o600);
}

function main() {
  const config = parseArgs(process.argv.slice(2));
  if (config.help) {
    printHelp();
    return;
  }
  const comparison = compareResourceReports(
    readReport(config.baselinePath),
    readReport(config.candidatePath),
  );
  printComparison(comparison);
  if (config.output) {
    writeComparison(config.output, comparison);
    console.log('');
    console.log(`Resource comparison artifact: ${config.output}`);
  }
}

try {
  main();
} catch (error) {
  const safe = sanitizeError(error);
  console.error(`${safe.name}: ${safe.message}`);
  process.exitCode = 1;
}
