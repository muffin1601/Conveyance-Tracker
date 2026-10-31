"use client";

import { useState, useTransition, useMemo } from "react";
import {
  BrainCircuit, CheckCircle2, AlertTriangle, ShieldCheck,
  Search, History, Edit3, Power,
  ArrowRight, ExternalLink, Loader2, TrendingUp,
  MapPinned, PlusCircle, Check, X, Settings2, Users
} from "lucide-react";
import { Card, SectionTitle } from "@/components/ui";
import {
  reviewDistanceCorrection,
  getCorrectionScreenshot,
  manuallyVerifyRouteAction,
  updateVerifiedDistanceAction,
  setVerifiedRouteStatusAction,
  updateVerifiedRouteConfigAction,
  getRouteCorrectionHistoryAction,
} from "@/app/actions/distanceCorrections";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

interface PendingRow {
  id: string;
  employeeId: string;
  employee: string;
  date: string;
  from: string;
  to: string;
  original: number;
  submitted: number;
  status: string;
  userReason?: string | null;
}

interface IntelligenceRoute {
  routeKey: string;
  fromLocation: string;
  toLocation: string;
  submittedKm: number;
  verifiedKm: number | null;
  isVerified: boolean;
  status: string;
  correctionCount: number;
  approvedCount: number;
  correctionStatuses: Record<string, number>;
  isFrequentlyCorrected: boolean;
  lastVerified: string | null;
  lastSubmission: string;
  uniqueEmployeesCount: number;
  employees: string[];
  employeeIds: string[];
  correctionDates: string[];
  verifiedRouteId: string | null;
  verifiedSource: string | null;
}

interface EmployeeFrequency {
  employeeId: string;
  name: string;
  code: string;
  totalCorrections: number;
  approvedCorrections: number;
  avgDifferenceKm: number;
}

interface RouteCorrectionHistory {
  verifiedRoute: {
    fromLocationName: string;
    toLocationName: string;
    verifiedDistanceKm: number;
    approvalCount: number;
    status: string;
  } | null;
  corrections: {
    id: string;
    employeeName: string;
    employeeCode: string;
    workDate: string;
    originalDistanceKm: number;
    submittedDistanceKm: number;
    finalDistanceKm: number | null;
    differenceKm: number;
    userReason: string | null;
    adminNote: string | null;
  }[];
  auditHistory: {
    id: string;
    action: string;
    createdAt: Date | string;
    previousDistanceKm: number | null;
    newDistanceKm: number;
    reason: string | null;
  }[];
}

interface IntelligenceData {
  config: {
    detectionThreshold: number;
    toleranceKm: number;
    tolerancePercent: number;
  };
  metrics: {
    totalSubmissions: number;
    totalApproved: number;
    totalFrequentlyCorrectedRoutes: number;
    totalPermanentlyVerifiedRoutes: number;
    avgDiscrepancyKm: number;
    pendingReviews: number;
    flaggedDiscrepancies?: number;
  };
  topFrequentRoutes: IntelligenceRoute[];
  topEmployees: EmployeeFrequency[];
  routes: IntelligenceRoute[];
  discrepancyFlags?: {
    journeyId: string;
    employeeId: string;
    employee: string;
    workDate: string;
    fromLocation: string;
    toLocation: string;
    submittedKm: number;
    verifiedKm: number | null;
    differenceKm: number | null;
  }[];
}

export function CorrectionIntelligence({
  pendingRows,
  pendingCount,
  intelligence,
  employees,
}: {
  pendingRows: PendingRow[];
  pendingCount: number;
  intelligence: IntelligenceData;
  employees: { id: string; name: string }[];
}) {
  const [activeSubTab, setActiveSubTab] = useState<"memory" | "pending" | "frequent">("memory");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  // Filters
  const [searchFrom, setSearchFrom] = useState("");
  const [searchTo, setSearchTo] = useState("");
  const [filterEmployee, setFilterEmployee] = useState("");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [filterCorrectionStatus, setFilterCorrectionStatus] = useState("ALL");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Modals state
  const [historyModalRoute, setHistoryModalRoute] = useState<string | null>(null);
  const [historyData, setHistoryData] = useState<RouteCorrectionHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [verifyModal, setVerifyModal] = useState<{
    open: boolean;
    from: string;
    to: string;
    distance: string;
    notes: string;
  }>({ open: false, from: "", to: "", distance: "", notes: "" });

  const [editModal, setEditModal] = useState<{
    open: boolean;
    id: string;
    from: string;
    to: string;
    distance: string;
    notes: string;
  }>({ open: false, id: "", from: "", to: "", distance: "", notes: "" });

  const [configModal, setConfigModal] = useState(false);
  const [thresholdInput, setThresholdInput] = useState(String(intelligence.config.detectionThreshold));
  const [toleranceKmInput, setToleranceKmInput] = useState(String(intelligence.config.toleranceKm));
  const [tolerancePercentInput, setTolerancePercentInput] = useState(String(intelligence.config.tolerancePercent));

  // Filtered routes
  const filteredRoutes = useMemo(() => {
    return intelligence.routes.filter((r) => {
      if (searchFrom && !r.fromLocation.toLowerCase().includes(searchFrom.toLowerCase())) return false;
      if (searchTo && !r.toLocation.toLowerCase().includes(searchTo.toLowerCase())) return false;
      if (filterStatus !== "ALL") {
        if (filterStatus === "ACTIVE" && (!r.isVerified || r.status !== "ACTIVE")) return false;
        if (filterStatus === "FREQUENT" && !r.isFrequentlyCorrected) return false;
        if (filterStatus === "DISABLED" && r.status !== "DISABLED" && r.status !== "ARCHIVED") return false;
      }
      if (filterEmployee && !r.employeeIds.includes(filterEmployee)) return false;
      if (
        filterCorrectionStatus !== "ALL" &&
        !r.correctionStatuses?.[filterCorrectionStatus]
      ) return false;
      if (fromDate || toDate) {
        const dates = r.correctionDates.length
          ? r.correctionDates
          : [r.lastVerified?.slice(0, 10) ?? ""];
        if (!dates.some((day: string) => (!fromDate || day >= fromDate) && (!toDate || day <= toDate))) {
          return false;
        }
      }
      return true;
    });
  }, [intelligence.routes, searchFrom, searchTo, filterStatus, filterCorrectionStatus, filterEmployee, fromDate, toDate]);

  const filteredPending = useMemo(() => {
    return pendingRows.filter((row) => {
      if (filterEmployee && row.employeeId !== filterEmployee) return false;
      if (filterCorrectionStatus !== "ALL" && row.status !== filterCorrectionStatus) return false;
      if (fromDate && row.date < fromDate) return false;
      if (toDate && row.date > toDate) return false;
      if (searchFrom && !row.from.toLowerCase().includes(searchFrom.toLowerCase())) return false;
      if (searchTo && !row.to.toLowerCase().includes(searchTo.toLowerCase())) return false;
      return true;
    });
  }, [pendingRows, filterEmployee, filterCorrectionStatus, fromDate, toDate, searchFrom, searchTo]);

  const filteredFlags = useMemo(() => {
    const flags = intelligence.discrepancyFlags ?? [];
    return flags.filter((f) => {
      if (filterEmployee && f.employeeId !== filterEmployee) return false;
      if (fromDate && f.workDate < fromDate) return false;
      if (toDate && f.workDate > toDate) return false;
      if (searchFrom && !f.fromLocation.toLowerCase().includes(searchFrom.toLowerCase())) return false;
      if (searchTo && !f.toLocation.toLowerCase().includes(searchTo.toLowerCase())) return false;
      return true;
    });
  }, [intelligence.discrepancyFlags, filterEmployee, fromDate, toDate, searchFrom, searchTo]);

  // Open Route History
  function openHistory(routeKey: string) {
    setHistoryModalRoute(routeKey);
    setHistoryLoading(true);
    setHistoryData(null);
    start(async () => {
      try {
        const data = await getRouteCorrectionHistoryAction(routeKey);
        setHistoryData(data);
      } catch (err) {
        setMessage({ text: errorMessage(err), ok: false });
      } finally {
        setHistoryLoading(false);
      }
    });
  }

  // Handle Review of pending correction
  function review(row: PendingRow, decision: "APPROVED" | "REJECTED") {
    if (pending) return;
    if (decision === "REJECTED" && !confirm(`Reject ${row.employee}'s distance correction?`)) return;
    setMessage(null);
    setBusyId(row.id);
    start(async () => {
      try {
        const res = await reviewDistanceCorrection({
          id: row.id,
          decision,
          finalDistanceKm: decision === "APPROVED" ? row.submitted : undefined,
        });
        if (res.thresholdMet) {
          setMessage({
            text: `Correction approved! Frequent correction threshold met: Route permanently saved with verified distance of ${res.verifiedDistanceKm} KM.`,
            ok: true,
          });
        } else {
          setMessage({ text: `Correction ${decision.toLowerCase()}.`, ok: true });
        }
      } catch (e) {
        setMessage({ text: errorMessage(e), ok: false });
      } finally {
        setBusyId(null);
      }
    });
  }

  // View Screenshot Evidence
  function viewScreenshot(id: string) {
    setMessage(null);
    setBusyId(id);
    start(async () => {
      try {
        window.open(await getCorrectionScreenshot(id), "_blank", "noopener,noreferrer");
      } catch (e) {
        setMessage({ text: errorMessage(e), ok: false });
      } finally {
        setBusyId(null);
      }
    });
  }

  // Submit manual route verification
  function handleManualVerifySubmit() {
    const dist = parseFloat(verifyModal.distance);
    if (!verifyModal.from.trim() || !verifyModal.to.trim()) {
      alert("From and To locations are required.");
      return;
    }
    if (!Number.isFinite(dist) || dist <= 0) {
      alert("Please enter a valid positive distance in KM.");
      return;
    }

    start(async () => {
      try {
        await manuallyVerifyRouteAction({
          fromLocation: verifyModal.from.trim(),
          toLocation: verifyModal.to.trim(),
          distanceKm: dist,
          notes: verifyModal.notes.trim() || undefined,
        });
        setVerifyModal({ open: false, from: "", to: "", distance: "", notes: "" });
        setMessage({ text: "Route distance permanently verified successfully!", ok: true });
      } catch (e) {
        setMessage({ text: errorMessage(e), ok: false });
      }
    });
  }

  // Submit update of verified distance
  function handleUpdateVerifiedSubmit() {
    const dist = parseFloat(editModal.distance);
    if (!Number.isFinite(dist) || dist <= 0) {
      alert("Please enter a valid positive distance in KM.");
      return;
    }

    start(async () => {
      try {
        await updateVerifiedDistanceAction({
          id: editModal.id,
          distanceKm: dist,
          notes: editModal.notes.trim() || undefined,
        });
        setEditModal({ open: false, id: "", from: "", to: "", distance: "", notes: "" });
        setMessage({ text: "Verified route distance updated with audit log entry.", ok: true });
      } catch (e) {
        setMessage({ text: errorMessage(e), ok: false });
      }
    });
  }

  // Toggle route active/disabled status
  function toggleRouteStatus(routeId: string, currentStatus: string) {
    const newStatus = currentStatus === "ACTIVE" ? "DISABLED" : "ACTIVE";
    const promptMsg =
      newStatus === "DISABLED"
        ? "Disable this verified route? It will stop auto-filling for employees."
        : "Re-activate this verified route?";
    if (!confirm(promptMsg)) return;

    start(async () => {
      try {
        await setVerifiedRouteStatusAction({
          id: routeId,
          status: newStatus,
          reason: `Status changed to ${newStatus} by admin`,
        });
        setMessage({ text: `Route status updated to ${newStatus}.`, ok: true });
      } catch (e) {
        setMessage({ text: errorMessage(e), ok: false });
      }
    });
  }

  // Save config settings
  function handleSaveConfig() {
    const threshold = parseInt(thresholdInput, 10);
    const tolKm = parseFloat(toleranceKmInput);
    const tolPct = parseFloat(tolerancePercentInput);

    if (isNaN(threshold) || threshold < 1) {
      alert("Threshold must be an integer >= 1.");
      return;
    }
    if (isNaN(tolKm) || tolKm <= 0) {
      alert("Tolerance KM must be a positive number.");
      return;
    }

    start(async () => {
      try {
        await updateVerifiedRouteConfigAction({
          detectionThreshold: threshold,
          toleranceKm: tolKm,
          tolerancePercent: isNaN(tolPct) ? 5 : tolPct,
        });
        setConfigModal(false);
        setMessage({ text: "Correction intelligence configuration updated.", ok: true });
      } catch (e) {
        setMessage({ text: errorMessage(e), ok: false });
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* ── Headline Header with Config & Action Buttons ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-surface/90 p-5 shadow-sm backdrop-blur-md">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <BrainCircuit className="h-5 w-5" />
            </span>
            <h2 className="text-xl font-bold tracking-tight">Correction Intelligence & Route Memory</h2>
          </div>
          <p className="mt-1 text-xs text-muted">
            Learns from approved conveyance corrections, automatically identifies recurring discrepancies, and permanently remembers verified distances.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-ghost flex items-center gap-1.5 text-xs font-medium"
            onClick={() => setConfigModal(true)}
            title="Configure detection threshold and tolerance"
          >
            <Settings2 className="h-4 w-4 text-muted" />
            Config (Threshold: {intelligence.config.detectionThreshold})
          </button>
          <button
            type="button"
            className="btn-primary flex items-center gap-1.5 text-xs font-medium"
            onClick={() => setVerifyModal({ open: true, from: "", to: "", distance: "", notes: "" })}
          >
            <PlusCircle className="h-4 w-4" />
            Verify New Route
          </button>
        </div>
      </div>

      {/* ── Status Message Banner ── */}
      {message && (
        <div
          role="status"
          className={cn(
            "flex items-center justify-between gap-2 rounded-lg border p-3 text-sm shadow-xs transition",
            message.ok
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
              : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
          )}
        >
          <div className="flex items-center gap-2">
            {message.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" /> : <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />}
            <span>{message.text}</span>
          </div>
          <button type="button" onClick={() => setMessage(null)} className="text-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── Key Metrics Cards (Section 5 requirements) ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-xl border border-border/60 bg-surface/80 p-3.5 shadow-xs">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Total Submissions</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-foreground">{intelligence.metrics.totalSubmissions}</div>
          <div className="mt-1 text-[10px] text-muted">All historical requests</div>
        </div>

        <div className="rounded-xl border border-border/60 bg-surface/80 p-3.5 shadow-xs">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Approved Corrections</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-emerald-600">{intelligence.metrics.totalApproved}</div>
          <div className="mt-1 text-[10px] text-emerald-700/80">Admin accepted</div>
        </div>

        <div className="rounded-xl border border-border/60 bg-surface/80 p-3.5 shadow-xs">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Frequent Routes</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-brand">{intelligence.metrics.totalFrequentlyCorrectedRoutes}</div>
          <div className="mt-1 text-[10px] text-muted">≥ {intelligence.config.detectionThreshold} approved fixes</div>
        </div>

        <div className="rounded-xl border border-border/60 bg-surface/80 p-3.5 shadow-xs">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Permanently Verified</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-emerald-700">{intelligence.metrics.totalPermanentlyVerifiedRoutes}</div>
          <div className="mt-1 text-[10px] text-muted">Active route memory</div>
        </div>

        <div className="rounded-xl border border-border/60 bg-surface/80 p-3.5 shadow-xs">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Avg Discrepancy</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-amber-600">{intelligence.metrics.avgDiscrepancyKm} km</div>
          <div className="mt-1 text-[10px] text-muted">Distance gap</div>
        </div>

        <div className="rounded-xl border border-border/60 bg-surface/80 p-3.5 shadow-xs">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Pending Reviews</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-amber-500">{pendingCount}</div>
          <div className="mt-1 text-[10px] text-amber-600">
            {intelligence.metrics.flaggedDiscrepancies ?? 0} flagged vs verified
          </div>
        </div>
      </div>

      {/* ── Sub Navigation Tabs ── */}
      <div className="flex border-b border-border/60">
        <button
          type="button"
          onClick={() => setActiveSubTab("memory")}
          className={cn(
            "flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition",
            activeSubTab === "memory"
              ? "border-brand text-brand"
              : "border-transparent text-muted hover:text-foreground"
          )}
        >
          <ShieldCheck className="h-4 w-4" />
          Verified Route Memory ({intelligence.routes.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab("pending")}
          className={cn(
            "flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition",
            activeSubTab === "pending"
              ? "border-brand text-brand"
              : "border-transparent text-muted hover:text-foreground"
          )}
        >
          <AlertTriangle className="h-4 w-4" />
          Pending Reviews ({filteredPending.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab("frequent")}
          className={cn(
            "flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition",
            activeSubTab === "frequent"
              ? "border-brand text-brand"
              : "border-transparent text-muted hover:text-foreground"
          )}
        >
          <TrendingUp className="h-4 w-4" />
          Frequency Analytics
        </button>
      </div>

      {/* ── SUB-TAB 1: Verified Route Memory & Table ── */}
      {activeSubTab === "memory" && (
        <Card>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <SectionTitle>Permanent Verified Routes & Route Intelligence</SectionTitle>
              <p className="-mt-2 text-xs text-muted">
                Routes below with ≥ {intelligence.config.detectionThreshold} approved corrections are permanently remembered. When employees submit these routes again, the verified distance is displayed and duplicate corrections are prevented.
              </p>
            </div>
            <span className="badge border-brand/20 bg-brand/10 text-brand">
              {filteredRoutes.length} of {intelligence.routes.length} routes matching
            </span>
          </div>

          {/* ── Filters (Section 5 requirements) ── */}
          <div className="mb-4 grid grid-cols-1 gap-2 rounded-lg border bg-surface/60 p-3 sm:grid-cols-2 lg:grid-cols-7">
            <div>
              <label className="text-[10px] font-semibold uppercase text-muted">From Location</label>
              <div className="relative mt-1">
                <input
                  type="text"
                  placeholder="Filter origin..."
                  className="input w-full pl-8 text-xs"
                  value={searchFrom}
                  onChange={(e) => setSearchFrom(e.target.value)}
                />
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-semibold uppercase text-muted">To Location</label>
              <div className="relative mt-1">
                <input
                  type="text"
                  placeholder="Filter destination..."
                  className="input w-full pl-8 text-xs"
                  value={searchTo}
                  onChange={(e) => setSearchTo(e.target.value)}
                />
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-semibold uppercase text-muted">Route status</label>
              <select
                className="input mt-1 w-full text-xs"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="ALL">All Statuses</option>
                <option value="ACTIVE">Permanently Verified (Active)</option>
                <option value="FREQUENT">Frequently Corrected (≥ {intelligence.config.detectionThreshold})</option>
                <option value="DISABLED">Disabled / Archived</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-semibold uppercase text-muted">Correction status</label>
              <select
                className="input mt-1 w-full text-xs"
                value={filterCorrectionStatus}
                onChange={(e) => setFilterCorrectionStatus(e.target.value)}
              >
                <option value="ALL">All Corrections</option>
                <option value="PENDING">Pending</option>
                <option value="MANUAL_REVIEW">Manual Review</option>
                <option value="AUTO_VERIFIED">Auto Verified</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-semibold uppercase text-muted">Employee</label>
              <select
                className="input mt-1 w-full text-xs"
                value={filterEmployee}
                onChange={(e) => setFilterEmployee(e.target.value)}
              >
                <option value="">All Employees</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-semibold uppercase text-muted">From date</label>
              <input
                type="date"
                className="input mt-1 w-full text-xs"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase text-muted">To date</label>
              <input
                type="date"
                className="input mt-1 w-full text-xs"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
          </div>

          {/* ── Table (Section 5 requirements) ── */}
          <div className="overflow-x-auto rounded-lg border border-border/70">
            <table className="w-full text-left text-xs">
              <thead className="border-b bg-surface/80 text-[11px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="p-3">From Location</th>
                  <th className="p-3">To Location</th>
                  <th className="p-3 text-right">Submitted KM</th>
                  <th className="p-3 text-right">Verified KM</th>
                  <th className="p-3 text-center">Correction Count</th>
                  <th className="p-3 text-center">Last Verified</th>
                  <th className="p-3 text-center">Status</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {filteredRoutes.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-sm text-muted">
                      No routes match the selected filters.
                    </td>
                  </tr>
                ) : (
                  filteredRoutes.map((r) => {
                    const verifiedRouteId = r.verifiedRouteId;
                    return (
                      <tr key={r.routeKey} className="transition hover:bg-surface/50">
                        <td className="p-3 font-medium">
                          <div className="max-w-xs truncate" title={r.fromLocation}>
                            {r.fromLocation}
                          </div>
                        </td>
                        <td className="p-3 font-medium">
                          <div className="max-w-xs truncate" title={r.toLocation}>
                            {r.toLocation}
                          </div>
                        </td>
                        <td className="p-3 text-right tabular-nums text-muted">
                          {r.submittedKm ? `${r.submittedKm.toFixed(1)} km` : "—"}
                        </td>
                        <td className="p-3 text-right font-bold tabular-nums text-brand">
                          {r.verifiedKm != null ? (
                            <span className="inline-flex items-center gap-1 rounded bg-brand/10 px-2 py-0.5 text-brand">
                              <CheckCircle2 className="h-3 w-3" />
                              {r.verifiedKm} km
                            </span>
                          ) : (
                            <span className="text-muted">Not Set</span>
                          )}
                        </td>
                        <td className="p-3 text-center tabular-nums">
                          <span
                            className={cn(
                              "inline-block rounded-full px-2 py-0.5 font-semibold",
                              r.approvedCount >= intelligence.config.detectionThreshold
                                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                : "bg-bg text-muted"
                            )}
                          >
                            {r.approvedCount} approved ({r.correctionCount} total)
                          </span>
                        </td>
                        <td className="p-3 text-center text-[11px] tabular-nums text-muted">
                          {r.lastVerified ? new Date(r.lastVerified).toLocaleDateString() : "Pending"}
                        </td>
                        <td className="p-3 text-center">
                          {r.status === "ACTIVE" ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                              <ShieldCheck className="h-3 w-3" />
                              Verified
                            </span>
                          ) : r.status === "DISABLED" || r.status === "ARCHIVED" ? (
                            <span className="inline-block rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-600">
                              Disabled
                            </span>
                          ) : r.isFrequentlyCorrected ? (
                            <span className="inline-block rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                              Frequent
                            </span>
                          ) : (
                            <span className="inline-block rounded-full bg-bg px-2 py-0.5 text-[10px] font-medium text-muted">
                              Pending
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* View History */}
                            <button
                              type="button"
                              className="rounded p-1 text-muted hover:bg-bg hover:text-foreground"
                              title="View correction audit history"
                              onClick={() => openHistory(r.routeKey)}
                            >
                              <History className="h-4 w-4" />
                            </button>

                            {/* Edit / Verify */}
                            {verifiedRouteId ? (
                              <button
                                type="button"
                                className="rounded p-1 text-brand hover:bg-brand/10"
                                title="Update verified distance"
                                onClick={() =>
                                  setEditModal({
                                    open: true,
                                    id: verifiedRouteId,
                                    from: r.fromLocation,
                                    to: r.toLocation,
                                    distance: String(r.verifiedKm),
                                    notes: "",
                                  })
                                }
                              >
                                <Edit3 className="h-4 w-4" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn-ghost px-2 py-1 text-[11px]"
                                title="Manually verify this route"
                                onClick={() =>
                                  setVerifyModal({
                                    open: true,
                                    from: r.fromLocation,
                                    to: r.toLocation,
                                    distance: r.verifiedKm ? String(r.verifiedKm) : "",
                                    notes: "",
                                  })
                                }
                              >
                                Verify
                              </button>
                            )}

                            {/* Enable/Disable status toggle */}
                            {verifiedRouteId && (
                              <button
                                type="button"
                                className={cn(
                                  "rounded p-1 transition",
                                  r.status === "ACTIVE"
                                    ? "text-red-500 hover:bg-red-500/10"
                                    : "text-emerald-600 hover:bg-emerald-500/10"
                                )}
                                title={r.status === "ACTIVE" ? "Disable route memory" : "Enable route memory"}
                                onClick={() => toggleRouteStatus(verifiedRouteId, r.status)}
                              >
                                <Power className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── SUB-TAB 2: Pending Corrections Review ── */}
      {activeSubTab === "pending" && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <SectionTitle>Pending distance corrections</SectionTitle>
              <p className="-mt-2 text-xs text-muted">
                Review employee-submitted map evidence. When an approved correction meets the threshold of {intelligence.config.detectionThreshold}, the route distance is permanently saved to memory.
              </p>
            </div>
            <span className="badge border-amber-500/20 bg-amber-500/10 text-amber-700">
              {filteredPending.length} awaiting review
            </span>
          </div>

          <div className="space-y-3">
            {filteredPending.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted">No distance corrections currently awaiting review.</p>
            ) : (
              filteredPending.map((row) => {
                const busy = busyId === row.id;
                return (
                  <article key={row.id} className="rounded-lg border bg-surface/60 p-4 transition hover:border-brand/30">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground">
                          {row.employee} <span className="font-normal text-muted">· {row.date}</span>
                        </p>
                        <p className="mt-1 flex items-start gap-1 text-xs text-muted">
                          <MapPinned className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
                          <span className="font-medium text-foreground">{row.from}</span>
                          <ArrowRight className="h-3 w-3 shrink-0 self-center text-muted" />
                          <span className="font-medium text-foreground">{row.to}</span>
                        </p>
                        {row.userReason && (
                          <p className="mt-1.5 text-xs text-muted italic">
                            Reason: &ldquo;{row.userReason}&rdquo;
                          </p>
                        )}
                      </div>

                      <div className="flex gap-2 text-right text-sm tabular-nums">
                        <div className="rounded bg-bg px-2.5 py-1">
                          <span className="block text-[10px] uppercase text-muted">Recorded</span>
                          <span className="font-semibold">{row.original.toFixed(2)} km</span>
                        </div>
                        <div className="rounded bg-brand/10 px-2.5 py-1 text-brand">
                          <span className="block text-[10px] uppercase font-semibold">Requested</span>
                          <span className="font-bold">{row.submitted.toFixed(2)} km</span>
                        </div>
                        <div className="rounded bg-amber-500/10 px-2 py-1 text-amber-700">
                          <span className="block text-[10px] uppercase">Diff</span>
                          <span>{Math.abs(row.submitted - row.original).toFixed(1)} km</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                      <button className="btn-ghost text-xs" disabled={pending} onClick={() => viewScreenshot(row.id)}>
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />} Evidence
                      </button>
                      <button className="btn-primary text-xs" disabled={pending} onClick={() => review(row, "APPROVED")}>
                        <Check className="h-3.5 w-3.5" /> Approve {row.submitted.toFixed(2)} km
                      </button>
                      <button className="btn-ghost text-xs text-red-600 hover:bg-red-50" disabled={pending} onClick={() => review(row, "REJECTED")}>
                        <X className="h-3.5 w-3.5" /> Reject
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>

          <div className="mt-6 border-t pt-4">
            <SectionTitle>Flagged vs previously verified distance</SectionTitle>
            <p className="-mt-2 mb-3 text-xs text-muted">
              Logged trips whose submitted distance exceeded the verified route tolerance. Claim approval is unchanged — these are review flags only.
            </p>
            {filteredFlags.length === 0 ? (
              <p className="text-sm text-muted">No flagged discrepancies for the current filters.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-left text-xs">
                  <thead className="border-b bg-surface/80 text-[11px] uppercase text-muted">
                    <tr>
                      <th className="p-2">Date</th>
                      <th className="p-2">Employee</th>
                      <th className="p-2">From</th>
                      <th className="p-2">To</th>
                      <th className="p-2 text-right">Submitted</th>
                      <th className="p-2 text-right">Verified</th>
                      <th className="p-2 text-right">Diff</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredFlags.map((f) => (
                      <tr key={f.journeyId}>
                        <td className="p-2 whitespace-nowrap">{f.workDate}</td>
                        <td className="p-2">{f.employee}</td>
                        <td className="p-2 max-w-[10rem] truncate">{f.fromLocation}</td>
                        <td className="p-2 max-w-[10rem] truncate">{f.toLocation}</td>
                        <td className="p-2 text-right tabular-nums">{f.submittedKm.toFixed(2)} km</td>
                        <td className="p-2 text-right tabular-nums">{f.verifiedKm != null ? `${f.verifiedKm.toFixed(2)} km` : "—"}</td>
                        <td className="p-2 text-right tabular-nums text-amber-700">{f.differenceKm != null ? `${f.differenceKm.toFixed(2)} km` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ── SUB-TAB 3: Frequency Analytics (Section 5 requirements) ── */}
      {activeSubTab === "frequent" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Routes with Highest Correction Frequency */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <SectionTitle>Highest Correction Frequency Routes</SectionTitle>
              <TrendingUp className="h-4 w-4 text-brand" />
            </div>
            <p className="-mt-2 mb-3 text-xs text-muted">
              Routes corrected most frequently by employees. Automatically prioritized for permanent distance verification.
            </p>

            <div className="space-y-2">
              {intelligence.topFrequentRoutes.slice(0, 7).map((r, i) => (
                <div key={r.routeKey} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-xs">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-medium text-foreground">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[10px] font-bold text-brand">
                        {i + 1}
                      </span>
                      <span className="truncate">{r.fromLocation}</span>
                      <ArrowRight className="h-3 w-3 shrink-0 text-muted" />
                      <span className="truncate">{r.toLocation}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-muted">
                      {r.employees.length} unique employees · Avg submitted: {r.submittedKm} km
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="block font-bold text-brand">{r.approvedCount} approved</span>
                    {r.isVerified && (
                      <span className="text-[10px] font-medium text-emerald-600">Verified: {r.verifiedKm} km</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Employees with Highest Correction Frequency */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <SectionTitle>Staff with Highest Correction Frequency</SectionTitle>
              <Users className="h-4 w-4 text-brand" />
            </div>
            <p className="-mt-2 mb-3 text-xs text-muted">
              Team members who submit distance corrections most frequently.
            </p>

            <div className="space-y-2">
              {intelligence.topEmployees.slice(0, 7).map((emp, i) => (
                <div key={emp.employeeId} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-xs">
                  <div>
                    <div className="flex items-center gap-2 font-semibold text-foreground">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-surface text-[10px] font-bold">
                        {i + 1}
                      </span>
                      {emp.name}
                      <span className="text-[10px] text-muted">({emp.code})</span>
                    </div>
                    <div className="mt-1 text-[11px] text-muted">
                      Avg discrepancy: {emp.avgDifferenceKm} km per trip
                    </div>
                  </div>

                  <div className="text-right font-medium">
                    <span className="block font-bold text-brand">{emp.approvedCorrections} approved</span>
                    <span className="text-[10px] text-muted">of {emp.totalCorrections} submitted</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* ── MODAL: Route Correction History ── */}
      {historyModalRoute && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border bg-surface p-5 shadow-2xl">
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold text-foreground">Route Correction History & Audit Log</h3>
                <p className="mt-0.5 text-xs text-muted">Detailed audit trail of all submissions and updates for this route.</p>
              </div>
              <button
                type="button"
                className="rounded p-1 text-muted hover:text-foreground"
                onClick={() => setHistoryModalRoute(null)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {historyLoading ? (
              <div className="flex items-center justify-center p-12 text-sm text-muted">
                <Loader2 className="mr-2 h-5 w-5 animate-spin text-brand" /> Loading correction history...
              </div>
            ) : historyData ? (
              <div className="mt-4 space-y-4">
                {/* Route Overview */}
                <div className="rounded-lg border bg-surface/50 p-3 text-xs">
                  <div className="flex items-center gap-2 font-semibold text-sm">
                    <span>{historyData.verifiedRoute?.fromLocationName || "Origin"}</span>
                    <ArrowRight className="h-4 w-4 text-muted" />
                    <span>{historyData.verifiedRoute?.toLocationName || "Destination"}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-4 text-muted">
                    <div>
                      <span className="font-semibold text-foreground">
                        {historyData.verifiedRoute?.verifiedDistanceKm ?? "—"} km
                      </span>{" "}
                      permanent verified
                    </div>
                    <div>
                      <span className="font-semibold text-foreground">
                        {historyData.verifiedRoute?.approvalCount ?? historyData.corrections.length}
                      </span>{" "}
                      total approved
                    </div>
                    <div>
                      Status:{" "}
                      <span className="font-semibold text-emerald-600">
                        {historyData.verifiedRoute?.status ?? "Active"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Individual Corrections List */}
                <div>
                  <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">
                    Submissions ({historyData.corrections.length})
                  </h4>
                  <div className="max-h-60 overflow-y-auto rounded-lg border divide-y text-xs">
                    {historyData.corrections.map((c) => (
                      <div key={c.id} className="p-3">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-foreground">{c.employeeName} ({c.employeeCode})</span>
                          <span className="text-muted tabular-nums">{c.workDate}</span>
                        </div>
                        <div className="mt-1 flex gap-3 text-muted">
                          <span>Recorded: {c.originalDistanceKm} km</span>
                          <span className="text-brand font-medium">Submitted: {c.submittedDistanceKm} km</span>
                          {c.finalDistanceKm && <span className="text-emerald-600 font-semibold">Approved: {c.finalDistanceKm} km</span>}
                          <span>Diff: {c.differenceKm.toFixed(1)} km</span>
                        </div>
                        {c.userReason && (
                          <p className="mt-1 text-[11px] text-muted italic">Reason: &ldquo;{c.userReason}&rdquo;</p>
                        )}
                        {c.adminNote && (
                          <p className="mt-0.5 text-[11px] text-emerald-700">Admin Note: {c.adminNote}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Audit Trail */}
                {historyData.auditHistory && historyData.auditHistory.length > 0 && (
                  <div>
                    <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Permanent Memory Audit Trail</h4>
                    <div className="space-y-1.5 text-xs text-muted">
                      {historyData.auditHistory.map((a) => (
                        <div key={a.id} className="rounded border bg-surface/30 p-2">
                          <div className="flex items-center justify-between font-medium">
                            <span className="text-foreground">{a.action}</span>
                            <span className="text-[11px] tabular-nums">{new Date(a.createdAt).toLocaleString()}</span>
                          </div>
                          <p className="mt-0.5 text-[11px]">
                            {a.previousDistanceKm != null ? `${a.previousDistanceKm} km → ` : ""}
                            <strong>{a.newDistanceKm} km</strong> ({a.reason || "Updated"})
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            <div className="mt-5 text-right">
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => setHistoryModalRoute(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: Manually Verify Route Distance ── */}
      {verifyModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border bg-surface p-5 shadow-2xl">
            <h3 className="text-base font-bold text-foreground">Manually Verify Route Distance</h3>
            <p className="mt-1 text-xs text-muted">
              Permanently remember a verified distance for this From and To location pair.
            </p>

            <div className="mt-4 space-y-3 text-xs">
              <div>
                <label className="font-semibold text-muted">From Location</label>
                <input
                  type="text"
                  className="input mt-1 w-full"
                  placeholder="e.g. Watcon International — Head Office"
                  value={verifyModal.from}
                  onChange={(e) => setVerifyModal({ ...verifyModal, from: e.target.value })}
                />
              </div>

              <div>
                <label className="font-semibold text-muted">To Location</label>
                <input
                  type="text"
                  className="input mt-1 w-full"
                  placeholder="e.g. Okhla Phase II, Delhi"
                  value={verifyModal.to}
                  onChange={(e) => setVerifyModal({ ...verifyModal, to: e.target.value })}
                />
              </div>

              <div>
                <label className="font-semibold text-muted">Verified Distance (KM)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.1"
                  className="input mt-1 w-full tabular-nums font-semibold"
                  placeholder="15.0"
                  value={verifyModal.distance}
                  onChange={(e) => setVerifyModal({ ...verifyModal, distance: e.target.value })}
                />
              </div>

              <div>
                <label className="font-semibold text-muted">Audit Note (Optional)</label>
                <input
                  type="text"
                  className="input mt-1 w-full"
                  placeholder="e.g. Verified via odometer / Google Maps master review"
                  value={verifyModal.notes}
                  onChange={(e) => setVerifyModal({ ...verifyModal, notes: e.target.value })}
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => setVerifyModal({ open: false, from: "", to: "", distance: "", notes: "" })}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary text-xs"
                disabled={pending}
                onClick={handleManualVerifySubmit}
              >
                {pending ? "Saving…" : "Save Verified Route"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: Update Existing Verified Distance ── */}
      {editModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border bg-surface p-5 shadow-2xl">
            <h3 className="text-base font-bold text-foreground">Update Verified Route Distance</h3>
            <p className="mt-1 text-xs text-muted">
              {editModal.from} → {editModal.to}
            </p>

            <div className="mt-4 space-y-3 text-xs">
              <div>
                <label className="font-semibold text-muted">New Verified Distance (KM)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.1"
                  className="input mt-1 w-full tabular-nums font-semibold text-brand"
                  value={editModal.distance}
                  onChange={(e) => setEditModal({ ...editModal, distance: e.target.value })}
                />
              </div>

              <div>
                <label className="font-semibold text-muted">Reason for Change (Audit Note)</label>
                <input
                  type="text"
                  className="input mt-1 w-full"
                  placeholder="e.g. Recalculated due to new highway access"
                  value={editModal.notes}
                  onChange={(e) => setEditModal({ ...editModal, notes: e.target.value })}
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => setEditModal({ open: false, id: "", from: "", to: "", distance: "", notes: "" })}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary text-xs"
                disabled={pending}
                onClick={handleUpdateVerifiedSubmit}
              >
                {pending ? "Updating…" : "Update & Log"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: Configure Detection Threshold & Tolerances ── */}
      {configModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border bg-surface p-5 shadow-2xl">
            <h3 className="text-base font-bold text-foreground">Detection & Tolerance Configuration</h3>
            <p className="mt-1 text-xs text-muted">
              Configure automatic frequent correction detection and tolerance settings.
            </p>

            <div className="mt-4 space-y-3 text-xs">
              <div>
                <label className="font-semibold text-foreground">
                  Frequent Correction Threshold (Approved Count)
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  className="input mt-1 w-full"
                  value={thresholdInput}
                  onChange={(e) => setThresholdInput(e.target.value)}
                />
                <p className="mt-1 text-[10px] text-muted">
                  Default: 3. A route is automatically committed to permanent memory when it receives this many approved corrections.
                </p>
              </div>

              <div>
                <label className="font-semibold text-foreground">Distance Tolerance (KM)</label>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  className="input mt-1 w-full"
                  value={toleranceKmInput}
                  onChange={(e) => setToleranceKmInput(e.target.value)}
                />
                <p className="mt-1 text-[10px] text-muted">
                  Default: 0.5 KM. If the submitted distance is within this gap, it is marked as matching without requesting further corrections.
                </p>
              </div>

              <div>
                <label className="font-semibold text-foreground">Percentage Tolerance (%)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  className="input mt-1 w-full"
                  value={tolerancePercentInput}
                  onChange={(e) => setTolerancePercentInput(e.target.value)}
                />
                <p className="mt-1 text-[10px] text-muted">
                  Default: 5%. Percentage discrepancy allowance for longer routes.
                </p>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => setConfigModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary text-xs"
                disabled={pending}
                onClick={handleSaveConfig}
              >
                {pending ? "Saving…" : "Save Settings"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
