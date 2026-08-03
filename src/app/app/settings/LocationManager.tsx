"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2, Check, X, Search, MapPin, MapPinPlus, Power, Building2,
  LocateFixed, AlertTriangle, Pencil, Landmark,
} from "lucide-react";
import { createSite, updateSite, setSiteStatus, lookupAddress } from "@/app/actions/roster";
import { geocodeCoords } from "@/app/actions/locations";
import { Card, SectionTitle, Empty } from "@/components/ui";
import { NavigateButton } from "@/components/NavigateButton";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

export interface SiteRow {
  id: string;
  code: string;
  name: string;
  address: string;
  landmark: string | null;
  latitude: number;
  longitude: number;
  city: string | null;
  status: string;
  isOffice: boolean;
}

interface Candidate {
  address: string; city: string | null; state: string | null;
  postalCode: string | null; latitude: number; longitude: number;
}

export function LocationManager({ sites }: { sites: SiteRow[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  /** null = adding a new location; otherwise the id being corrected. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [added, setAdded] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  // Add/edit form — shared between both flows.
  const [name, setName] = useState("");
  const [landmark, setLandmark] = useState("");
  const [search, setSearch] = useState("");
  const [looking, setLooking] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [manual, setManual] = useState(false);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [address, setAddress] = useState("");
  /** Standing at the site is the most accurate way to place a farm/plot that has no street listing. */
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sites;
    return sites.filter((s) =>
      `${s.name} ${s.code} ${s.address} ${s.city ?? ""} ${s.landmark ?? ""}`.toLowerCase().includes(q));
  }, [sites, query]);

  const activeCount = sites.filter((s) => s.status === "ACTIVE").length;

  function reset() {
    setName(""); setLandmark(""); setSearch(""); setCandidates(null); setPicked(null);
    setManual(false); setLat(""); setLng(""); setAddress("");
    setLocating(false); setLocateError("");
  }

  function startAdd() {
    reset();
    setEditingId(null);
    setAdding(true);
    setError(""); setAdded("");
  }

  /**
   * Pre-fills the form with the location's current values so a correction is
   * a couple of taps, not a re-entry — defaults to manual mode since the
   * coordinates are already known; "Use My Current Location" below still
   * works to overwrite them if the admin happens to be at the site.
   */
  function startEdit(row: SiteRow) {
    reset();
    setEditingId(row.id);
    setName(row.name);
    setLandmark(row.landmark ?? "");
    setManual(true);
    setAddress(row.address);
    setLat(String(row.latitude));
    setLng(String(row.longitude));
    setAdding(true);
    setError(""); setAdded("");
  }

  /**
   * Use the device's own GPS fix instead of typing an address — the most
   * reliable option for a farm/plot with no formal street listing, provided
   * whoever is adding it is actually standing at the site. Reverse-geocodes
   * the fix into the same shape as a search result so it drops straight into
   * the candidate list below.
   */
  function useCurrentLocation() {
    setLocateError(""); setError("");
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocateError("This browser does not support location access.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const g = await geocodeCoords(latitude, longitude);
          const candidate: Candidate = {
            address: g.address, city: g.city, state: g.state,
            postalCode: g.postalCode, latitude, longitude,
          };
          setManual(false);
          setCandidates([candidate]);
          setPicked(candidate);
          setSearch("");
        } catch (e) {
          setLocateError(errorMessage(e));
        } finally {
          setLocating(false);
        }
      },
      (err) => {
        setLocating(false);
        setLocateError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied. Allow it in your browser settings, or search by address instead."
            : err.code === err.POSITION_UNAVAILABLE
              ? "Your location is unavailable right now. Try again or search by address."
              : "Could not get your location. Try again.",
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  function doLookup() {
    if (looking || search.trim().length < 3) {
      if (search.trim().length < 3) setError("Type at least 3 characters of the address.");
      return;
    }
    setError(""); setLooking(true); setCandidates(null); setPicked(null);
    lookupAddress(search)
      .then((r) => {
        if (!r.ok) { setError(r.error); return; }
        setCandidates(r.data);
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLooking(false));
  }

  /** Coordinates currently chosen, from either the lookup or manual entry. */
  const coords = manual
    ? { latitude: parseFloat(lat), longitude: parseFloat(lng) }
    : picked
      ? { latitude: picked.latitude, longitude: picked.longitude }
      : null;
  const coordsValid = !!coords && Number.isFinite(coords.latitude) && Number.isFinite(coords.longitude);
  const effectiveAddress = manual ? address : picked?.address ?? "";

  function submit() {
    if (pending) return;
    setError(""); setAdded("");
    if (name.trim().length < 2) { setError("Enter a name for this location."); return; }
    if (!coordsValid) { setError("Look up the address, or switch to manual and enter coordinates."); return; }
    if (effectiveAddress.trim().length < 4) { setError("Enter the address."); return; }

    const payload = {
      name,
      address: effectiveAddress,
      landmark,
      city: manual ? "" : picked?.city ?? "",
      state: manual ? "" : picked?.state ?? "",
      pincode: manual ? "" : picked?.postalCode ?? "",
      latitude: coords!.latitude,
      longitude: coords!.longitude,
      geofenceRadius: 200,
    };

    start(async () => {
      try {
        if (editingId) {
          const r = await updateSite(editingId, payload);
          if (!r.ok) { setError(r.error); return; }
          setAdded(`${name.trim()} updated.`);
        } else {
          const r = await createSite(payload);
          if (!r.ok) { setError(r.error); return; }
          setAdded(`${name.trim()} added as ${r.data.code}.`);
        }
        reset();
        setAdding(false);
        setEditingId(null);
        router.refresh();
      } catch (e) {
        setError(errorMessage(e));
      }
    });
  }

  function toggle(row: SiteRow) {
    if (pending) return;
    const activating = row.status !== "ACTIVE";
    if (!activating && !confirm(`Hide ${row.name} from the location picker? Past trips to it are kept.`)) return;
    setError(""); setAdded(""); setBusyId(row.id);
    start(async () => {
      try {
        const r = await setSiteStatus(row.id, activating);
        if (!r.ok) setError(r.error);
        else router.refresh();
      } catch (e) {
        setError(errorMessage(e));
      } finally { setBusyId(null); }
    });
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>Locations</SectionTitle>
        <span className="text-xs text-muted">{activeCount} active · {sites.length} total</span>
      </div>
      <p className="-mt-2 mb-3 text-xs text-muted">
        These are the sites staff can choose as a destination. Distance and fare are calculated from
        each location&apos;s coordinates, so look the address up rather than guessing.
      </p>

      {added && (
        <p className="mb-3 rounded-md border border-green-500/30 bg-green-500/10 p-2.5 text-sm text-green-600">{added}</p>
      )}
      {error && (
        <p className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-sm text-red-600">{error}</p>
      )}

      {!adding ? (
        <button type="button" onClick={startAdd} className="btn-ghost text-sm">
          <MapPinPlus className="h-4 w-4" /> Add Location
        </button>
      ) : (
        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            {editingId ? <Pencil className="h-4 w-4 text-brand" /> : <MapPin className="h-4 w-4 text-brand" />}
            {editingId ? "Edit location" : "New location"}
          </div>

          <div>
            <label className="label" htmlFor="site-name">Location Name</label>
            <input id="site-name" className="input" value={name} autoFocus
              placeholder="e.g. SHARMA RESIDENCE"
              onChange={(e) => { setName(e.target.value); setError(""); }} />
          </div>

          {!manual ? (
            <>
              <div>
                <label className="label" htmlFor="site-search">Find the address</label>
                <div className="flex gap-2">
                  <input id="site-search" className="input flex-1" value={search}
                    placeholder="Street, area, city…"
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); doLookup(); } }} />
                  <button type="button" onClick={doLookup} disabled={looking} className="btn-ghost text-sm">
                    {looking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    Search
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="h-px flex-1 bg-border" />
                <span className="text-[11px] uppercase tracking-wider text-muted">or</span>
                <span className="h-px flex-1 bg-border" />
              </div>

              <button type="button" onClick={useCurrentLocation} disabled={locating} className="btn-ghost w-full text-sm">
                {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
                {locating ? "Getting your location…" : "Use My Current Location"}
              </button>
              <p className="-mt-1 text-xs text-muted">
                Best for a farm or plot with no formal address — stand at the exact spot first.
              </p>
              {locateError && (
                <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-sm text-red-600">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{locateError}</span>
                </div>
              )}

              {candidates && candidates.length > 0 && (
                <ul className="space-y-1.5">
                  {candidates.map((c, i) => (
                    <li key={i}>
                      <button type="button" onClick={() => setPicked(c)}
                        className={cn("w-full rounded-md border p-2.5 text-left text-sm transition",
                          picked === c ? "border-brand bg-brand/10" : "hover:bg-bg")}>
                        <span className="block leading-snug">{c.address}</span>
                        <span className="mt-0.5 block text-xs tabular-nums text-muted">
                          {c.latitude.toFixed(5)}, {c.longitude.toFixed(5)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <button type="button" onClick={() => { setManual(true); setError(""); }}
                className="text-xs text-brand hover:underline">
                Address not found? Enter coordinates manually
              </button>
            </>
          ) : (
            <>
              <div>
                <label className="label" htmlFor="site-address">Address</label>
                <input id="site-address" className="input" value={address}
                  placeholder="Full address" onChange={(e) => setAddress(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="site-lat">Latitude</label>
                  <input id="site-lat" className="input" inputMode="decimal" value={lat}
                    placeholder="28.53550" onChange={(e) => setLat(e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="site-lng">Longitude</label>
                  <input id="site-lng" className="input" inputMode="decimal" value={lng}
                    placeholder="77.27310" onChange={(e) => setLng(e.target.value)} />
                </div>
              </div>
              <button type="button" onClick={() => { setManual(false); setError(""); }}
                className="text-xs text-brand hover:underline">
                <LocateFixed className="mr-1 inline h-3 w-3" /> Search by address instead
              </button>
            </>
          )}

          <div>
            <label className="label" htmlFor="site-landmark">Nearby Landmark — optional</label>
            <input id="site-landmark" className="input" value={landmark}
              placeholder="e.g. Opposite HP Petrol Pump"
              onChange={(e) => setLandmark(e.target.value)} />
          </div>

          {coordsValid && (
            <p className="rounded-md border bg-bg p-2.5 text-xs text-muted">
              Will be saved at <span className="tabular-nums text-fg">
                {coords!.latitude.toFixed(5)}, {coords!.longitude.toFixed(5)}
              </span>
            </p>
          )}

          <div className="flex gap-2">
            <button type="button" onClick={submit} disabled={pending} className="btn-primary flex-1 text-sm">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {pending ? "Saving…" : editingId ? "Save Changes" : "Add Location"}
            </button>
            <button type="button"
              onClick={() => { setAdding(false); setEditingId(null); reset(); setError(""); }}
              className="btn-ghost text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Existing sites */}
      <div className="mt-4">
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Search locations…" value={query}
            onChange={(e) => setQuery(e.target.value)} aria-label="Search locations" />
        </div>

        {shown.length === 0 ? (
          <Empty>No locations match that search.</Empty>
        ) : (
          <ul className="max-h-96 space-y-1.5 overflow-y-auto">
            {shown.map((s) => (
              <li key={s.id}
                className={cn("flex items-center justify-between gap-2 rounded-md border p-2.5 text-sm",
                  s.status !== "ACTIVE" && "opacity-60")}>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{s.name}</span>
                    <span className="badge bg-bg text-[10px] text-muted">{s.code}</span>
                    {s.isOffice && (
                      <span className="badge border-brand/30 bg-brand/10 text-[10px] text-brand">
                        <Building2 className="mr-1 h-2.5 w-2.5" /> head office
                      </span>
                    )}
                    {s.status !== "ACTIVE" && (
                      <span className="badge border-gray-500/20 bg-gray-500/10 text-[10px] text-gray-500">inactive</span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted">{s.city ?? s.address}</span>
                  {s.landmark && (
                    <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted">
                      <Landmark className="h-3 w-3 shrink-0" /> {s.landmark}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-0.5">
                  <NavigateButton lat={s.latitude} lng={s.longitude} compact />
                  <button type="button" onClick={() => startEdit(s)} disabled={pending}
                    title="Edit location"
                    className="rounded p-1.5 text-muted transition hover:text-brand disabled:opacity-50"
                    aria-label={`Edit ${s.name}`}>
                    <Pencil className="h-4 w-4" />
                  </button>
                  {!s.isOffice && (
                    <button type="button" onClick={() => toggle(s)} disabled={pending}
                      title={s.status === "ACTIVE" ? "Hide from picker" : "Restore to picker"}
                      className={cn("rounded p-1.5 transition disabled:opacity-50",
                        s.status === "ACTIVE" ? "text-muted hover:text-red-600" : "text-muted hover:text-green-600")}
                      aria-label={s.status === "ACTIVE" ? `Deactivate ${s.name}` : `Reactivate ${s.name}`}>
                      {busyId === s.id ? <Loader2 className="h-4 w-4 animate-spin" />
                        : s.status === "ACTIVE" ? <X className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
