"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { unlockSettings } from "@/app/actions/settings";
import { Card } from "@/components/ui";

export function PinGate({
  title = "Locked",
  subtitle = "Enter the PIN to continue.",
}: {
  title?: string;
  subtitle?: string;
}) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit() {
    setErr(false);
    start(async () => {
      const r = await unlockSettings(pin);
      if (r.ok) router.refresh();
      else {
        setErr(true);
        setPin("");
      }
    });
  }

  return (
    <div className="max-w-sm mx-auto pt-8">
      <Card>
        <div className="flex items-center gap-2 mb-1">
          <Lock className="h-4 w-4 text-muted" />
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
        <p className="text-sm text-muted mb-4">{subtitle}</p>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          className="input"
          placeholder="Enter PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {err && <p className="text-sm text-red-600 mt-2">Incorrect PIN.</p>}
        <button onClick={submit} disabled={pending || !pin} className="btn-primary w-full mt-4">
          {pending ? "Checking…" : "Unlock"}
        </button>
      </Card>
    </div>
  );
}
