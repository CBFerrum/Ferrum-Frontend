// What a device keeps of the workspace for when it is offline (Ferrum docs/offline.md), on one
// policy for every app. Cached reads (a till's price book, its register) are kept for the person
// under the workspace's lease, and forgotten when the lease ends, when another person signs in on
// the device, or when they are signed out everywhere, turned off or their password changes. Work
// not sent yet (a sale, an unsaved edit) is kept for its person until it is sent, whatever the
// lease, and is for nobody else.

/** The lease a page's bootstrap carries (`GET /api/shell/offline` renews it). */
export interface OfflineLease {
  /** Whether this person may keep anything here: members, unless the workspace turned it off. */
  allowed: boolean;
  /** When cached reads stop being usable. */
  until: string | null;
  hours: number;
  /** Stands for the person and their sign-in: when it changes, what was cached goes. */
  key: string;
  person: string;
}

/** What the module needs of the page: its workspace, its lease, and where it keeps things. */
export interface OfflineEnv {
  workspace: string | null;
  lease: OfflineLease | null;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length"> | undefined;
}

const PREFIX = "ferrum.offline.";

function leaseKey(workspace: string): string {
  return `${PREFIX}${workspace}.lease`;
}

/** The lease to go by: the page's (remembered on the device for its next start offline), else the
 *  one remembered. */
export function currentLease(env: OfflineEnv): OfflineLease | null {
  const { workspace, lease, storage } = env;
  if (!workspace) return null;
  try {
    if (lease) {
      storage?.setItem(leaseKey(workspace), JSON.stringify(lease));
      return lease;
    }
    const kept = storage?.getItem(leaseKey(workspace));
    return kept ? (JSON.parse(kept) as OfflineLease) : null;
  } catch {
    return lease;
  }
}

/** Whether cached reads may be kept and used now. */
export function mayKeep(lease: OfflineLease | null, now = Date.now()): boolean {
  return !!lease?.allowed && !!lease.until && Date.parse(lease.until) > now;
}

/** The name a cached read goes under: the workspace's, the app's, and the person's sign-in; null
 *  when nothing may be kept now. Use it as a storage key or an IndexedDB database's name. */
export function cacheName(env: OfflineEnv, app: string, name: string, now = Date.now()): string | null {
  const lease = currentLease(env);
  return env.workspace && lease && mayKeep(lease, now) ? `${PREFIX}${env.workspace}.${app}.${lease.key}.${name}` : null;
}

/** The name work not sent yet goes under: the person's alone, so it outlasts their sign-in and the
 *  lease, and no one else on the device is shown it. Null without a person. */
export function pendingName(env: OfflineEnv, app: string, name: string): string | null {
  const lease = currentLease(env);
  return env.workspace && lease?.person ? `${PREFIX}${env.workspace}.${app}.person-${lease.person}.${name}` : null;
}

/** Whether a name `sweep` would forget: a cached read under another sign-in, or any once the lease
 *  has ended. Pending work and the lease itself are never forgotten. */
export function stale(env: OfflineEnv, name: string, now = Date.now()): boolean {
  const lease = currentLease(env);
  if (!env.workspace || !name.startsWith(`${PREFIX}${env.workspace}.`) || name === leaseKey(env.workspace)) return false;
  const [, key] = name.slice(`${PREFIX}${env.workspace}.`.length).split(".");
  if (!key || key.startsWith("person-")) return false;
  return !lease || !mayKeep(lease, now) || key !== lease.key;
}

/** Forgets the cached reads the lease no longer covers, every app's on this device for the
 *  workspace: storage keys and IndexedDB databases named by `cacheName`. Returns what went. */
export async function sweep(env: OfflineEnv, databases?: Pick<IDBFactory, "databases" | "deleteDatabase">, now = Date.now()): Promise<string[]> {
  const gone: string[] = [];
  const storage = env.storage;
  if (storage) {
    const names: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const name = storage.key(i);
      if (name && stale(env, name, now)) names.push(name);
    }
    for (const name of names) {
      storage.removeItem(name);
      gone.push(name);
    }
  }
  if (databases?.databases) {
    try {
      for (const db of await databases.databases()) {
        if (db.name && stale(env, db.name, now)) {
          databases.deleteDatabase(db.name);
          gone.push(db.name);
        }
      }
    } catch {
      // A browser that cannot list its databases keeps them until the app opens one by name.
    }
  }
  return gone;
}
