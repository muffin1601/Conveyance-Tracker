/**
 * The day's stops, drawn to scale.
 *
 * Deliberately NOT a tile map. A basemap would mean an API key or leaning on
 * OpenStreetMap's tile servers (against their usage policy at this volume), an
 * external request on every page load, and a blank grey box the moment the
 * employee is offline — which is exactly when they are out in the field. The
 * data that answers "does my day look right?" is already on the page: the
 * stops, their order, and how far apart they are.
 *
 * So this plots the real coordinates in a Web-Mercator projection, to scale,
 * with a scale bar for reference. It is a shape, not a street map, and it is
 * honest about that. It renders identically online and offline.
 */

import { haversineMeters } from "@/lib/gps";

export interface DayStop {
  /** 1-based trip number, matching the timeline list. */
  order: number;
  name: string;
  latitude: number;
  longitude: number;
}

const WIDTH = 640;
const HEIGHT = 260;
const PADDING = 28;

/**
 * Web Mercator y. Latitude is not linear in a map projection, and at Delhi's
 * latitude treating it as linear would visibly skew the shape north-south.
 */
function mercatorY(latitude: number): number {
  const rad = (latitude * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + rad / 2));
}

/** A rounded distance that makes a sensible scale bar (1, 2, 5, 10, 20 … km). */
function niceScaleKm(spanKm: number): number {
  const target = spanKm / 3; // a bar around a third of the width reads well
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(target, 0.01))));
  for (const step of [1, 2, 5, 10]) {
    if (target <= step * pow) return step * pow;
  }
  return 10 * pow;
}

export function DayMap({ stops, label }: { stops: DayStop[]; label: string }) {
  // One stop is a dot with no shape to read; nothing useful to draw.
  if (stops.length < 2) return null;

  const xs = stops.map((s) => s.longitude);
  const ys = stops.map((s) => mercatorY(s.latitude));
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);

  // A day spent in one building has no extent to scale to; guard the divide
  // and let the points sit in the middle rather than exploding to infinity.
  const spanX = maxX - minX || 1e-6;
  const spanY = maxY - minY || 1e-6;
  // One scale for both axes, so the drawing keeps the real aspect ratio — a
  // stretched map would misrepresent which legs were long.
  const scale = Math.min((WIDTH - PADDING * 2) / spanX, (HEIGHT - PADDING * 2) / spanY);
  const offsetX = (WIDTH - spanX * scale) / 2;
  const offsetY = (HEIGHT - spanY * scale) / 2;

  const project = (s: DayStop) => ({
    x: offsetX + (s.longitude - minX) * scale,
    // SVG y grows downwards; Mercator y grows north. Flip it.
    y: HEIGHT - (offsetY + (mercatorY(s.latitude) - minY) * scale),
  });

  const points = stops.map(project);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

  // Scale bar: how many pixels one kilometre occupies, measured on the real
  // geometry rather than assumed from the projection.
  const widthKm =
    haversineMeters({ lat: stops[0].latitude, lng: minX }, { lat: stops[0].latitude, lng: maxX }) / 1000;
  const barKm = niceScaleKm(widthKm || 1);
  const pxPerKm = widthKm > 0 ? (spanX * scale) / widthKm : 0;
  const barPx = Math.min(barKm * pxPerKm, WIDTH - PADDING * 2);

  return (
    <figure className="mt-3">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full rounded-md border bg-bg"
        role="img"
        aria-label={label}
      >
        <path d={path} fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth={2}
              strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={stops[i].order}>
            <circle cx={p.x} cy={p.y} r={11} className="fill-brand" />
            <text x={p.x} y={p.y + 4} textAnchor="middle" className="fill-white" fontSize={11} fontWeight={600}>
              {stops[i].order}
            </text>
            <title>{`${stops[i].order}. ${stops[i].name}`}</title>
          </g>
        ))}
        {barPx > 20 && (
          <g transform={`translate(${PADDING} ${HEIGHT - 12})`} className="text-muted">
            <line x1={0} y1={0} x2={barPx} y2={0} stroke="currentColor" strokeWidth={1.5} />
            <line x1={0} y1={-4} x2={0} y2={4} stroke="currentColor" strokeWidth={1.5} />
            <line x1={barPx} y1={-4} x2={barPx} y2={4} stroke="currentColor" strokeWidth={1.5} />
            <text x={barPx / 2} y={-6} textAnchor="middle" fontSize={10} fill="currentColor">
              {barKm < 1 ? `${Math.round(barKm * 1000)} m` : `${barKm} km`}
            </text>
          </g>
        )}
      </svg>
    </figure>
  );
}
