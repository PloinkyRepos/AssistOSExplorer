import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseTurnEndpoint,
  requireCredentialFreeCdpUrl,
  requirePublicIpv4,
} from './network.mjs';

test('remote CDP endpoints require query-free encrypted credential-free URLs', () => {
  assert.equal(
    requireCredentialFreeCdpUrl('wss://browser-a.example/devtools/browser/id', 'browser A'),
    'wss://browser-a.example/devtools/browser/id',
  );
  assert.equal(
    requireCredentialFreeCdpUrl('https://browser-b.example/', 'browser B'),
    'https://browser-b.example/',
  );
  for (const value of [
    'ws://browser-a.example/devtools/browser/id',
    'http://browser-a.example/',
    'wss://user:secret@browser-a.example/devtools/browser/id',
    'wss://browser-a.example/devtools/browser/id?token=secret',
    'wss://browser-a.example/devtools/browser/id#secret',
  ]) {
    assert.throws(() => requireCredentialFreeCdpUrl(value, 'browser A'), /credential-free/);
  }
});

test('TURN release-gate endpoints require exact non-secret host, port, scheme, and transport', () => {
  assert.deepEqual(parseTurnEndpoint('turn:relay.example:3478?transport=udp', {
    name: 'udp',
    expectedScheme: 'turn',
    expectedTransport: 'udp',
  }), {
    scheme: 'turn',
    host: 'relay.example',
    port: 3478,
    transport: 'udp',
  });
  assert.deepEqual(parseTurnEndpoint('turns:relay.example:5349?transport=tcp', {
    name: 'tls',
    expectedScheme: 'turns',
    expectedTransport: 'tcp',
  }), {
    scheme: 'turns',
    host: 'relay.example',
    port: 5349,
    transport: 'tcp',
  });

  for (const value of [
    'turn:relay.example?transport=udp',
    'turn:user:secret@relay.example:3478?transport=udp',
    'turn:relay.example:3478?transport=tcp',
    'turn:relay.example:3478?transport=udp&credential=secret',
    'turn:127.0.0.1:3478?transport=udp',
    'turn:10.0.0.1:3478?transport=udp',
  ]) {
    assert.throws(() => parseTurnEndpoint(value, {
      name: 'udp',
      expectedScheme: 'turn',
      expectedTransport: 'udp',
    }));
  }
});

test('native media gate rejects private, benchmark, and documentation IPv4 values', () => {
  assert.equal(requirePublicIpv4('8.8.8.8', 'media'), '8.8.8.8');
  for (const value of ['127.0.0.1', '10.0.0.1', '100.64.0.1', '169.254.1.1', '192.168.1.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1']) {
    assert.throws(() => requirePublicIpv4(value, 'media'));
  }
});
