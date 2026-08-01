import "server-only";

/**
 * Minimal in-process TTL memo for hot, rarely-changing reads.
 *
 * Why this exists: every Prisma round-trip to the pooled Supabase instance
 * measures ~450 ms from this deployment. Server actions such as previewVisit
 * were spending three of those hops on data that changes once a month
 * (company settings, the head-office Site row). Memoising them per server
 * instance removes ~900 ms from every preview and every logged visit.
 *
 * Deliberately not `unstable_cache`: these values are read from inside server
 * actions, which are dynamic by definition, and the working set is two small
 * objects. A Map with an expiry is the honest tool here.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, Entry<unknown>>();
/** De-duplicates concurrent misses so a cold cache never fans out. */
const inflight = new Map<string, Promise<unknown>>();

export async function memo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;

  const running = inflight.get(key);
  if (running) return running as Promise<T>;

  const promise = load()
    .then((value) => {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => { inflight.delete(key); });

  inflight.set(key, promise);
  return promise;
}

/** Drop one key (exact) or every key sharing a prefix. */
export function invalidate(prefix: string): void {
  for (const key of store.keys()) {
    if (key === prefix || key.startsWith(`${prefix}:`)) store.delete(key);
  }
}
