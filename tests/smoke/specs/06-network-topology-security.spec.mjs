import { execFileSync } from 'node:child_process';

import { expect, test } from '@playwright/test';

import { smokeConfig } from '../lib/config.mjs';
import { assertExplorerNetworkTopology } from '../lib/network-topology.mjs';

test.describe('rootless network topology @external', () => {
  test.skip(!smokeConfig.flags.networkTopology, 'Set SMOKE_NETWORK_TOPOLOGY=1 to inspect a local Ploinky workspace.');

  test('shared trust zones expose only their canonical agent identities', async () => {
    const output = execFileSync(
      smokeConfig.ploinkyBin,
      ['network', 'status', '--json'],
      {
        cwd: smokeConfig.workspaceRoot,
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    expect(() => assertExplorerNetworkTopology(JSON.parse(output))).not.toThrow();
  });
});
