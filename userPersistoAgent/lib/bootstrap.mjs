import { createUser, findUserByEmail } from './users.mjs';
import { getUserPersistoStore } from './storage/persisto-store.mjs';

function requiredConfig(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`${name} is required to bootstrap the first admin user.`);
  }
  return value;
}

function defaultAdmin() {
  return {
    email: requiredConfig('USERPERSISTO_BOOTSTRAP_ADMIN_EMAIL'),
    username: requiredConfig('USERPERSISTO_BOOTSTRAP_ADMIN_USERNAME'),
    password: String(process.env.USERPERSISTO_BOOTSTRAP_ADMIN_PASSWORD || ''),
    displayName: String(process.env.USERPERSISTO_BOOTSTRAP_ADMIN_DISPLAY_NAME || '').trim(),
    role: 'admin',
    status: 'active'
  };
}

let bootstrapPromise = null;

export async function ensureDefaultAdmin() {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    const DEFAULT_ADMIN = defaultAdmin();
    let created = false;
    const existingUsers = await getUserPersistoStore().select('user', {}, { limit: 1 }).catch(() => []);
    if (existingUsers.length > 0) {
      return { ok: true, created, user: null };
    }
    let user = await findUserByEmail(DEFAULT_ADMIN.email).catch(() => null);
    if (!user) {
      user = await createUser(DEFAULT_ADMIN);
      created = true;
      await getUserPersistoStore().appendAudit('bootstrap.admin.seeded', {
        targetType: 'user',
        targetId: user.id,
        metadata: { username: DEFAULT_ADMIN.username, email: DEFAULT_ADMIN.email }
      });
    }
    return { ok: true, created, user };
  })();
  try {
    return await bootstrapPromise;
  } finally {
    bootstrapPromise = null;
  }
}
