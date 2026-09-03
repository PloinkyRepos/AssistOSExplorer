import fs from 'node:fs';
import path from 'node:path';

import { redactTraceText } from './redacted-trace.mjs';

export function redactReportBuffer(buffer) {
  // Keep screenshots, video and already-redacted trace ZIPs byte-for-byte.
  if (buffer.includes(0)) return buffer;
  const text = buffer.toString('utf8');
  if (!Buffer.from(text).equals(buffer)) return buffer;
  return Buffer.from(redactTraceText(text));
}

function redactError(error) {
  if (!error || typeof error !== 'object') return;
  for (const key of ['message', 'stack', 'snippet', 'value']) {
    if (typeof error[key] === 'string') error[key] = redactTraceText(error[key]);
  }
  redactError(error.cause);
}

function redactStep(step) {
  if (typeof step.title === 'string') step.title = redactTraceText(step.title);
  redactError(step.error);
  for (const child of step.steps || []) redactStep(child);
}

export default class RedactedReporter {
  onBegin(config, suite) {
    this.suite = suite;
    this.outputRoots = config.projects.map((project) => path.resolve(project.outputDir));
    this.failed = false;
  }

  printsToStdio() { return false; }

  onError(error) { redactError(error); }

  onStepBegin(_test, _result, step) { redactStep(step); }

  onStepEnd(_test, _result, step) { redactStep(step); }

  onTestEnd(_test, result) {
    redactError(result.error);
    for (const error of result.errors) redactError(error);
    for (const step of result.steps) redactStep(step);
    for (const channel of ['stdout', 'stderr']) {
      result[channel] = result[channel].map((chunk) => Buffer.isBuffer(chunk)
        ? redactReportBuffer(chunk) : redactTraceText(chunk));
    }
    for (const attachment of result.attachments) {
      try {
        if (attachment.body) attachment.body = redactReportBuffer(attachment.body);
        if (!attachment.path) continue;
        const file = fs.realpathSync(attachment.path);
        if (!this.outputRoots.some((root) => {
          let canonicalRoot;
          try {
            canonicalRoot = fs.realpathSync(root);
          } catch (error) {
            if (error.code === 'ENOENT') return false;
            throw error;
          }
          const relative = path.relative(canonicalRoot, file);
          return relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
        })) throw new Error('attachment is outside the test output directory');
        const original = fs.readFileSync(file);
        const safe = redactReportBuffer(original);
        if (!safe.equals(original)) fs.writeFileSync(file, safe);
      } catch {
        // Reporter exceptions are swallowed by Playwright. Hide an unreadable
        // attachment from later reporters and explicitly fail the run instead.
        delete attachment.path;
        attachment.body = Buffer.from('Attachment redaction failed; report publication was refused.');
        attachment.contentType = 'text/plain';
        const error = { message: 'Smoke attachment redaction failed.' };
        result.errors.push(error);
        result.error ||= error;
        result.status = 'failed';
        this.failed = true;
      }
    }
  }

  onEnd() {
    // HTML and JSON serialize the suite at onEnd, after this reporter runs.
    for (const test of this.suite?.allTests() || []) {
      for (const result of test.results) this.onTestEnd(test, result);
    }
    if (this.failed) return { status: 'failed' };
  }
}
