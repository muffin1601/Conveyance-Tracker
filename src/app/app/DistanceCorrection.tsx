"use client";

import { useRef, useState, useTransition } from "react";
import { CheckCircle2, ImageIcon, MapPinned, PencilLine, Upload } from "lucide-react";
import {
  getCorrectionScreenshot,
  requestDistanceCorrectionUpload,
  submitDistanceCorrection,
} from "@/app/actions/distanceCorrections";
import { errorMessage } from "@/lib/errors";
import { t, DEFAULT_LANG, type Lang } from "@/lib/i18n";

type Correction = {
  id: string;
  status: string;
  submittedDistanceKm: number;
  finalDistanceKm: number | null;
} | null;

type Props = {
  journeyId: string;
  recordedKm: number;
  correction: Correction;
  lang?: Lang;
};

export function DistanceCorrection({ journeyId, recordedKm, correction, lang = DEFAULT_LANG }: Props) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  if (correction) {
    const status = ["APPROVED", "AUTO_VERIFIED"].includes(correction.status)
      ? `${t(lang, "correctionVerified")} · ${correction.finalDistanceKm} km`
      : correction.status === "REJECTED"
        ? t(lang, "correctionNotApproved")
        : t(lang, "correctionPending");

    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 font-medium text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {status}
        </span>
        <button
          type="button"
          className="min-h-9 rounded px-2 text-sm text-brand underline"
          onClick={async () => {
            try {
              window.open(await getCorrectionScreenshot(correction.id), "_blank", "noopener,noreferrer");
            } catch (cause) {
              setError(errorMessage(cause));
            }
          }}
        >
          {t(lang, "viewScreenshot")}
        </button>
        {error && <span className="text-red-600">{error}</span>}
      </div>
    );
  }

  function submit() {
    setError("");
    const distance = Number(value);
    if (!file) {
      setError(t(lang, "chooseScreenshotFirst"));
      return;
    }
    if (!Number.isFinite(distance) || distance <= 0) {
      setError(t(lang, "enterDistanceValid"));
      return;
    }

    start(async () => {
      try {
        const ticket = await requestDistanceCorrectionUpload({
          journeyId,
          filename: file.name,
          mimeType: file.type,
          size: file.size,
        });
        const upload = await fetch(ticket.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!upload.ok) {
          throw new Error(lang === "hi"
            ? "Screenshot upload नहीं हुआ। Internet जाँचकर फिर कोशिश करें।"
            : "The screenshot could not be uploaded. Check your connection and try again.");
        }

        await submitDistanceCorrection({
          journeyId,
          submittedDistanceKm: distance,
          screenshot: {
            path: ticket.path,
            name: file.name,
            type: file.type as "image/jpeg" | "image/png" | "image/webp",
            size: file.size,
          },
        });
        setSubmitted(true);
      } catch (cause) {
        setError(errorMessage(cause));
      }
    });
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-left transition hover:border-brand hover:bg-brand/10 focus:outline-none focus:ring-2 focus:ring-brand/40"
        onClick={() => {
          setOpen(true);
          setError("");
        }}
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="rounded-full bg-brand p-1.5 text-white">
            <PencilLine className="h-3.5 w-3.5" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-brand">{t(lang, "correctDistance")}</span>
            <span className="block text-xs text-muted">{t(lang, "correctDistanceHint")}</span>
          </span>
        </span>
        <span className="shrink-0 text-xs font-medium text-brand">{lang === "hi" ? "सुधारें →" : "Fix it →"}</span>
      </button>

      {open && (
        <div
          className="mt-2 w-full max-w-md rounded-lg border border-brand/20 bg-bg p-3 text-sm shadow-sm"
          role="dialog"
          aria-label={t(lang, "correctTripDistance")}
        >
          {submitted ? (
            <>
              <div className="flex items-center gap-2 font-semibold text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                {t(lang, "correctionSubmitted")}
              </div>
              <p className="mt-1 text-muted">{t(lang, "correctionSubmittedHelp")}</p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 font-semibold">
                <MapPinned className="h-4 w-4 text-brand" />
                {t(lang, "correctTripDistance")}
              </div>
              <p className="mt-1 text-muted">{t(lang, "uploadScreenshotHint")}</p>

              <label className="mt-3 block font-medium" htmlFor={`correction-${journeyId}`}>
                {t(lang, "howMuchGoogleMaps")}
              </label>
              <div className="relative mt-1">
                <input
                  id={`correction-${journeyId}`}
                  className="input w-full pr-12"
                  inputMode="decimal"
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="18.6"
                  value={value}
                  onChange={(event) => {
                    setValue(event.target.value);
                    setError("");
                  }}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted">km</span>
              </div>
              <p className="mt-1 text-xs text-muted">
                {t(lang, "recordedDistance")}: {recordedKm.toFixed(2)} km
              </p>

              <input
                ref={input}
                className="hidden"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setError("");
                }}
              />
              <button
                type="button"
                className="btn-ghost mt-3 w-full justify-center"
                disabled={pending}
                onClick={() => input.current?.click()}
              >
                {file ? <ImageIcon className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
                {file ? file.name : t(lang, "uploadMapScreenshot")}
              </button>

              {error && <p className="mt-2 text-red-600" role="alert">{error}</p>}

              <button
                type="button"
                className="btn-primary mt-3 w-full justify-center"
                disabled={pending || !file || !value}
                onClick={submit}
              >
                {pending ? t(lang, "submittingCorrection") : t(lang, "submitCorrection")}
              </button>
            </>
          )}

          <button
            type="button"
            className="mt-3 min-h-9 text-muted underline"
            disabled={pending}
            onClick={() => setOpen(false)}
          >
            {submitted ? (lang === "hi" ? "बंद करें" : "Close") : t(lang, "cancel")}
          </button>
        </div>
      )}
    </div>
  );
}
