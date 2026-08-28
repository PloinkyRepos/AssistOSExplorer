import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  captureNestedPodmanEventCursor,
  collectNestedContainerEvents,
  collectExactRoutingServerIdentity,
  collectWebttyRecoveryDirectoryState,
  crashExactRoutingServer,
  independentlyTranslateMount,
  inspectNestedContainer,
  workspaceHash,
} from './webtty-runtime-evidence.mjs';

const OUTER_ID = 'a'.repeat(64);
const AGENT_ID = 'b'.repeat(64);
const AGENT = Object.freeze({
  runtime: 'podman',
  containerId: AGENT_ID,
  containerName: 'ploinky-agent-git',
  instanceId: 'instance-git',
  enableGeneration: 'enable-git',
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webtty-runtime-evidence-'));
  fs.mkdirSync(path.join(root, 'project', 'nested'), { recursive: true });
  fs.mkdirSync(path.join(root, '.ploinky', 'isolated'), { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    selected: path.join(root, 'project', 'nested'),
  };
}

function bind(source, destination, rw = true) {
  return { Type: 'bind', Source: source, Destination: destination, RW: rw };
}

test('independent evidence derives global and read-only folder mappings', (t) => {
  const { root, selected } = fixture(t);
  assert.deepEqual(
    independentlyTranslateMount(selected, [bind('/workspace', '/workspace')], root),
    { translatedCwd: '/workspace/project/nested', access: 'rw' },
  );
  assert.deepEqual(
    independentlyTranslateMount(selected, [
      bind('/workspace', '/workspace'),
      bind('/workspace/project', '/project-data', false),
    ], root),
    { translatedCwd: '/project-data/nested', access: 'ro' },
  );
});

test('independent evidence excludes isolated, ambiguous, and shadowed mounts', (t) => {
  const { root, selected } = fixture(t);
  assert.equal(
    independentlyTranslateMount(selected, [bind('/workspace/.ploinky/isolated', '/root')], root),
    null,
  );
  assert.equal(
    independentlyTranslateMount(selected, [
      bind('/workspace', '/workspace-a'),
      bind('/workspace', '/workspace-b'),
    ], root),
    null,
  );
  assert.equal(
    independentlyTranslateMount(selected, [
      bind('/workspace', '/workspace'),
      { Type: 'volume', Source: 'shadow', Destination: '/workspace/project', RW: true },
    ], root),
    null,
  );
});

test('workspace ownership hash is bound to the canonical workspace path', (t) => {
  const { root } = fixture(t);
  assert.match(workspaceHash(fs.realpathSync(root)), /^[a-f0-9]{12}$/);
  assert.notEqual(
    workspaceHash(fs.realpathSync(root)),
    workspaceHash(path.join(fs.realpathSync(root), 'different')),
  );
});

test('nested inspection accepts only exact immutable-ID not-found as absence', () => {
  assert.equal(inspectNestedContainer(OUTER_ID, AGENT_ID, () => ({
    ok: false,
    status: 125,
    stderr: `Error: no such container ${AGENT_ID}`,
  })), null);
  assert.throws(
    () => inspectNestedContainer(OUTER_ID, AGENT_ID, () => ({
      ok: false,
      status: 126,
      stderr: `Error: no such container "${AGENT_ID}"`,
    })),
    /failed closed/,
  );
  assert.equal(inspectNestedContainer(OUTER_ID, AGENT_ID, () => ({
    ok: false,
    status: 125,
    stderr: `Error: no such container "${AGENT_ID}"\n`,
  })), null);
  assert.throws(
    () => inspectNestedContainer(OUTER_ID, AGENT_ID, () => ({
      ok: false,
      status: 125,
      stderr: `Error: no such container ${OUTER_ID}`,
    })),
    /failed closed/,
  );
  assert.throws(
    () => inspectNestedContainer(OUTER_ID, AGENT_ID, () => ({
      ok: false,
      status: 126,
      stderr: 'Error: permission denied',
    })),
    /failed closed/,
  );
  for (const stderr of [
    `Error: cannot connect while inspecting ${AGENT_ID}: runtime database does not exist`,
    `Error: permission database does not exist for container ${AGENT_ID}`,
    `Error: cannot connect to nested runtime: no such container ${AGENT_ID}`,
    `Error: permission denied; container ${AGENT_ID} does not exist in cached database`,
  ]) {
    assert.throws(
      () => inspectNestedContainer(OUTER_ID, AGENT_ID, () => ({ ok: false, status: 125, stderr })),
      /failed closed/,
    );
  }
});

test('nested event audit binds exact cursors and immutable target identity without a sampling gap', () => {
  const evidence = { outerContainerId: OUTER_ID };
  const since = '2026-08-28T10:00:00.000Z';
  const until = '2026-08-28T10:00:01.000Z';
  assert.equal(captureNestedPodmanEventCursor(evidence, {
    command(command, args) {
      assert.equal(command, 'podman');
      assert.deepEqual(args, [
        'exec', OUTER_ID,
        '/usr/local/bin/node', '--eval', 'process.stdout.write(new Date().toISOString())',
      ]);
      return since;
    },
  }), since);

  let invocation = null;
  const events = collectNestedContainerEvents(evidence, AGENT, {
    since,
    until,
    command(command, args) {
      invocation = { command, args };
      return `${JSON.stringify({
        ID: AGENT_ID,
        Type: 'container',
        Status: 'exec',
        time: 1_787_900_000,
        timeNano: 1_787_900_000_100_000_000,
        Attributes: {},
      })}\n${JSON.stringify({
        ID: AGENT_ID,
        Type: 'container',
        Status: 'exec_died',
        time: 1_787_900_000,
        timeNano: 1_787_900_000_200_000_000,
        Attributes: { execID: 'c'.repeat(64) },
      })}\n`;
    },
  });
  assert.deepEqual(events.map((event) => event.status), ['exec', 'exec_died']);
  assert.equal(invocation.command, 'podman');
  assert.deepEqual(invocation.args, [
    'exec', OUTER_ID,
    '/usr/bin/podman', 'events',
    '--stream=false', '--no-trunc=true',
    '--since', since, '--until', until,
    '--filter', `container=${AGENT_ID}`,
    '--format', 'json',
  ]);
  assert.throws(
    () => collectNestedContainerEvents(evidence, AGENT, {
      since,
      until,
      command: () => JSON.stringify({
        ID: OUTER_ID,
        Type: 'container',
        Status: 'exec',
        time: 1,
        timeNano: 1,
      }),
    }),
    /invalid or foreign event/,
  );
});

test('RoutingServer crash is issued only inside the exact live Box and requires process evidence', () => {
  let invocation = null;
  const result = crashExactRoutingServer({ outerContainerId: OUTER_ID }, AGENT, {
    command(command, args, options) {
      invocation = { command, args, options };
      return {
        watchdogPid: 40,
        watchdogStartTime: '987650',
        routerPid: 41,
        routerStartTime: '987654',
        recoveryRecord: {
          recordCount: 1,
          targetKind: 'agent',
          ptyState: 'pty-ready',
          matchesExpectedTarget: true,
        },
      };
    },
  });
  assert.deepEqual(result, {
    watchdogPid: 40,
    watchdogStartTime: '987650',
    routerPid: 41,
    routerStartTime: '987654',
    recoveryRecord: {
      recordCount: 1,
      targetKind: 'agent',
      ptyState: 'pty-ready',
      matchesExpectedTarget: true,
    },
  });
  assert.equal(invocation.command, 'podman');
  assert.deepEqual(invocation.args.slice(0, 6), [
    'exec', '--user', 'podman', OUTER_ID, '/usr/local/bin/node', '--input-type=module',
  ]);
  assert.equal(invocation.args[6], '--eval');
  assert.match(invocation.args[7], /process\.kill\(revalidated\.router\.pid, 'SIGKILL'\)/);
  assert.deepEqual(JSON.parse(Buffer.from(invocation.args[8], 'base64url').toString('utf8')), AGENT);
  assert.deepEqual(invocation.options, { json: true });

  assert.throws(
    () => crashExactRoutingServer({ outerContainerId: OUTER_ID }, AGENT, {
      command: () => ({ routerPid: 0, routerStartTime: '' }),
    }),
    /exact process identity evidence/,
  );
  assert.throws(
    () => crashExactRoutingServer({ outerContainerId: 'short' }, AGENT, { command: () => ({}) }),
    /Exact live Box identity/,
  );

  const observed = collectExactRoutingServerIdentity({ outerContainerId: OUTER_ID }, {
    command: (_command, args) => {
      assert.doesNotMatch(args[7], /process\.kill/);
      return {
        watchdogPid: 40,
        watchdogStartTime: '987650',
        routerPid: 42,
        routerStartTime: '987655',
      };
    },
  });
  assert.deepEqual(observed, {
    watchdogPid: 40,
    watchdogStartTime: '987650',
    routerPid: 42,
    routerStartTime: '987655',
  });

  assert.deepEqual(collectWebttyRecoveryDirectoryState({ outerContainerId: OUTER_ID }, {
    command: () => ({ recordCount: 0, temporaryCount: 0, otherCount: 0 }),
  }), { recordCount: 0, temporaryCount: 0, otherCount: 0 });
});
