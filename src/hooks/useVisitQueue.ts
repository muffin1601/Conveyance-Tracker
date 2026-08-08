"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearBackoff, listVisits, onQueueChange, type QueuedVisit,
} from "@/lib/offlineQueue";
import { isOnline, syncPendingVisits, type SyncSummary } from "@/lib/visitSync";

/**
 * Connectivity + the device queue, as one piece of state the UI can render.
 *
 * Sync is attempted on the events that actually mean something changed —
 * the app opened, the tab came back to the front, the connection returned, a
 * visit was queued — plus a slow heartbeat that only ticks while something is
 * actually waiting. There is no polling of an empty queue.
 */

export interface VisitQueueState {
  online: boolean;
  /** Visits still owed to the server. */
  pending: QueuedVisit[];
  /** Visits the server refused; they need a person to look at them. */
  rejected: QueuedVisit[];
  syncing: boolean;
  /** Set briefly after a drain that actually delivered something. */
  justSynced: number;
}

/** Heartbeat while work is outstanding. Long enough not to be a poll storm. */
const HEARTBEAT_MS = 60_000;

export function useVisitQueue(): VisitQueueState & {
  refresh: () => void;
  syncNow: (force?: boolean) => void;
} {
  const [online, setOnline] = useState(true); // assume online until told otherwise
  const [pending, setPending] = useState<QueuedVisit[]>([]);
  const [rejected, setRejected] = useState<QueuedVisit[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [justSynced, setJustSynced] = useState(0);
  const mounted = useRef(true);

  const refresh = useCallback(() => {
    void listVisits().then((all) => {
      if (!mounted.current) return;
      setPending(all.filter((v) => v.status === "PENDING" || v.status === "SYNCING"));
      setRejected(all.filter((v) => v.status === "FAILED"));
    });
  }, []);

  /**
   * @param force drop any pending backoff first. Used for the signals that
   *   mean "the situation has changed" — the connection returned, or a person
   *   asked. The heartbeat never forces, so a genuinely unwell server is still
   *   backed off from.
   */
  const syncNow = useCallback((force = false) => {
    if (!isOnline()) return;
    setSyncing(true);
    void (force ? clearBackoff() : Promise.resolve())
      .then(() => syncPendingVisits())
      .then((s: SyncSummary) => {
        if (!mounted.current) return;
        if (s.synced > 0) setJustSynced(s.synced);
      })
      .catch(() => {
        // syncPendingVisits already swallows delivery failures; anything that
        // escapes is a queue problem, and the badge simply stays as it was.
      })
      .finally(() => {
        if (!mounted.current) return;
        setSyncing(false);
        refresh();
      });
  }, [refresh]);

  useEffect(() => {
    mounted.current = true;
    // navigator.onLine is only meaningful on the client, so the first read
    // happens here rather than during render (which also keeps SSR stable).
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setOnline(isOnline());
    refresh();
    // Opening the app is a fresh start, and a phone that was switched off
    // overnight should not sit out a backoff from yesterday.
    syncNow(true);

    const goOnline = () => { setOnline(true); syncNow(true); };
    const goOffline = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      setOnline(isOnline());
      refresh();
      syncNow();
    };

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    document.addEventListener("visibilitychange", onVisible);
    const unsubscribe = onQueueChange(refresh);

    return () => {
      mounted.current = false;
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      document.removeEventListener("visibilitychange", onVisible);
      unsubscribe();
    };
  }, [refresh, syncNow]);

  // Heartbeat, but only while there is something to deliver, and respecting
  // each record's own backoff.
  useEffect(() => {
    if (!pending.length || !online) return;
    const timer = setInterval(() => syncNow(false), HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [pending.length, online, syncNow]);

  // Clear the "synced" confirmation after it has been read.
  useEffect(() => {
    if (!justSynced) return;
    const timer = setTimeout(() => setJustSynced(0), 6000);
    return () => clearTimeout(timer);
  }, [justSynced]);

  return { online, pending, rejected, syncing, justSynced, refresh, syncNow };
}
