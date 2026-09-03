import { createReleaseGateFailureCollector } from './release-gate-failures.mjs';
import { redactTraceText, stopAndAttachRedactedTrace } from './redacted-trace.mjs';

export const COPILOT_TEARDOWN_TIMEOUT_MS = 120_000;

async function boundedOperation(label, operation, timeoutMs, onTimeout = () => {}) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          void Promise.resolve().then(onTimeout).catch(() => {});
          reject(new Error(`${label} exceeded its ${timeoutMs}ms teardown budget.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function finishCopilotGate({
  page,
  copilotPage,
  testInfo,
  primaryError = null,
  traceStarted = false,
  detachListeners = () => {},
  cleanupDirectory = null,
  stopTrace = stopAndAttachRedactedTrace,
  budgets = { summary: 5_000, screenshot: 10_000, trace: 30_000, close: 5_000, directory: 60_000 },
}) {
  const failures = createReleaseGateFailureCollector();
  const required = (label, operation, timeoutMs, onTimeout) => failures.required(
    label,
    () => boundedOperation(label, operation, timeoutMs, onTimeout),
  );
  await failures.required('Copilot listener cleanup', detachListeners);
  if (primaryError) {
    await required('Copilot failure summary', () => testInfo.attach('copilot-failure.json', {
      body: Buffer.from(redactTraceText(JSON.stringify({
        name: primaryError.name || 'Error',
        message: primaryError.message || String(primaryError),
      }, null, 2))),
      contentType: 'application/json',
    }), budgets.summary);
    await required('Copilot failure screenshot', async () => {
      const target = copilotPage || page;
      const screenshotPath = testInfo.outputPath('copilot-failure.png');
      await target.screenshot({ path: screenshotPath, fullPage: true, timeout: budgets.screenshot });
      await testInfo.attach('copilot-failure-screenshot', { path: screenshotPath, contentType: 'image/png' });
    }, budgets.screenshot);
  }
  if (traceStarted) {
    await required('Copilot redacted trace', () => stopTrace(page.context(), testInfo, 'copilot-421'), budgets.trace);
  }
  if (copilotPage) {
    await required('Copilot popup close', () => copilotPage.close(), budgets.close);
  }
  if (cleanupDirectory) {
    await required('Copilot directory cleanup', cleanupDirectory, budgets.directory, () => page.context().close());
  }
  if (failures.failures.length) {
    failures.throwIfAny({ primaryError, label: 'Copilot release gate' });
  }
}
