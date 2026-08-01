"use client";

import {
  useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState,
  memo,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A production searchable select (combobox) built on native elements — no new
 * dependencies. Replaces the plain <select> pickers, which became unusable
 * once the master lists grew past a few dozen rows.
 *
 * Behaviour
 *  - Typing filters instantly (token-prefix match over label + sublabel).
 *  - ArrowUp/ArrowDown move the active row, Home/End jump, Enter selects,
 *    Escape closes (and restores the previous value), Tab commits & closes.
 *  - Full mouse/touch support; the listbox is rendered in a portal so it is
 *    never clipped by a scrolling card, and it flips above the field when
 *    there is not enough room below (important on mobile with the keyboard up).
 *  - Options are grouped; a "Recent" group can be pinned to the top.
 *
 * Performance (Issue 5): the searchable haystack is precomputed once per
 * option list, filtering runs inside useMemo against a deferred query so
 * keystrokes never block paint, and at most MAX_RENDERED rows are mounted at
 * a time. This stays smooth well past 1,000 records.
 */

export interface ComboOption {
  value: string;
  label: string;
  /** Secondary line (city, designation …). Also searched. */
  sublabel?: string;
  /** Extra searchable text that is not displayed (codes, aliases). */
  keywords?: string;
  /** Group heading. Options are rendered in `groupOrder` order. */
  group?: string;
  /** Small trailing tag, e.g. "shared" / "manual". */
  tag?: string;
  disabled?: boolean;
}

interface IndexedOption extends ComboOption {
  /** Lowercased "label sublabel keywords" — computed once. */
  haystack: string;
}

/** Cap on simultaneously mounted rows. Filtering narrows well below this. */
const MAX_RENDERED = 100;

function normalise(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Match if every whitespace-separated term in the query appears in the
 * haystack. Word-boundary hits rank above mid-word ones so "raj" surfaces
 * "Rajesh" before "Bajrangi".
 */
function score(hay: string, terms: string[]): number {
  let total = 0;
  for (const t of terms) {
    const at = hay.indexOf(t);
    if (at < 0) return -1;
    const boundary = at === 0 || hay[at - 1] === " ";
    total += (at === 0 ? 0 : boundary ? 1 : 2) + at / 1000;
  }
  return total;
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Type to search…",
  emptyMessage = "No matches.",
  groupOrder,
  disabled = false,
  clearable = true,
  id,
  invalid = false,
  describedBy,
  className,
}: {
  options: ComboOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  /** Groups render in this order; anything else follows alphabetically. */
  groupOrder?: string[];
  disabled?: boolean;
  clearable?: boolean;
  id?: string;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
}) {
  const reactId = useId();
  const fieldId = id ?? `combo-${reactId}`;
  const listId = `${fieldId}-listbox`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  /**
   * `null` means "no explicit choice yet" — the active row is then derived
   * from the current selection (or the best match once filtering starts).
   * Keeping it derived rather than synchronising it from an effect avoids a
   * cascading re-render on every open and every keystroke.
   */
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Deferring the query keeps typing at 60fps on very large lists: React
  // paints the new input value first, then re-filters.
  const deferredQuery = useDeferredValue(query);

  // ── Search index — rebuilt only when the option list identity changes ──
  const indexed = useMemo<IndexedOption[]>(
    () =>
      options.map((o) => ({
        ...o,
        haystack: normalise(`${o.label} ${o.sublabel ?? ""} ${o.keywords ?? ""}`),
      })),
    [options],
  );

  const selected = useMemo(
    () => indexed.find((o) => o.value === value) ?? null,
    [indexed, value],
  );

  // ── Filtering ──────────────────────────────────────────────────────────
  const { visible, truncated } = useMemo(() => {
    const terms = normalise(deferredQuery).split(" ").filter(Boolean);
    if (terms.length === 0) {
      return {
        visible: indexed.slice(0, MAX_RENDERED),
        truncated: Math.max(0, indexed.length - MAX_RENDERED),
      };
    }
    const hits: { o: IndexedOption; s: number }[] = [];
    for (const o of indexed) {
      const s = score(o.haystack, terms);
      if (s >= 0) hits.push({ o, s });
    }
    hits.sort((a, b) => a.s - b.s);
    return {
      visible: hits.slice(0, MAX_RENDERED).map((h) => h.o),
      truncated: Math.max(0, hits.length - MAX_RENDERED),
    };
  }, [indexed, deferredQuery]);

  // Group while preserving the filtered (relevance) order within each group.
  const groups = useMemo(() => {
    const map = new Map<string, IndexedOption[]>();
    for (const o of visible) {
      const g = o.group ?? "";
      const arr = map.get(g);
      if (arr) arr.push(o);
      else map.set(g, [o]);
    }
    const order = groupOrder ?? [];
    return [...map.entries()].sort(([a], [b]) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 1e6 : ia) - (ib === -1 ? 1e6 : ib);
      return a.localeCompare(b);
    });
  }, [visible, groupOrder]);

  /** Flat, render-ordered list — the source of truth for keyboard nav. */
  const flat = useMemo(() => groups.flatMap(([, items]) => items), [groups]);

  /**
   * The row the keyboard is on, resolved at render time: an explicit choice if
   * the user has moved, otherwise the current selection, otherwise the top
   * (best-scoring) match. Always clamped to the visible list.
   */
  const activeIndexResolved = useMemo(() => {
    if (flat.length === 0) return 0;
    if (activeIndex !== null) return Math.min(activeIndex, flat.length - 1);
    const selectedAt = flat.findIndex((o) => o.value === value);
    return selectedAt >= 0 ? selectedAt : 0;
  }, [activeIndex, flat, value]);

  // ── Positioning (portal) ───────────────────────────────────────────────
  interface FieldRect { top: number; left: number; width: number; flip: boolean }
  const [rect, setRect] = useState<FieldRect | null>(null);

  /** Viewport box of the trigger, flipping the list up when space is tight. */
  const measureField = useCallback((): FieldRect | null => {
    const b = buttonRef.current?.getBoundingClientRect();
    if (!b) return null;
    const below = window.innerHeight - b.bottom;
    const flip = below < 240 && b.top > below;
    return { top: flip ? b.top : b.bottom, left: b.left, width: b.width, flip };
  }, []);

  // ── Open / close ───────────────────────────────────────────────────────
  const openList = useCallback(() => {
    if (disabled) return;
    setQuery("");
    setActiveIndex(null);
    setRect(measureField());
    setOpen(true);
  }, [disabled, measureField]);

  const closeList = useCallback((refocus = true) => {
    setOpen(false);
    setQuery("");
    setActiveIndex(null);
    if (refocus) buttonRef.current?.focus();
  }, []);

  const onQueryChange = useCallback((next: string) => {
    setQuery(next);
    setActiveIndex(null); // re-point at the new best match
  }, []);

  const commit = useCallback(
    (option: IndexedOption | undefined) => {
      if (!option || option.disabled) return;
      onChange(option.value);
      closeList();
    },
    [onChange, closeList],
  );

  // Move focus into the search box when the list opens. Pure DOM sync — the
  // active row itself is derived, so nothing re-renders here.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Keep the active row scrolled into view.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${activeIndexResolved}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndexResolved, open]);

  // Close on outside pointer-down / Escape at the document level, so the
  // portalled list behaves like a native menu.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      setOpen(false);
      setQuery("");
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  // Track the field's viewport box so the portalled list can follow it while
  // the page scrolls or resizes. Measured up-front in `openList` (so the list
  // never paints in the wrong place) and refreshed from browser events.
  useEffect(() => {
    if (!open) return;
    const remeasure = () => setRect(measureField());
    window.addEventListener("resize", remeasure);
    window.addEventListener("scroll", remeasure, true);
    return () => {
      window.removeEventListener("resize", remeasure);
      window.removeEventListener("scroll", remeasure, true);
    };
  }, [open, measureField]);

  // ── Keyboard ───────────────────────────────────────────────────────────
  function onKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) return openList();
        setActiveIndex(flat.length ? (activeIndexResolved + 1) % flat.length : 0);
        return;
      case "ArrowUp":
        e.preventDefault();
        if (!open) return openList();
        setActiveIndex(flat.length ? (activeIndexResolved - 1 + flat.length) % flat.length : 0);
        return;
      case "Home":
        if (!open) return;
        e.preventDefault();
        setActiveIndex(0);
        return;
      case "End":
        if (!open) return;
        e.preventDefault();
        setActiveIndex(Math.max(0, flat.length - 1));
        return;
      case "Enter":
        if (!open) { e.preventDefault(); return openList(); }
        e.preventDefault();
        commit(flat[activeIndexResolved]);
        return;
      case "Escape":
        if (!open) return;
        e.preventDefault();
        e.stopPropagation();
        closeList();
        return;
      case "Tab":
        if (open) closeList(false);
        return;
      default:
        // Start searching straight from the closed trigger.
        if (!open && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          openList();
          onQueryChange(e.key);
          e.preventDefault();
        }
    }
  }

  let cursor = -1;

  const list = rect && (
    <div
      ref={popoverRef}
      className="fixed z-50"
      style={{
        top: rect.flip ? undefined : rect.top + 4,
        bottom: rect.flip ? window.innerHeight - rect.top + 4 : undefined,
        left: rect.left,
        width: rect.width,
      }}
    >
      <div className="card overflow-hidden shadow-lg">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 shrink-0 text-muted" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={flat[activeIndexResolved] ? `${listId}-opt-${activeIndexResolved}` : undefined}
            className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-muted"
            style={{ color: "var(--fg)" }}
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onKeyDown}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              className="text-muted hover:text-fg"
              onClick={() => { onQueryChange(""); inputRef.current?.focus(); }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={placeholder}
          className="max-h-64 overflow-y-auto overscroll-contain py-1"
        >
          {flat.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted">{emptyMessage}</p>
          ) : (
            groups.map(([group, items]) => (
              <div key={group || "_"} role="group" aria-label={group || undefined}>
                {group && (
                  <div className="sticky top-0 bg-surface px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                    {group}
                  </div>
                )}
                {items.map((o) => {
                  cursor += 1;
                  const idx = cursor;
                  return (
                    <Row
                      key={o.value}
                      id={`${listId}-opt-${idx}`}
                      idx={idx}
                      option={o}
                      active={idx === activeIndexResolved}
                      selected={o.value === value}
                      onHover={setActiveIndex}
                      onPick={commit}
                    />
                  );
                })}
              </div>
            ))
          )}
          {truncated > 0 && (
            <p className="px-3 py-2 text-center text-xs text-muted">
              {truncated} more — keep typing to narrow it down.
            </p>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className={cn("relative", className)}>
      <button
        ref={buttonRef}
        id={fieldId}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-haspopup="listbox"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => (open ? closeList() : openList())}
        onKeyDown={onKeyDown}
        className={cn(
          "input flex items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60",
          invalid && "border-red-500 focus:border-red-500 focus:ring-red-500/30",
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate", !selected && "text-muted")}>
          {selected ? (
            <>
              {selected.label}
              {selected.sublabel && <span className="text-muted"> · {selected.sublabel}</span>}
            </>
          ) : (
            placeholder
          )}
        </span>
        {clearable && selected && !disabled && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Clear selection"
            className="shrink-0 rounded p-0.5 text-muted hover:text-fg"
            onClick={(e) => { e.stopPropagation(); onChange(""); }}
          >
            <X className="h-3.5 w-3.5" />
          </span>
        )}
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted transition", open && "rotate-180")} />
      </button>

      {open && typeof document !== "undefined" && createPortal(list, document.body)}
    </div>
  );
}

// Memoised so re-rendering the list (e.g. on arrow-key movement) only touches
// the two rows whose `active` flag actually changed.
const Row = memo(function Row({
  id, idx, option, active, selected, onHover, onPick,
}: {
  id: string;
  idx: number;
  option: IndexedOption;
  active: boolean;
  selected: boolean;
  onHover: (i: number) => void;
  onPick: (o: IndexedOption) => void;
}) {
  return (
    <div
      id={id}
      data-idx={idx}
      role="option"
      aria-selected={selected}
      aria-disabled={option.disabled || undefined}
      onPointerMove={() => onHover(idx)}
      onClick={() => onPick(option)}
      className={cn(
        "flex cursor-pointer items-center gap-2 px-3 py-2 text-sm",
        active && "bg-brand/10",
        option.disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate">{option.label}</span>
        {option.sublabel && (
          <span className="block truncate text-xs text-muted">{option.sublabel}</span>
        )}
      </span>
      {option.tag && (
        <span className="badge shrink-0 bg-bg text-[10px] text-muted">{option.tag}</span>
      )}
      {selected && <Check className="h-4 w-4 shrink-0 text-brand" />}
    </div>
  );
});
