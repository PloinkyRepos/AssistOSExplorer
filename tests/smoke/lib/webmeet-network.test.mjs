import assert from 'node:assert/strict';
import test from 'node:test';

import {
  joinMaterialAdvanced,
  newConnectedPeerConnectionIndices,
  selectedPairsUseLocalUdpMux,
} from './webmeet.mjs';

function pair(overrides = {}) {
  return {
    selected: true,
    bytesSent: 100,
    bytesReceived: 200,
    local: { candidateType: 'host', turnEndpoint: null },
    remote: { protocol: 'udp', address: '10.0.0.5', port: 7882 },
    ...overrides,
  };
}

test('local screen mux predicate requires active non-relay UDP 7882', () => {
  assert.equal(selectedPairsUseLocalUdpMux([pair()]), true);
  assert.equal(selectedPairsUseLocalUdpMux([]), false);
  assert.equal(selectedPairsUseLocalUdpMux([pair({ bytesSent: 0, bytesReceived: 0 })]), false);
  assert.equal(selectedPairsUseLocalUdpMux([pair({ local: { candidateType: 'relay', turnEndpoint: null } })]), false);
  assert.equal(selectedPairsUseLocalUdpMux([pair({ local: { candidateType: 'host', turnEndpoint: { host: 'turn.example' } } })]), false);
  assert.equal(selectedPairsUseLocalUdpMux([pair({ remote: { protocol: 'udp', address: '10.0.0.5', port: 7881 } })]), false);
  assert.equal(selectedPairsUseLocalUdpMux([pair({ remote: { protocol: 'tcp', address: '10.0.0.5', port: 7882 } })]), false);
});

test('local screen mux predicate deliberately does not claim configured public IPv4', () => {
  const privatePair = pair({
    remote: { protocol: 'udp', address: '192.168.122.10', port: 7882 },
  });
  assert.equal(selectedPairsUseLocalUdpMux([privatePair]), true);
  assert.equal(selectedPairsUseLocalUdpMux([privatePair], { requirePublicAddress: true }), false);
  assert.equal(selectedPairsUseLocalUdpMux([pair({
    remote: { protocol: 'udp', address: '8.8.8.8', port: 7882 },
  })], { requirePublicAddress: true }), true);
});

test('closed peer connections cannot satisfy the active local screen mux predicate', () => {
  assert.equal(selectedPairsUseLocalUdpMux([pair({ peerConnectionState: 'closed' })]), false);
  assert.equal(selectedPairsUseLocalUdpMux([pair({ peerConnectionState: 'connected' })]), true);
});

function material(overrides = {}) {
  return {
    participantIdentity: 'participant-a',
    hasParticipantToken: true,
    capturedAtMs: 900_000,
    expiresAtMs: 1_000_000,
    participantTokenFingerprint: 'c'.repeat(64),
    rtcConfigFingerprint: 'd'.repeat(64),
    materialFingerprint: 'a'.repeat(64),
    iceServerCount: 1,
    everyIceServerHasCredential: true,
    configurationGeneration: 'generation-a',
    publicationGeneration: '1',
    peerConnectionCount: 2,
    connectedPeerConnectionCount: 1,
    peerConnections: [
      { index: 0, connectionState: 'connected' },
      { index: 1, connectionState: 'closed' },
    ],
    roomState: 'Connected',
    liveKitConnectionState: 'connected',
    ...overrides,
  };
}

function advancedMaterial(overrides = {}) {
  return material({
    capturedAtMs: 1_900_000,
    expiresAtMs: 2_000_000,
    participantTokenFingerprint: 'e'.repeat(64),
    rtcConfigFingerprint: 'f'.repeat(64),
    materialFingerprint: 'b'.repeat(64),
    peerConnectionCount: 4,
    connectedPeerConnectionCount: 2,
    peerConnections: [
      { index: 0, connectionState: 'closed' },
      { index: 1, connectionState: 'closed' },
      { index: 2, connectionState: 'connected' },
      { index: 3, connectionState: 'connected' },
    ],
    ...overrides,
  });
}

test('join-material advancement requires identity continuity, a newer expiry, a new digest, and recreated peer connections', () => {
  const before = material();
  const advanced = advancedMaterial();
  assert.equal(joinMaterialAdvanced(before, advanced), true);
  assert.deepEqual(newConnectedPeerConnectionIndices(before, advanced), [2, 3]);
  assert.equal(joinMaterialAdvanced(before, advancedMaterial({
    materialFingerprint: before.materialFingerprint,
  })), false);
  assert.equal(joinMaterialAdvanced(before, advancedMaterial({
    configurationGeneration: 'generation-b',
  })), false);
  assert.equal(joinMaterialAdvanced(before, advancedMaterial({
    participantIdentity: 'participant-b',
  })), false);
  assert.equal(joinMaterialAdvanced(before, advancedMaterial({
    peerConnectionCount: 2,
    peerConnections: before.peerConnections,
  })), false);
  assert.equal(joinMaterialAdvanced(before, advancedMaterial({
    rtcConfigFingerprint: before.rtcConfigFingerprint,
  })), false);
  assert.equal(joinMaterialAdvanced(before, advancedMaterial({
    peerConnections: [
      { index: 0, connectionState: 'connected' },
      { index: 1, connectionState: 'closed' },
      { index: 2, connectionState: 'connected' },
      { index: 3, connectionState: 'connected' },
    ],
  })), false);
});
