"use client";

import { useState, useTransition } from "react";
import { Globe, MapPin, Undo2 } from "lucide-react";
import { approveGlobalLocation } from "@/app/actions/locations";
import { Card, SectionTitle, Empty } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";
import { errorMessage } from "@/lib/errors";

interface Loc {
  id: string;
  locationName: string;
  address: string | null;
  city: string | null;
  state: string | null;
  source: string;
  isGlobal: boolean;
  employee: string;
  /** Login behind this saved location, ISO-8601 UTC; null if unknown. */
  loginAt: string | null;
}

export function LocationApprovals({ locations }: { locations: Loc[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  function toggle(id: string, approve: boolean) {
    if (pending) return; // block a duplicate submit while one is in flight
    setError("");
    start(async () => {
      try {
        const r = await approveGlobalLocation(id, approve);
        if (!r.ok) setError(r.error);
      } catch (e) {
        setError(errorMessage(e));
      }
    });
  }

  return (
    <Card>
      <SectionTitle>Custom Locations</SectionTitle>
      <p className="text-xs text-muted -mt-2 mb-3">
        Promote a frequently-used personal location to a global one so it appears in everyone&apos;s dropdown.
      </p>
      {error && (
        <p className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-sm text-red-600">{error}</p>
      )}
      {locations.length === 0 ? (
        <Empty>No custom locations yet.</Empty>
      ) : (
        <div className="space-y-2">
          {locations.map((l) => (
            <div key={l.id} className="flex items-start justify-between gap-3 rounded-lg border p-3 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 text-muted shrink-0" />
                  <span className="font-medium">{l.locationName}</span>
                  {l.isGlobal && <span className="badge bg-teal-500/10 text-teal-600 border-teal-500/20 text-[10px]">global</span>}
                  <span className="text-xs text-muted">{l.source}</span>
                </div>
                {(l.address || l.city) && <p className="text-muted truncate mt-0.5">{l.address || [l.city, l.state].filter(Boolean).join(", ")}</p>}
                {/* Who saved it, and when they were logged in when they did —
                    the same login stamp the Entries table shows. */}
                <p className="text-xs text-muted">
                  by {l.employee} · {l.loginAt ? fmtDateTime(l.loginAt) : "Not available"}
                </p>
              </div>
              {l.isGlobal ? (
                <button type="button" disabled={pending} onClick={() => toggle(l.id, false)} className="btn-ghost text-xs shrink-0">
                  <Undo2 className="h-3.5 w-3.5" /> Make private
                </button>
              ) : (
                <button type="button" disabled={pending} onClick={() => toggle(l.id, true)} className="btn-ghost text-xs shrink-0">
                  <Globe className="h-3.5 w-3.5" /> Approve global
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
