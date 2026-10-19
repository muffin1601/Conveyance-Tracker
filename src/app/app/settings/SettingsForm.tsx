"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Lock, RotateCcw, Save } from "lucide-react";
import { saveAppSettings, lockSettings } from "@/app/actions/settings";
import { Card, SectionTitle } from "@/components/ui";
import type { CompanySettings } from "@/lib/settings";
import { errorMessage } from "@/lib/errors";

export function SettingsForm({ settings, section = "general" }: { settings: CompanySettings; section?: "general" | "rates" | "security" }) {
  const [companyName, setCompanyName] = useState(settings.companyName);
  const [officeAddress, setOfficeAddress] = useState(settings.officeAddress);
  const [bike, setBike] = useState(settings.rates.BIKE ?? 0);
  const [car, setCar] = useState(settings.rates.CAR ?? 0);
  const [busMetro, setBusMetro] = useState(settings.rates.busMetroPerKm ?? 0);
  const [pin, setPin] = useState(settings.settingsPin);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const changed = useMemo(() => (
    companyName !== settings.companyName || officeAddress !== settings.officeAddress ||
    bike !== (settings.rates.BIKE ?? 0) || car !== (settings.rates.CAR ?? 0) ||
    busMetro !== (settings.rates.busMetroPerKm ?? 0) || pin !== settings.settingsPin
  ), [bike, busMetro, car, companyName, officeAddress, pin, settings]);

  function reset() {
    setCompanyName(settings.companyName); setOfficeAddress(settings.officeAddress);
    setBike(settings.rates.BIKE ?? 0); setCar(settings.rates.CAR ?? 0);
    setBusMetro(settings.rates.busMetroPerKm ?? 0); setPin(settings.settingsPin);
    setErr(null); setSaved(false);
  }

  function lock() {
    start(async () => {
      await lockSettings();
      router.refresh();
    });
  }

  function save() {
    start(async () => {
      setErr(null);
      setSaved(false);
      try {
        await saveAppSettings({
          companyName,
          officeAddress,
          bikePerKm: bike,
          carPerKm: car,
          busMetroPerKm: busMetro,
          settingsPin: pin,
        });
        setSaved(true);
        router.refresh();
      } catch (e) {
        setErr(errorMessage(e));
      }
    });
  }

  return (
    <>
      {section === "general" && <Card>
        <SectionTitle>Company details</SectionTitle>
        <p className="-mt-2 mb-4 text-xs text-muted">These details appear in reports and set the default journey starting point.</p>
        <div className="grid gap-3">
          <div>
            <label className="label">Company Name</label>
            <input className="input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </div>
          <div>
            <label className="label">Office (starting point) Address</label>
            <input className="input" value={officeAddress} onChange={(e) => setOfficeAddress(e.target.value)} />
          </div>
        </div>
      </Card>}

      {section === "rates" && <Card>
        <SectionTitle>Conveyance rates</SectionTitle>
        <p className="-mt-2 mb-4 text-xs text-muted">New distance-based trips use these rates. Existing entries are not changed.</p>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Bike (₹/km)</label>
            <input type="number" min="0" step="0.5" className="input" value={bike} onChange={(e) => setBike(Number(e.target.value))} />
          </div>
          <div>
            <label className="label">Car (₹/km)</label>
            <input type="number" min="0" step="0.5" className="input" value={car} onChange={(e) => setCar(Number(e.target.value))} />
          </div>
          <div>
            <label className="label">Bus/Metro (₹/km)</label>
            <input type="number" min="0" step="0.5" className="input" value={busMetro} onChange={(e) => setBusMetro(Number(e.target.value))} />
          </div>
        </div>
      </Card>}

      {section === "security" && <Card>
        <SectionTitle>Settings security</SectionTitle>
        <p className="-mt-2 mb-4 text-xs text-muted">Use a PIN only administrators know, then lock this page when you finish.</p>
        <div className="max-w-xs">
          <label className="label">Settings PIN</label>
          <input type="text" inputMode="numeric" className="input" value={pin} onChange={(e) => setPin(e.target.value)} />
          <p className="text-xs text-muted mt-1">Required to open this Settings tab. Min 4 characters.</p>
        </div>
      </Card>}

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-surface/95 p-3 shadow-sm backdrop-blur">
        <div className="mr-auto text-sm">
          {err ? <span className="text-red-600" role="alert">{err}</span>
            : saved ? <span className="inline-flex items-center gap-1 text-green-600"><CheckCircle2 className="h-4 w-4" /> Saved successfully</span>
              : changed ? <span className="text-amber-600">You have unsaved changes</span>
                : <span className="text-muted">All changes saved</span>}
        </div>
        {changed && <button className="btn-ghost" disabled={pending} onClick={reset}><RotateCcw className="h-4 w-4" /> Reset</button>}
        <button className="btn-primary" disabled={pending || !changed} onClick={save}>
          <Save className="h-4 w-4" />
          {pending ? "Saving…" : "Save settings"}
        </button>
        <button className="btn-ghost" disabled={pending} onClick={lock}>
          <Lock className="h-4 w-4" /> Lock
        </button>
      </div>
    </>
  );
}
