"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { saveAppSettings, lockSettings } from "@/app/actions/settings";
import { Card, SectionTitle } from "@/components/ui";
import type { CompanySettings } from "@/lib/settings";
import { errorMessage } from "@/lib/errors";

export function SettingsForm({ settings }: { settings: CompanySettings }) {
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
      } catch (e) {
        setErr(errorMessage(e));
      }
    });
  }

  return (
    <>
      <Card>
        <SectionTitle>Company</SectionTitle>
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
      </Card>

      <Card>
        <SectionTitle>Per-km Rates</SectionTitle>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Bike (₹/km)</label>
            <input type="number" step="0.5" className="input" value={bike} onChange={(e) => setBike(+e.target.value)} />
          </div>
          <div>
            <label className="label">Car (₹/km)</label>
            <input type="number" step="0.5" className="input" value={car} onChange={(e) => setCar(+e.target.value)} />
          </div>
          <div>
            <label className="label">Bus/Metro (₹/km)</label>
            <input type="number" step="0.5" className="input" value={busMetro} onChange={(e) => setBusMetro(+e.target.value)} />
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle>Security</SectionTitle>
        <div className="max-w-xs">
          <label className="label">Settings PIN</label>
          <input type="text" inputMode="numeric" className="input" value={pin} onChange={(e) => setPin(e.target.value)} />
          <p className="text-xs text-muted mt-1">Required to open this Settings tab. Min 4 characters.</p>
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save settings"}
        </button>
        <button className="btn-ghost" disabled={pending} onClick={lock}>
          <Lock className="h-4 w-4" /> Lock
        </button>
        {saved && <span className="text-sm text-green-600">Saved.</span>}
        {err && <span className="text-sm text-red-600">{err}</span>}
      </div>
    </>
  );
}
