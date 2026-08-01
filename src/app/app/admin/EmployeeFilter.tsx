"use client";

import { useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Users } from "lucide-react";
import { Combobox, type ComboOption } from "@/components/Combobox";

/**
 * Scopes the whole Admin view — table, totals and every export link — to one
 * employee. The choice lives in the URL (?employee=<id>) so the server
 * component can filter in the database rather than in the browser, and so the
 * filtered view can be bookmarked or shared.
 */
export function EmployeeFilter({
  employees,
  employeeId,
  period,
}: {
  employees: { id: string; name: string; designation: string }[];
  employeeId: string;
  period: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const options = useMemo<ComboOption[]>(
    () => employees.map((e) => ({ value: e.id, label: e.name, sublabel: e.designation })),
    [employees],
  );

  function choose(id: string) {
    const q = new URLSearchParams({ period });
    if (id) q.set("employee", id);
    start(() => router.push(`/app/admin?${q.toString()}`));
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="inline-flex items-center gap-1.5 text-muted">
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
        Employee
      </span>
      <Combobox
        options={options}
        value={employeeId}
        onChange={choose}
        placeholder="All employees"
        searchPlaceholder="Search staff…"
        emptyMessage="No employee matches that search."
        className="w-56"
      />
    </label>
  );
}
