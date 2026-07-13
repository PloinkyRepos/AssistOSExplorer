import assert from 'node:assert/strict';

const EXPECTED_SHARED_NETWORKS = Object.freeze({
  'webmeet-signaling': Object.freeze([
    'livekitserveragent',
    'web-publishing',
    'webmeetagent',
  ]),
  'webmeet-turn': Object.freeze([
    'livekitserveragent',
    'turnserveragent',
  ]),
  'office-publishing': Object.freeze([
    'onlyoffice',
    'web-publishing',
  ]),
});

const ISOLATED_AGENT_IDENTITIES = Object.freeze([
  'webtty',
  'webmeetstt',
  'umamiagent',
]);

const DEFAULT_NETWORK_PATTERN = /^default-[a-f0-9]{12}$/;

function sortedUnique(values) {
  return [...new Set(values.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))].sort();
}

function agentAliases(network) {
  assert.ok(Array.isArray(network.attachments), `${network.logicalName} attachments must be an array`);
  return sortedUnique(network.attachments
    .filter((attachment) => attachment?.ownership === 'agent')
    .flatMap((attachment) => {
      assert.ok(Array.isArray(attachment.aliases), `${network.logicalName} agent aliases must be arrays`);
      return attachment.aliases;
    }));
}

function assertManagedNetwork(network) {
  assert.equal(network.ownership, 'owned', `${network.logicalName} must be workspace-owned`);
  assert.equal(network.driver, 'bridge', `${network.logicalName} must use the bridge driver`);
  assert.equal(typeof network.physicalName, 'string', `${network.logicalName} must have a physicalName`);
  assert.ok(network.physicalName.length > 0, `${network.logicalName} physicalName must not be empty`);
  assert.ok(Array.isArray(network.attachments), `${network.logicalName} attachments must be an array`);
  assert.equal(
    network.attachments.every((attachment) => ['agent', 'gateway'].includes(attachment?.ownership)),
    true,
    `${network.logicalName} must not contain unknown attachments`,
  );

  const gatewayAttachments = network.attachments.filter((attachment) => attachment.ownership === 'gateway');
  assert.equal(gatewayAttachments.length, 1, `${network.logicalName} must have exactly one managed gateway attachment`);
  assert.deepEqual(
    sortedUnique(gatewayAttachments[0].aliases || []),
    ['ploinky-router'],
    `${network.logicalName} gateway must have exactly the ploinky-router alias`,
  );
}

export function assertExplorerNetworkTopology(status) {
  assert.ok(status && typeof status === 'object' && !Array.isArray(status), 'network status must be an object');
  assert.equal(status.schemaVersion, '2', 'network status schemaVersion must be 2');
  assert.equal(typeof status.workspaceHash, 'string', 'network status workspaceHash must be a string');
  assert.ok(status.workspaceHash.length > 0, 'network status workspaceHash must not be empty');
  assert.ok(Array.isArray(status.networks), 'network status networks must be an array');

  const byLogicalName = new Map();
  const byPhysicalName = new Map();
  for (const network of status.networks) {
    assert.equal(typeof network?.logicalName, 'string', 'each network must have a logicalName');
    assert.equal(byLogicalName.has(network.logicalName), false, `duplicate network ${network.logicalName}`);
    assertManagedNetwork(network);
    assert.equal(
      byPhysicalName.has(network.physicalName),
      false,
      `duplicate physical network ${network.physicalName}`,
    );
    byLogicalName.set(network.logicalName, network);
    byPhysicalName.set(network.physicalName, network);
  }

  for (const [logicalName, expectedAliases] of Object.entries(EXPECTED_SHARED_NETWORKS)) {
    const network = byLogicalName.get(logicalName);
    assert.ok(network, `missing shared network ${logicalName}`);
    assert.deepEqual(
      agentAliases(network),
      sortedUnique(expectedAliases),
      `${logicalName} must contain exactly the intended agent identities`
    );
  }

  const sharedAliases = sortedUnique(Object.keys(EXPECTED_SHARED_NETWORKS)
    .flatMap((logicalName) => agentAliases(byLogicalName.get(logicalName))));
  for (const identity of ISOLATED_AGENT_IDENTITIES) {
    assert.equal(
      sharedAliases.includes(identity),
      false,
      `${identity} must remain outside every shared trust zone`
    );
  }

  const isolatedNetworks = new Map();
  for (const identity of ISOLATED_AGENT_IDENTITIES) {
    const matches = status.networks.filter((network) => (
      DEFAULT_NETWORK_PATTERN.test(network.logicalName)
      && agentAliases(network).includes(identity)
    ));
    assert.equal(matches.length, 1, `${identity} must have exactly one owned default network`);
    const network = matches[0];
    assert.deepEqual(
      agentAliases(network),
      [identity],
      `${identity} default network must contain exactly its own agent alias`,
    );
    assert.equal(
      isolatedNetworks.has(network.physicalName),
      false,
      `${identity} must not share a default network with another isolated agent`,
    );
    isolatedNetworks.set(network.physicalName, identity);
  }

  assert.ok(status.gateway && typeof status.gateway === 'object', 'managed gateway status must be present');
  assert.equal(status.gateway.ownership, 'owned', 'managed gateway must be workspace-owned');
  assert.equal(status.gateway.state, 'running', 'managed gateway must be running');
  assert.ok(Array.isArray(status.gateway.attachments), 'managed gateway attachments must be an array');

  const gatewayPhysicalNames = status.gateway.attachments.map((attachment) => {
    assert.equal(typeof attachment?.physicalName, 'string', 'gateway attachment must have a physicalName');
    assert.deepEqual(
      sortedUnique(attachment.aliases || []),
      ['ploinky-router'],
      `${attachment.physicalName} gateway attachment must have exactly the ploinky-router alias`,
    );
    return attachment.physicalName;
  });
  assert.deepEqual(
    [...gatewayPhysicalNames].sort(),
    [...byPhysicalName.keys()].sort(),
    'managed gateway must attach to every and only workspace-owned managed network',
  );
}
