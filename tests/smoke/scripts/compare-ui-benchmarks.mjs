#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  compareBenchmarkReports,
  sanitizeError,
} from '../lib/ui-benchmark-metrics.mjs';

function printHelp() {
  console.log(`Compare Explorer UI benchmark reports

Usage:
  npm run benchmark:ui:compare -- <baseline-result.json> <candidate-result.json> [--output <path>]

The first report is the baseline. Negative deltas mean the candidate is faster.`);
}

function parseArgs(argv) {
  if (argv.includes('--help')) return { help: true };
  const positional = [];
  let output = '';
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--output') {
      if (!argv[index + 1] || argv[index + 1].startsWith('--')) {
        throw new Error('Missing value for --output.');
      }
      output = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (argv[index].startsWith('--')) throw new Error(`Unknown comparison option: ${argv[index]}`);
    positional.push(path.resolve(argv[index]));
  }
  if (positional.length !== 2) {
    throw new Error('Comparison requires exactly two UI benchmark result files.');
  }
  return {
    help: false,
    baselinePath: positional[0],
    candidatePath: positional[1],
    output,
  };
}

function readReport(filePath) {
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Benchmark report is invalid: ${filePath}`);
  }
  return payload;
}

function display(value) {
  return Number.isFinite(value) ? String(value) : 'n/a';
}

function printComparison(comparison) {
  console.log(`Explorer UI benchmark comparison: ${comparison.baseline.label} -> ${comparison.candidate.label}`);
  console.log('Negative delta means the candidate is faster.');
  console.log('');
  console.log('Operation                                   baseline   candidate    delta ms    delta %');
  for (const step of comparison.steps) {
    console.log([
      step.name.padEnd(43),
      display(step.baselineMedianMs).padStart(10),
      display(step.candidateMedianMs).padStart(12),
      display(step.deltaMs).padStart(12),
      display(step.deltaPercent).padStart(11),
    ].join(''));
  }
}

function main() {
  const config = parseArgs(process.argv.slice(2));
  if (config.help) {
    printHelp();
    return;
  }
  const comparison = compareBenchmarkReports(
    readReport(config.baselinePath),
    readReport(config.candidatePath),
  );
  printComparison(comparison);
  if (config.output) {
    fs.mkdirSync(path.dirname(config.output), { recursive: true });
    fs.writeFileSync(config.output, `${JSON.stringify(comparison, null, 2)}\n`, { mode: 0o600 });
    console.log('');
    console.log(`Comparison artifact: ${config.output}`);
  }
}

try {
  main();
} catch (error) {
  const safe = sanitizeError(error);
  console.error(`${safe.name}: ${safe.message}`);
  process.exitCode = 1;
}
