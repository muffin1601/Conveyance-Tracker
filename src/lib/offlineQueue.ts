"use client";

/**
 * The device-side visit queue.
 *
 * Every GPS-verified visit is written here FIRST and only then sent to the
 * server. That ordering is the whole point: once an employee has stood at a
 * site and had their location verified, nothing about the network — no signal,
 * a dead server, a closed laptop — may lose that visit.
 *
 * IndexedDB rather than localStorage: the records are structured, they are
 * written from more than one place, and localStorage's synchronous string API
 * would both block the main thread and force a parse-mutate-stringify cycle
 * that two tabs can interleave into data loss.
 *
 * Dependency-free on purpose. The store is one object store with two indexes;
 * a wrapper library would be more code than this file.
 */

import type { TravelMode } from "./travel";
import type { GpsFix } from "./gps";

const DB_NAME = "watcon-visits";
const DB_VERSION = 1;
const STORE = "queue";

export type QueueStatus = "PENDING" | "SYNCING" | "SYNCED" | "FAILED";

/** A destination, in the same shape the server action already accepts. */
export type QueuedDestination =
  | { kind: "SITE"; siteId: string }
  | { kind: "CUSTOM"; customLocationId: string }
  | { kind: "GPS"; lat: number; lng: number; name: string; address?: string };

export interface QueuedVisit {
  /** Client-generated idempotency key. Primary key here AND on the server. */
  clientVisitId: string;
  employeeId: string;
  /** Denormalised so the pending list reads properly with no network. */
  employeeName: string;
  destination: QueuedDestination;
  destinationName: string;
  mode: TravelMode;
  fareActual?: number;
  /** Why a hand-entered distance differs from the measured route, when asked for. */
  manualReason?: string;
  manualDistanceKm?: number;
  /** The verified fix: latitude, longitude, accuracy, GPS timestamp. */
  gps: GpsFix;
  /** Server-authoritative distance is recomputed on sync; this is the local reading. */
  distanceM: number;
  /** When the visit was made on the device — the visit's real time. */
  visitAt: number;
  createdAt: number;

  status: QueueStatus;
  attempts: number;
  /** Epoch ms before which no sync should be attempted (backoff). */
  nextAttemptAt: number;
  /** When the current/last delivery attempt started — detects an abandoned one. */
  lastAttemptAt?: number;
  /** Last user-facing reason, kept for the pending list. Never a raw error. */
  lastMessage?: string;
  /** Set once the server has confirmed the row. */
  serverId?: string;
  syncedAt?: number;
}

// ── Low-level IndexedDB plumbing ──────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "clientVisitId" });
        store.createIndex("status", "status");
        store.createIndex("employeeId", "employeeId");
      }
    };
    req.onsuccess = () => {
      // A second tab upgrading the schema would otherwise block forever.
      req.result.onversionchange = () => { req.result.close(); dbPromise = null; };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
  // A failed open must not be cached forever — a later call should retry.
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
        t.onabort = () => reject(t.error ?? new Error("IndexedDB transaction aborted"));
      }),
  );
}

/** True when this browser can hold a queue at all (private mode can refuse). */
export async function isQueueAvailable(): Promise<boolean> {
  try {
    await openDb();
    return true;
  } catch {
    return false;
  }
}

// ── Change notification ───────────────────────────────────────────────
// Listeners in this tab, plus other tabs via BroadcastChannel, so a sync
// completed in one tab updates the badge in another.

type Listener = () => void;
const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!channel) {
    channel = new BroadcastChannel("watcon-visit-queue");
    channel.onmessage = () => { for (const l of listeners) l(); };
  }
  return channel;
}

function notify() {
  for (const l of listeners) l();
  getChannel()?.postMessage("changed");
}

/** Subscribe to queue changes (this tab and others). Returns an unsubscribe. */
export function onQueueChange(listener: Listener): () => void {
  listeners.add(listener);
  getChannel();
  return () => { listeners.delete(listener); };
}

// ── Queue operations ──────────────────────────────────────────────────

/** A device-unique id. `randomUUID` needs a secure context; this always works. */
export function newVisitId(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  if (c && typeof c.getRandomValues === "function") {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const hex = [...b].map((n) => n.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export type NewVisit = Omit<
  QueuedVisit,
  "status" | "attempts" | "nextAttemptAt" | "createdAt" | "serverId" | "syncedAt" | "lastMessage"
>;

/** Persist a verified visit. Resolves once it is durably on disk. */
export async function enqueueVisit(visit: NewVisit): Promise<QueuedVisit> {
  const record: QueuedVisit = {
    ...visit,
    status: "PENDING",
    attempts: 0,
    nextAttemptAt: 0,
    createdAt: Date.now(),
  };
  await tx("readwrite", (s) => s.add(record) as IDBRequest<IDBValidKey>);
  notify();
  return record;
}

export async function listVisits(): Promise<QueuedVisit[]> {
  try {
    const all = await tx<QueuedVisit[]>("readonly", (s) => s.getAll() as IDBRequest<QueuedVisit[]>);
    return all.sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return []; // the badge is informational — never let it throw into the UI
  }
}

/** Everything still owed to the server, oldest first. */
export async function listUnsynced(): Promise<QueuedVisit[]> {
  return (await listVisits()).filter((v) => v.status !== "SYNCED");
}

/**
 * How long a record may sit in SYNCING before it is considered abandoned.
 * A tab closed mid-request leaves the flag set with nobody to clear it; without
 * this the visit would be stranded forever, which is exactly the data loss the
 * queue exists to prevent. Re-sending is safe — the server is idempotent on
 * clientVisitId.
 */
const SYNCING_STALE_MS = 2 * 60_000;

/** Unsynced records whose backoff has elapsed. */
export async function listDue(now = Date.now()): Promise<QueuedVisit[]> {
  return (await listUnsynced()).filter((v) => {
    if (v.nextAttemptAt > now) return false;
    if (v.status !== "SYNCING") return true;
    return now - (v.lastAttemptAt ?? 0) > SYNCING_STALE_MS;
  });
}

async function update(id: string, patch: Partial<QueuedVisit>): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    const store = t.objectStore(STORE);
    const get = store.get(id);
    get.onsuccess = () => {
      const current = get.result as QueuedVisit | undefined;
      if (!current) return resolve();
      store.put({ ...current, ...patch });
    };
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error("IndexedDB update failed"));
    t.onabort = () => reject(t.error ?? new Error("IndexedDB update aborted"));
  });
  notify();
}

export function markSyncing(id: string): Promise<void> {
  return update(id, { status: "SYNCING", lastAttemptAt: Date.now() });
}

export function markSynced(id: string, serverId: string | undefined): Promise<void> {
  return update(id, { status: "SYNCED", serverId, syncedAt: Date.now(), lastMessage: undefined });
}

/**
 * A permanent refusal from the server (outside the radius on re-check, an
 * employee since deactivated). The record is KEPT — losing it silently would
 * be worse than showing the employee that one visit needs attention.
 */
export function markRejected(id: string, message: string, attempts: number): Promise<void> {
  return update(id, {
    status: "FAILED",
    attempts: attempts + 1,
    nextAttemptAt: Number.MAX_SAFE_INTEGER,
    lastMessage: message,
  });
}

/** Base delay for the retry backoff. */
const RETRY_BASE_MS = 15_000;
const RETRY_MAX_MS = 30 * 60_000;

export function backoffDelay(attempts: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(attempts, 10));
}

/** A transient failure: still PENDING, retried later, never dropped. */
export function markRetry(id: string, attempts: number, message?: string): Promise<void> {
  return update(id, {
    status: "PENDING",
    attempts: attempts + 1,
    nextAttemptAt: Date.now() + backoffDelay(attempts),
    lastMessage: message,
  });
}

/** Housekeeping: forget confirmed visits once they are comfortably old. */
const SYNCED_RETENTION_MS = 24 * 60 * 60_000;

export async function purgeSynced(now = Date.now()): Promise<void> {
  try {
    const stale = (await listVisits()).filter(
      (v) => v.status === "SYNCED" && now - (v.syncedAt ?? v.createdAt) > SYNCED_RETENTION_MS,
    );
    if (!stale.length) return;
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const t = db.transaction(STORE, "readwrite");
      const store = t.objectStore(STORE);
      for (const v of stale) store.delete(v.clientVisitId);
      t.oncomplete = () => resolve();
      t.onerror = () => resolve(); // housekeeping never fails anything
      t.onabort = () => resolve();
    });
    notify();
  } catch {
    /* best effort */
  }
}

/**
 * Make every outstanding visit due right now.
 *
 * The backoff exists to stop a device hammering a server that is refusing to
 * answer. Regaining signal — or a person tapping "Sync now" — is new
 * information: the reason for the delay may well have just gone away, so the
 * wait is dropped rather than served out. Records the server has REFUSED are
 * left alone; those are not waiting on the network.
 */
export async function clearBackoff(): Promise<void> {
  try {
    const waiting = (await listVisits()).filter(
      (v) => (v.status === "PENDING" || v.status === "SYNCING") && v.nextAttemptAt > 0,
    );
    if (!waiting.length) return;
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const t = db.transaction(STORE, "readwrite");
      const store = t.objectStore(STORE);
      for (const v of waiting) store.put({ ...v, nextAttemptAt: 0 });
      t.oncomplete = () => resolve();
      t.onerror = () => resolve();
      t.onabort = () => resolve();
    });
    notify();
  } catch {
    /* best effort */
  }
}

/** Discard one record the employee has chosen to give up on. */
export async function discardVisit(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id) as unknown as IDBRequest<undefined>);
  notify();
}
