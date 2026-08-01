"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { unlockSettings } from "@/app/actions/settings";
import { Card } from "@/components/ui";
import { errorMessage } from "@/lib/errors";

export function PinGate({
  title = "Locked",
  subtitle = "Enter the PIN to continue.",
}: {
  title?: string;
  subtitle?: string;
}) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);
  /** Distinguishes "wrong PIN" from "the request itself failed". */
  const [failure, setFailure] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (pending || !pin) return; // guard against a double submit
    setErr(false);
    setFailure("");
    start(async () => {
      try {
        const r = await unlockSettings(pin);
        if (r.ok) router.refresh();
        else {
          setErr(true);
          setPin("");
        }
      } catch (e) {
        setFailure(errorMessage(e));
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
        {/* A real <form> so Enter submits natively, password managers behave,
            and the browser stops warning about an unformed password field. */}
        <form onSubmit={submit}>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            autoFocus
            aria-label="PIN"
            aria-invalid={err || undefined}
            className="input"
            placeholder="Enter PIN"
            value={pin}
            onChange={(e) => { setPin(e.target.value); setErr(false); }}
          />
          {err && <p className="text-sm text-red-600 mt-2">Incorrect PIN. Please try again.</p>}
          {failure && <p className="text-sm text-red-600 mt-2">{failure}</p>}
          <button type="submit" disabled={pending || !pin} className="btn-primary w-full mt-4">
            {pending ? "Checking…" : "Unlock"}
          </button>
        </form>
      </Card>
    </div>
  );
}
