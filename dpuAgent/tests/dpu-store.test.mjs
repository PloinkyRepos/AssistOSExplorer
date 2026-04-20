import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempWorkspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dpu-store-workspace-'));
const tempDpuDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dpu-store-data-'));
const moduleSuffix = `?test=${Date.now()}`;
const storeUrl = new URL('../lib/dpu-store.mjs', import.meta.url);
const {
  appendAuditClientEvent,
  getAuditConfig,
  getAuditEntry,
  getWorkspaceRoots,
  listAuditEntries,
  setAuditConfig,
  addConfidentialComment,
  createConfidential,
  deleteConfidentialComment,
  getConfidentialById,
  getSecretByKey,
  getAgentPolicyForPrincipal,
  getWhoAmI,
  grantSecret,
  grantConfidential,
  putSecret,
  resolveActor,
  setAgentPolicyAllowedRoles
} = await import(`${storeUrl.href}${moduleSuffix}`);

const previousWorkspaceRoot = process.env.DPU_WORKSPACE_ROOT;
const previousDpuDataRoot = process.env.DPU_DATA_ROOT;
const previousMasterKey = process.env.DPU_MASTER_KEY;

process.env.DPU_WORKSPACE_ROOT = tempWorkspaceDir;
process.env.DPU_DATA_ROOT = tempDpuDataDir;
process.env.DPU_MASTER_KEY = 'unit-test-master-key';

const authInfo = {
  user: {
    email: 'owner@example.com'
  }
};

const adminAuth = {
  user: {
    id: 'local:admin',
    username: 'admin',
    email: 'admin@example.com'
  }
};

async function getStoredObject(objectId) {
  const statePath = path.join(tempDpuDataDir, 'state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  return state.objects[objectId];
}

function getStoredState() {
  const statePath = path.join(tempDpuDataDir, 'state.json');
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

function setStoredState(state) {
  const statePath = path.join(tempDpuDataDir, 'state.json');
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
}

function getBlobPath(objectId) {
  return path.join(tempDpuDataDir, 'blobs', objectId);
}

function getSecretsPath() {
  return path.join(tempDpuDataDir, 'secrets.json');
}

function getPermissionsManifestPath() {
  return path.join(tempDpuDataDir, 'permissions.manifest.json');
}

function getPermissionsManifest() {
  return JSON.parse(fs.readFileSync(getPermissionsManifestPath(), 'utf8'));
}

function getAuditDirPath() {
  return path.join(tempDpuDataDir, 'audit');
}

function writeAgentManifest(agentName, manifest) {
  const manifestPath = path.join(tempWorkspaceDir, '.ploinky', 'repos', 'TestSuite', agentName, 'manifest.json');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

test.beforeEach(() => {
  fs.rmSync(tempWorkspaceDir, { recursive: true, force: true });
  fs.rmSync(tempDpuDataDir, { recursive: true, force: true });
  fs.mkdirSync(tempWorkspaceDir, { recursive: true });
  fs.mkdirSync(tempDpuDataDir, { recursive: true });
});

test.after(() => {
  if (previousWorkspaceRoot === undefined) {
    delete process.env.DPU_WORKSPACE_ROOT;
  } else {
    process.env.DPU_WORKSPACE_ROOT = previousWorkspaceRoot;
  }
  if (previousDpuDataRoot === undefined) {
    delete process.env.DPU_DATA_ROOT;
  } else {
    process.env.DPU_DATA_ROOT = previousDpuDataRoot;
  }
  if (previousMasterKey === undefined) {
    delete process.env.DPU_MASTER_KEY;
  } else {
    process.env.DPU_MASTER_KEY = previousMasterKey;
  }
  fs.rmSync(tempWorkspaceDir, { recursive: true, force: true });
  fs.rmSync(tempDpuDataDir, { recursive: true, force: true });
});

test('confidential files are encrypted at rest outside the workspace boundary', async () => {
  await getWhoAmI(authInfo);
  const created = await createConfidential(authInfo, {
    type: 'file',
    name: 'note.txt',
    content: 'top secret text',
    mimeType: 'text/plain'
  });
  assert.equal(created.ok, true);
  const objectRecord = await getStoredObject(created.object.id);
  const blobPath = getBlobPath(created.object.id);
  const rawOnDisk = fs.readFileSync(blobPath, 'utf8');

  assert.equal(objectRecord.storagePath, undefined);
  assert.equal(path.join(tempDpuDataDir, 'state.json').startsWith(`${tempWorkspaceDir}${path.sep}`), false);
  assert.equal(blobPath.startsWith(`${tempWorkspaceDir}${path.sep}`), false);
  assert.match(rawOnDisk, /^DPUENC1:/);
  assert.notEqual(rawOnDisk, 'top secret text');

  const fetched = await getConfidentialById(authInfo, { id: created.object.id });
  assert.equal(fetched.ok, true);
  assert.equal(fetched.object.content, 'top secret text');
});

test('secret values are encrypted at rest and remain readable through ACL-aware APIs', async () => {
  const readerAuth = {
    user: {
      email: 'reader@example.com'
    }
  };
  await putSecret(authInfo, { key: 'API_TOKEN', value: 'top-secret-value' });
  await grantSecret(authInfo, { key: 'API_TOKEN', principal: 'reader@example.com', role: 'read' });
  const rawOnDisk = fs.readFileSync(getSecretsPath(), 'utf8');

  assert.match(rawOnDisk, /^DPUSECS1:/);
  assert.equal(rawOnDisk.includes('top-secret-value'), false);

  const fetched = await getSecretByKey(readerAuth, { key: 'API_TOKEN' });
  assert.equal(fetched.ok, true);
  assert.equal(fetched.secret.value, 'top-secret-value');
});

test('delegated secret reads accept direct agent invocations without a binding id', async () => {
  const readerAuth = {
    user: {
      email: 'reader@example.com'
    }
  };
  await putSecret(authInfo, { key: 'DIRECT_TOKEN', value: 'direct-value' });
  await grantSecret(authInfo, { key: 'DIRECT_TOKEN', principal: 'reader@example.com', role: 'read' });

  const delegatedAuth = {
    user: {
      email: 'reader@example.com'
    },
    agent: {
      principalId: 'agent:AssistOSExplorer/gitAgent',
      name: 'gitAgent'
    },
    invocation: {
      scope: ['secret:read'],
      tool: 'secret_get',
      workspaceId: 'default'
    }
  };

  const fetched = await getSecretByKey(delegatedAuth, { key: 'DIRECT_TOKEN' });
  assert.equal(fetched.ok, true);
  assert.equal(fetched.secret.value, 'direct-value');
});

test('delegated secret reads reject missing required scope', async () => {
  await putSecret(authInfo, { key: 'DIRECT_SCOPE_TOKEN', value: 'direct-value' });
  await grantSecret(authInfo, { key: 'DIRECT_SCOPE_TOKEN', principal: 'reader@example.com', role: 'read' });

  const delegatedAuth = {
    user: {
      email: 'reader@example.com'
    },
    agent: {
      principalId: 'agent:AssistOSExplorer/gitAgent',
      name: 'gitAgent'
    },
    invocation: {
      scope: ['secret:write'],
      tool: 'secret_get',
      workspaceId: 'default'
    }
  };

  await assert.rejects(
    () => getSecretByKey(delegatedAuth, { key: 'DIRECT_SCOPE_TOKEN' }),
    /Invocation scope does not permit secret_get/
  );
});

test('plaintext secret storage is rejected', async () => {
  const readerAuth = {
    user: {
      email: 'reader@example.com'
    }
  };
  await putSecret(authInfo, { key: 'LEGACY_TOKEN', value: 'legacy-value' });
  await grantSecret(authInfo, { key: 'LEGACY_TOKEN', principal: 'reader@example.com', role: 'read' });
  fs.writeFileSync(getSecretsPath(), 'LEGACY_TOKEN=legacy-value\n', 'utf8');
  await assert.rejects(
    () => getSecretByKey(readerAuth, { key: 'LEGACY_TOKEN' }),
    /DPU secret storage is invalid/
  );
});

test('plaintext confidential storage is rejected', async () => {
  await getWhoAmI(authInfo);
  const created = await createConfidential(authInfo, {
    type: 'file',
    name: 'legacy.txt',
    content: '',
    mimeType: 'text/plain'
  });
  assert.equal(created.ok, true);
  const objectRecord = await getStoredObject(created.object.id);

  fs.writeFileSync(getBlobPath(objectRecord.id), 'legacy plaintext', 'utf8');
  const beforeRead = fs.readFileSync(getBlobPath(objectRecord.id), 'utf8');
  assert.equal(beforeRead, 'legacy plaintext');

  await assert.rejects(
    () => getConfidentialById(authInfo, { id: created.object.id }),
    /Confidential file storage is invalid/
  );
});

test('missing confidential blob is rejected', async () => {
  await getWhoAmI(authInfo);
  const created = await createConfidential(authInfo, {
    type: 'file',
    name: 'missing.txt',
    content: 'must exist',
    mimeType: 'text/plain'
  });
  assert.equal(created.ok, true);

  fs.rmSync(getBlobPath(created.object.id), { force: true });

  await assert.rejects(
    () => getConfidentialById(authInfo, { id: created.object.id }),
    /Confidential file storage is missing/
  );
});

test('resolveActor uses a single canonical principal with email priority', () => {
  const actor = resolveActor({
    user: {
      email: 'Reader@Example.com',
      id: 'reader-id',
      username: 'reader-user'
    }
  });

  assert.equal(actor.principalId, 'reader@example.com');
});

test('My Space root id is the user privateId', async () => {
  const whoami = await getWhoAmI(authInfo);
  assert.equal(whoami.ok, true);
  assert.equal(whoami.userSpace.mySpaceRootId, whoami.userSpace.privateId);

  const state = getStoredState();
  assert.ok(state.objects[whoami.userSpace.privateId]);
  assert.equal(state.objects[whoami.userSpace.privateId].name, 'My Space');
});

test('workspace roots expose audit only to admin viewers', async () => {
  const adminRoots = await getWorkspaceRoots(adminAuth);
  const userRoots = await getWorkspaceRoots(authInfo);
  assert.equal(adminRoots.ok, true);
  assert.equal(adminRoots.roots.audit.path, '/Confidential/Audit');
  assert.equal(userRoots.ok, true);
  assert.equal(userRoots.roots.audit, undefined);
});

test('whoami rejects delegated calls without a read/access scope', async () => {
  const delegatedAuth = {
    user: {
      email: 'owner@example.com'
    },
    agent: {
      principalId: 'agent:AssistOSExplorer/gitAgent',
      name: 'gitAgent'
    },
    invocation: {
      scope: ['secret:write'],
      tool: 'dpu_whoami',
      workspaceId: 'default'
    }
  };

  await assert.rejects(
    () => getWhoAmI(delegatedAuth),
    /Invocation scope does not permit secret_whoami/
  );
});

test('workspace roots reject delegated calls without a read/access scope', async () => {
  const delegatedAuth = {
    user: {
      email: 'owner@example.com'
    },
    agent: {
      principalId: 'agent:AssistOSExplorer/gitAgent',
      name: 'gitAgent'
    },
    invocation: {
      scope: ['secret:write'],
      tool: 'dpu_workspace_roots',
      workspaceId: 'default'
    }
  };

  await assert.rejects(
    () => getWorkspaceRoots(delegatedAuth),
    /Invocation scope does not permit dpu_workspace_roots/
  );
});

test('secret ACL principals are stored canonically and registry aliases keep the same principal across auth shapes', async () => {
  const ownerAuth = {
    user: {
      email: 'owner@example.com'
    }
  };
  const readerAuth = {
    user: {
      email: 'reader@example.com',
      id: 'reader-id',
      username: 'reader-user'
    }
  };
  const idOnlyAuth = {
    user: {
      id: 'reader-id',
      username: 'reader-user'
    }
  };

  await putSecret(ownerAuth, { key: 'CANONICAL_SECRET', value: 'value' });
  await grantSecret(ownerAuth, {
    key: 'CANONICAL_SECRET',
    principal: 'Reader@Example.com',
    role: 'read'
  });

  const manifest = getPermissionsManifest();
  assert.equal(manifest.permissions.secrets.CANONICAL_SECRET.acl['reader@example.com'], 'read');
  assert.equal(manifest.permissions.secrets.CANONICAL_SECRET.acl['Reader@Example.com'], undefined);

  const canonicalReader = await getSecretByKey(readerAuth, { key: 'CANONICAL_SECRET' });
  assert.equal(canonicalReader.ok, true);
  assert.equal(canonicalReader.secret.role, 'read');

  const idOnlyReader = await getSecretByKey(idOnlyAuth, { key: 'CANONICAL_SECRET' });
  assert.equal(idOnlyReader.ok, true);
  assert.equal(idOnlyReader.secret.role, 'read');
});

test('central permissions manifest becomes the ACL source of truth for secret access', async () => {
  const ownerAuth = {
    user: {
      email: 'owner@example.com'
    }
  };
  const readerAuth = {
    user: {
      email: 'reader@example.com'
    }
  };

  await putSecret(ownerAuth, { key: 'MANIFEST_SECRET', value: 'manifest-value' });
  await grantSecret(ownerAuth, {
    key: 'MANIFEST_SECRET',
    principal: 'reader@example.com',
    role: 'read'
  });

  const state = getStoredState();
  state.secrets.MANIFEST_SECRET.acl = {
    'reader@example.com': 'write'
  };
  setStoredState(state);

  const manifest = getPermissionsManifest();
  assert.equal(manifest.permissions.secrets.MANIFEST_SECRET.acl['reader@example.com'], 'read');

  const fetched = await getSecretByKey(readerAuth, { key: 'MANIFEST_SECRET' });
  assert.equal(fetched.ok, true);
  assert.equal(fetched.secret.role, 'read');
  assert.equal(fetched.secret.value, 'manifest-value');
});

test('identity registry can resolve principals from SSO claims without exposing email directly', async () => {
  const ownerAuth = {
    user: {
      email: 'registry-owner@example.com'
    }
  };
  await putSecret(ownerAuth, { key: 'SSO_SECRET', value: 'claims-value' });
  await grantSecret(ownerAuth, {
    key: 'SSO_SECRET',
    principal: 'registry-reader@example.com',
    role: 'read'
  });

  const manifest = getPermissionsManifest();
  manifest.identities.principals['registry-reader@example.com'] = {
    aliases: {
      emails: ['registry-reader@example.com'],
      userIds: ['reader-id'],
      usernames: [],
      ssoSubjects: ['oidc-reader-subject'],
      issuers: ['https://issuer.example.com']
    },
    claims: {
      roles: ['reader']
    },
    createdAt: '2026-03-27T00:00:00.000Z',
    updatedAt: '2026-03-27T00:00:00.000Z'
  };
  fs.writeFileSync(getPermissionsManifestPath(), JSON.stringify(manifest, null, 2), 'utf8');

  const ssoReader = await getSecretByKey({
    claims: {
      sub: 'oidc-reader-subject',
      iss: 'https://issuer.example.com',
      roles: ['reader']
    },
    user: {}
  }, { key: 'SSO_SECRET' });

  assert.equal(ssoReader.ok, true);
  assert.equal(ssoReader.secret.role, 'read');
  assert.equal(ssoReader.secret.value, 'claims-value');
});

test('secret owners keep write-access by default and same-agent delegated reads merge into full write access', async () => {
  const ownerAuth = {
    user: {
      id: 'local:admin',
      username: 'admin',
      email: ''
    }
  };

  await putSecret(ownerAuth, { key: 'AGENT_VISIBLE_SECRET', value: 'agent-readable-value' });

  const manifest = getPermissionsManifest();
  manifest.agentPolicies = manifest.agentPolicies || {};
  manifest.agentPolicies['agent:AssistOSExplorer/gitAgent'] = {
    secrets: { allowedRoles: ['read'] },
    updatedAt: '2026-04-16T00:00:00.000Z'
  };
  manifest.identities.principals['agent:AssistOSExplorer/gitAgent'] = {
    aliases: {
      emails: [],
      userIds: [],
      usernames: [],
      ssoSubjects: [],
      issuers: []
    },
    claims: {
      roles: []
    },
    createdAt: '2026-04-16T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z'
  };
  fs.writeFileSync(getPermissionsManifestPath(), JSON.stringify(manifest, null, 2), 'utf8');

  const ownerView = await getSecretByKey(ownerAuth, { key: 'AGENT_VISIBLE_SECRET' });
  assert.equal(ownerView.ok, true);
  assert.equal(ownerView.secret.role, 'write-access');
  assert.equal(ownerView.secret.value, null);

  await grantSecret(ownerAuth, {
    key: 'AGENT_VISIBLE_SECRET',
    principal: 'agent:AssistOSExplorer/gitAgent',
    role: 'read'
  });

  const agentView = await getSecretByKey({
    user: {
      id: 'local:admin',
      username: 'admin',
      email: ''
    },
    agent: {
      name: 'gitAgent',
      principalId: 'agent:AssistOSExplorer/gitAgent'
    }
  }, { key: 'AGENT_VISIBLE_SECRET' });

  assert.equal(agentView.ok, true);
  assert.equal(agentView.secret.role, 'write');
  assert.equal(agentView.secret.canWrite, true);
  assert.equal(agentView.secret.value, 'agent-readable-value');
});

test('delegated owner writes still succeed after the same agent is granted read access', async () => {
  const ownerAuth = {
    user: {
      id: 'local:admin',
      username: 'admin',
      email: ''
    }
  };

  await putSecret(ownerAuth, { key: 'OWNER_UPDATE_SECRET', value: 'initial-value' });

  const manifest = getPermissionsManifest();
  manifest.agentPolicies = manifest.agentPolicies || {};
  manifest.agentPolicies['agent:AssistOSExplorer/gitAgent'] = {
    secrets: { allowedRoles: ['read'] },
    updatedAt: '2026-04-16T00:00:00.000Z'
  };
  manifest.identities.principals['agent:AssistOSExplorer/gitAgent'] = {
    aliases: {
      emails: [],
      userIds: [],
      usernames: [],
      ssoSubjects: [],
      issuers: []
    },
    claims: {
      roles: []
    },
    createdAt: '2026-04-16T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z'
  };
  fs.writeFileSync(getPermissionsManifestPath(), JSON.stringify(manifest, null, 2), 'utf8');

  await grantSecret(ownerAuth, {
    key: 'OWNER_UPDATE_SECRET',
    principal: 'agent:AssistOSExplorer/gitAgent',
    role: 'read'
  });

  const delegatedOwnerAuth = {
    user: {
      id: 'local:admin',
      username: 'admin',
      email: ''
    },
    agent: {
      name: 'gitAgent',
      principalId: 'agent:AssistOSExplorer/gitAgent'
    },
    invocation: {
      scope: ['secret:write'],
      tool: 'secret_put',
      workspaceId: 'default'
    }
  };

  const updated = await putSecret(delegatedOwnerAuth, {
    key: 'OWNER_UPDATE_SECRET',
    value: 'updated-value'
  });
  assert.equal(updated.ok, true);

  const state = getStoredState();
  assert.equal(state.secrets.OWNER_UPDATE_SECRET.ownerId, 'user:local:admin');
});

test('agent secret grants are capped by DPU-owned agentPolicies allowedRoles', async () => {
  const ownerAuth = {
    user: {
      email: 'owner@example.com'
    }
  };
  await putSecret(ownerAuth, { key: 'AGENT_ROLE_LIMIT', value: 'value' });

  const manifest = getPermissionsManifest();
  manifest.agentPolicies = manifest.agentPolicies || {};
  manifest.agentPolicies['agent:AssistOSExplorer/gitAgent'] = {
    secrets: { allowedRoles: ['read'] },
    updatedAt: '2026-04-17T00:00:00.000Z'
  };
  manifest.identities.principals['agent:AssistOSExplorer/gitAgent'] = {
    aliases: {
      emails: [],
      userIds: [],
      usernames: [],
      ssoSubjects: [],
      issuers: []
    },
    claims: {
      roles: []
    },
    createdAt: '2026-04-17T00:00:00.000Z',
    updatedAt: '2026-04-17T00:00:00.000Z'
  };
  fs.writeFileSync(getPermissionsManifestPath(), JSON.stringify(manifest, null, 2), 'utf8');

  await assert.rejects(
    () => grantSecret(ownerAuth, {
      key: 'AGENT_ROLE_LIMIT',
      principal: 'agent:AssistOSExplorer/gitAgent',
      role: 'write'
    }),
    /not allowed to receive secret role write/
  );
});

test('admin can set and then read an agent secret policy via DPU tools', async () => {
  const setResult = await setAgentPolicyAllowedRoles(adminAuth, {
    principalId: 'agent:AssistOSExplorer/gitAgent',
    allowedRoles: ['read', 'write']
  });
  assert.equal(setResult.ok, true);
  assert.equal(setResult.principalId, 'agent:AssistOSExplorer/gitAgent');
  assert.deepEqual(setResult.policy.secrets.allowedRoles, ['read', 'write']);

  const getResult = await getAgentPolicyForPrincipal(adminAuth, {
    principalId: 'agent:AssistOSExplorer/gitAgent'
  });
  assert.equal(getResult.ok, true);
  assert.deepEqual(getResult.policy.secrets.allowedRoles, ['read', 'write']);
});

test('non-admin callers cannot manage DPU agent policies', async () => {
  await assert.rejects(
    () => setAgentPolicyAllowedRoles({ user: { email: 'someone@example.com' } }, {
      principalId: 'agent:AssistOSExplorer/gitAgent',
      allowedRoles: ['read']
    }),
    /admin or security role/
  );
  await assert.rejects(
    () => getAgentPolicyForPrincipal({ user: { email: 'someone@example.com' } }, {
      principalId: 'agent:AssistOSExplorer/gitAgent'
    }),
    /admin or security role/
  );
});

test('agent policy tools reject non-agent principals', async () => {
  await assert.rejects(
    () => setAgentPolicyAllowedRoles(adminAuth, {
      principalId: 'user:local:admin',
      allowedRoles: ['read']
    }),
    /agent principal/
  );
});

test('agent secret grants are rejected when no DPU agent policy exists', async () => {
  const ownerAuth = {
    user: {
      email: 'owner@example.com'
    }
  };
  await putSecret(ownerAuth, { key: 'UNREGISTERED_AGENT_SECRET', value: 'value' });

  await assert.rejects(
    () => grantSecret(ownerAuth, {
      key: 'UNREGISTERED_AGENT_SECRET',
      principal: 'agent:AssistOSExplorer/gitAgent',
      role: 'read'
    }),
    /no DPU policy exists/
  );
});

test('audit config is manageable by local admin and writes JSONL records for DPU operations', async () => {
  const configBefore = await getAuditConfig(adminAuth);
  assert.equal(configBefore.ok, true);
  assert.equal(configBefore.audit.canManage, true);
  assert.equal(configBefore.audit.enabled, false);

  const updated = await setAuditConfig(adminAuth, { enabled: true });
  assert.equal(updated.ok, true);
  assert.equal(updated.audit.enabled, true);

  await putSecret(adminAuth, { key: 'AUDITED_SECRET', value: 'value' });

  const listed = await listAuditEntries(adminAuth);
  assert.equal(listed.ok, true);
  assert.equal(Array.isArray(listed.items), true);
  assert.equal(listed.items.length > 0, true);
  assert.equal(fs.existsSync(getAuditDirPath()), true);

  const latestName = listed.items[0].name;
  const fetched = await getAuditEntry(adminAuth, { name: latestName });
  assert.equal(fetched.ok, true);
  assert.match(fetched.item.content, /dpu\.secret\.put/);
  assert.match(fetched.item.content, /AUDITED_SECRET/);
});

test('audit files are not visible to non-admin users', async () => {
  await setAuditConfig(adminAuth, { enabled: true });
  await putSecret(adminAuth, { key: 'ADMIN_ONLY_AUDIT', value: 'value' });

  await assert.rejects(
    () => listAuditEntries({
      user: {
        email: 'reader@example.com',
        username: 'reader'
      }
    }),
    /audit logs require admin or security role/i
  );
});

test('client-side audit events are appended through the dedicated ingest tool', async () => {
  await setAuditConfig(adminAuth, { enabled: true });
  const appended = await appendAuditClientEvent(adminAuth, {
    eventType: 'copilot.prompt',
    source: 'explorer',
    path: '/src/app.js',
    language: 'javascript',
    prompt: 'const answer = ',
    metadata: {
      cursorOffset: 15
    }
  });
  assert.equal(appended.ok, true);

  const listed = await listAuditEntries(adminAuth);
  const fetched = await getAuditEntry(adminAuth, { name: listed.items[0].name });
  assert.match(fetched.item.content, /copilot\.prompt/);
  assert.match(fetched.item.content, /const answer = /);
});

test('comment role can add annotations without write access and read role can see them', async () => {
  const ownerAuth = {
    user: {
      email: 'owner@example.com'
    }
  };
  const commenterAuth = {
    user: {
      email: 'commenter@example.com'
    }
  };
  const readerAuth = {
    user: {
      email: 'reader@example.com'
    }
  };

  const created = await createConfidential(ownerAuth, {
    type: 'file',
    name: 'commentable.txt',
    content: 'shared text',
    mimeType: 'text/plain'
  });

  await grantConfidential(ownerAuth, {
    id: created.object.id,
    principal: 'commenter@example.com',
    role: 'comment'
  });
  await grantConfidential(ownerAuth, {
    id: created.object.id,
    principal: 'reader@example.com',
    role: 'read'
  });

  const commenterView = await getConfidentialById(commenterAuth, { id: created.object.id });
  assert.equal(commenterView.ok, true);
  assert.equal(commenterView.object.canRead, true);
  assert.equal(commenterView.object.canComment, true);
  assert.equal(commenterView.object.canWrite, false);

  const added = await addConfidentialComment(commenterAuth, {
    id: created.object.id,
    message: 'Please review this line.'
  });
  assert.equal(added.ok, true);
  assert.equal(added.comment.userEmail, 'commenter@example.com');

  await assert.rejects(
    () => addConfidentialComment(readerAuth, {
      id: created.object.id,
      message: 'I should not be able to comment.'
    }),
    /missing comment/
  );

  const readerView = await getConfidentialById(readerAuth, { id: created.object.id });
  assert.equal(readerView.ok, true);
  assert.equal(readerView.object.commentsVisible, true);
  assert.equal(readerView.object.commentCount, 1);
  assert.equal(readerView.object.comments[0].message, 'Please review this line.');
  assert.equal(readerView.object.comments[0].canDelete, false);

  await deleteConfidentialComment(commenterAuth, {
    id: created.object.id,
    commentId: added.comment.id
  });

  const ownerView = await getConfidentialById(ownerAuth, { id: created.object.id });
  assert.equal(ownerView.object.commentCount, 0);
});

test('existing confidential comments without a line remain readable as general comments', async () => {
  const ownerAuth = {
    user: {
      email: 'owner@example.com'
    }
  };

  const created = await createConfidential(ownerAuth, {
    type: 'file',
    name: 'legacy-comments.txt',
    content: 'hello',
    mimeType: 'text/plain'
  });

  const state = getStoredState();
  state.objects[created.object.id].comments = [{
    id: 'legacy-comment',
    authorPrincipal: 'owner@example.com',
    userEmail: 'owner@example.com',
    message: 'Older general comment.',
    createdAt: '2026-03-27T00:00:00.000Z',
    updatedAt: '2026-03-27T00:00:00.000Z'
  }];
  setStoredState(state);

  const ownerView = await getConfidentialById(ownerAuth, { id: created.object.id });
  assert.equal(ownerView.ok, true);
  assert.equal(ownerView.object.commentCount, 1);
  assert.equal(ownerView.object.comments[0].message, 'Older general comment.');
});
