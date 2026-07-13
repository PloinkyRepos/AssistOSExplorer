import test from 'node:test';
import assert from 'node:assert/strict';

import { assertExplorerNetworkTopology } from './network-topology.mjs';

const SHARED = {
  'webmeet-signaling': ['livekitserveragent', 'web-publishing', 'webmeetagent'],
  'webmeet-turn': ['livekitserveragent', 'turnserveragent'],
  'office-publishing': ['onlyoffice', 'web-publishing'],
};

function network(logicalName, aliases) {
  const physicalName = `ploinky-nw-workspace-${logicalName}`;
  return {
    logicalName,
    physicalName,
    ownership: 'owned',
    driver: 'bridge',
    attachments: [
      {
        containerName: 'ploinky-network-gateway-workspace',
        ownership: 'gateway',
        aliases: ['ploinky-router'],
      },
      ...aliases.map((alias) => ({
        containerName: `${alias}-container`,
        ownership: 'agent',
        aliases: [alias],
      })),
    ],
  };
}

function validStatus() {
  const networks = [
    ...Object.entries(SHARED).map(([logicalName, aliases]) => network(logicalName, aliases)),
    network('default-111111111111', ['webtty']),
    network('default-222222222222', ['webmeetstt']),
    network('default-333333333333', ['umamiagent']),
  ];
  return {
    schemaVersion: '2',
    workspaceHash: 'workspace',
    networks,
    gateway: {
      name: 'ploinky-network-gateway-workspace',
      ownership: 'owned',
      image: 'docker.io/assistos/ploinky-network-gateway:1',
      state: 'running',
      attachments: networks.map(({ physicalName }) => ({
        physicalName,
        aliases: ['ploinky-router'],
      })),
    },
  };
}

test('accepts exact shared zones, separate isolated defaults, and complete gateway coverage', () => {
  assert.doesNotThrow(() => assertExplorerNetworkTopology(validStatus()));
});

test('rejects isolated agents sharing one default network', () => {
  const status = validStatus();
  const sttNetwork = status.networks.find((entry) => entry.logicalName === 'default-222222222222');
  sttNetwork.attachments.push({
    containerName: 'umamiagent-container',
    ownership: 'agent',
    aliases: ['umamiagent'],
  });
  const removed = status.networks.find((entry) => entry.logicalName === 'default-333333333333');
  status.networks = status.networks.filter((entry) => entry !== removed);
  status.gateway.attachments = status.gateway.attachments.filter(
    (entry) => entry.physicalName !== removed.physicalName,
  );

  assert.throws(
    () => assertExplorerNetworkTopology(status),
    /default network must contain exactly its own agent alias|must not share a default network/,
  );
});

test('rejects missing isolated default networks', () => {
  const status = validStatus();
  const removed = status.networks.find((entry) => entry.logicalName === 'default-111111111111');
  status.networks = status.networks.filter((entry) => entry !== removed);
  status.gateway.attachments = status.gateway.attachments.filter(
    (entry) => entry.physicalName !== removed.physicalName,
  );

  assert.throws(() => assertExplorerNetworkTopology(status), /webtty must have exactly one owned default network/);
});

test('rejects foreign or stopped gateways', () => {
  const foreign = validStatus();
  foreign.gateway.ownership = 'foreign';
  assert.throws(() => assertExplorerNetworkTopology(foreign), /gateway must be workspace-owned/);

  const stopped = validStatus();
  stopped.gateway.state = 'exited';
  assert.throws(() => assertExplorerNetworkTopology(stopped), /gateway must be running/);
});

test('rejects missing or altered ploinky-router gateway attachments', () => {
  const wrongAlias = validStatus();
  wrongAlias.gateway.attachments[0].aliases = ['router'];
  assert.throws(() => assertExplorerNetworkTopology(wrongAlias), /exactly the ploinky-router alias/);

  const missing = validStatus();
  missing.gateway.attachments.pop();
  assert.throws(() => assertExplorerNetworkTopology(missing), /every and only workspace-owned managed network/);
});

test('rejects unknown attachments on managed networks', () => {
  const status = validStatus();
  status.networks[0].attachments.push({
    containerName: 'foreign-container',
    ownership: 'unknown',
    aliases: ['foreign'],
  });

  assert.throws(() => assertExplorerNetworkTopology(status), /must not contain unknown attachments/);
});
