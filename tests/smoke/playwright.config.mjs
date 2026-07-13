import { defineConfig, devices } from '@playwright/test';

import { smokeConfig } from './lib/config.mjs';

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: smokeConfig.timeouts.test,
  expect: {
    timeout: smokeConfig.timeouts.expect,
  },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  outputDir: 'test-results',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: smokeConfig.baseURL,
    actionTimeout: smokeConfig.timeouts.action,
    navigationTimeout: smokeConfig.timeouts.navigation,
    screenshot: 'only-on-failure',
    // Playwright traces persist raw network URLs and provide no URL redaction hook.
    // WebMeet signaling URLs contain browser-minted credentials, so traces stay off.
    trace: 'off',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true,
    permissions: ['camera', 'microphone'],
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--allow-http-screen-capture',
        '--auto-select-desktop-capture-source=Entire screen',
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
      },
    },
  ],
});
