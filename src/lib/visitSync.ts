"use client";

/**
 * Drains the device queue into the server.
 *
 * The rules it exists to enforce:
 *  - A visit is never dropped because of the network. Only the server saying
 *    "no, and here is why" retires a record.
 *  - The server is never hammered. One drain at a time, per-record exponential
 *    backoff, and a drain only starts on a real signal (app opened, tab
 *    focused, connection returned, a new visit queued).
 *  - Nothing technical ever reaches the employee. Failures come back as one of
 *    a handful of written-for-humans sentences.
 */

import { syncVisit } from "@/app/actions/visit";
import {
  listDue, markRejected, markRetry, markSynced, markSyncing, purgeSynced,
  type QueuedVisit,
} from "./offlineQueue";

export interface SyncSummary {
  synced: number;
  /** Still owed to the server; will be retried. */
  pending: number;
  /** Refused by the server — needs a person to look at it. */
  rejected: number;
  /** True when nothing was attempted because the device is offline. */
  skippedOffline: boolean;
}

const EMPTY: SyncSummary = { synced: 0, pending: 0, rejected: 0, skippedOffline: false };

export function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/** One drain at a time, process-wide — two tabs each get their own, and the
 *  idempotency key makes that harmless. */
let inFlight: Promise<SyncSummary> | null = null;

export function syncPendingVisits(): Promise<SyncSummary> {
  if (inFlight) return inFlight;
  inFlight = drain().finally(() => { inFlight = null; });
  return inFlight;
}

/** How many records one drain will attempt, so a long queue cannot stall the UI. */
const BATCH = 10;

async function drain(): Promise<SyncSummary> {
  if (!isOnline()) return { ...EMPTY, skippedOffline: true };

  let due: QueuedVisit[];
  try {
    due = (await listDue()).slice(0, BATCH);
  } catch {
    return EMPTY; // no queue on this device — nothing to do
  }
  if (!due.length) {
    void purgeSynced();
    return EMPTY;
  }

  const summary: SyncSummary = { synced: 0, pending: 0, rejected: 0, skippedOffline: false };

  // Sequential on purpose: legs chain to one another, so their order is part
  // of the data. Parallel syncing would scramble a day's journey.
  for (const visit of due) {
    try {
      await markSyncing(visit.clientVisitId);
    } catch {
      /* the record is still there; carry on */
    }

    let outcome: Awaited<ReturnType<typeof syncVisit>>;
    try {
      outcome = await syncVisit({
        employeeId: visit.employeeId,
        destination: visit.destination,
        mode: visit.mode,
        fareActual: visit.fareActual,
        manualDistanceKm: visit.manualDistanceKm,
        manualReason: visit.manualReason,
        gps: visit.gps,
        clientVisitId: visit.clientVisitId,
        visitAt: visit.visitAt,
      });
    } catch (e) {
      // The request never completed: offline mid-drain, a dropped connection,
      // a 500 from the edge. The visit stays exactly where it is.
      console.warn("[visitSync] delivery failed, will retry", e);
      await markRetry(visit.clientVisitId, visit.attempts).catch(() => {});
      summary.pending++;
      // If the connection has gone, stop rather than burning the whole batch.
      if (!isOnline()) { summary.skippedOffline = true; break; }
      continue;
    }

    if (outcome.status === "SYNCED" || outcome.status === "DUPLICATE") {
      await markSynced(visit.clientVisitId, outcome.serverId ?? undefined).catch(() => {});
      summary.synced++;
    } else if (outcome.status === "REJECTED") {
      await markRejected(visit.clientVisitId, outcome.reason, visit.attempts).catch(() => {});
      summary.rejected++;
    } else {
      await markRetry(visit.clientVisitId, visit.attempts, outcome.reason).catch(() => {});
      summary.pending++;
    }
  }

  void purgeSynced();
  return summary;
}
