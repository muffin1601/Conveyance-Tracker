/**
 * Builds the shot-by-shot timeline from the aligned narration.
 *
 * Every section of the script gets a "director" that turns its sentence
 * timings into scenes: which capture is on screen, where the camera is, and
 * which taps / highlights / callouts fire. Because each beat is anchored to a
 * sentence's real start time, an action can never run ahead of the narration.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BUILD = join(process.cwd(), "video", "build");

interface Box { x: number; y: number; width: number; height: number }
interface Shot { name: string; file: string; boxes: Record<string, Box>; scrollY: number; note?: string }
interface Sentence { text: string; start: number; end: number }
interface Section { id: string; chapter: string; kicker: string; start: number; end: number; sentences: Sentence[] }

const shotList: Shot[] = JSON.parse(readFileSync(join(BUILD, "shots.json"), "utf8")).shots;
const SHOTS: Record<string, Shot> = Object.fromEntries(shotList.map((s) => [s.name, s]));
const { audioSec, sections } = JSON.parse(readFileSync(join(BUILD, "alignment.json"), "utf8")) as
  { audioSec: number; sections: Section[] };

const ms = (s: number) => Math.round(s * 1000);
const has = (n: string) => Boolean(SHOTS[n]);
/** All captures in a numbered sequence, e.g. "name-type" → name-type-01.. */
const seq = (prefix: string) =>
  shotList.filter((s) => s.name.startsWith(prefix + "-") && /-\d+$/.test(s.name)).map((s) => s.name);

interface Effect { type: string; [k: string]: unknown }
interface Scene {
  id: string;
  start: number; end: number;
  shot?: string;
  frames?: { at: number; shot: string }[];
  frameFade?: number;
  camera?: { at: number; zoom?: number; focus?: string; cx?: number; cy?: number; ease?: string }[];
  effects?: Effect[];
}

const scenes: Scene[] = [];

/** Spread a list of captures evenly across a window (typing, scrolling). */
function framesAcross(names: string[], fromMs: number, toMs: number) {
  if (!names.length) return [];
  const step = (toMs - fromMs) / names.length;
  return names.map((shot, i) => ({ at: Math.round(fromMs + i * step), shot }));
}

/** Sentence n of a section, clamped so directors can't run off the end. */
function sent(sec: Section, i: number): Sentence {
  return sec.sentences[Math.min(i, sec.sentences.length - 1)];
}

/** A tap effect: pointer flies in, presses, ripples — all relative to scene start. */
function tap(target: string, atMs: number, opts: { from?: string; hold?: number } = {}): Effect {
  return {
    type: "tap", target, from: opts.from,
    in: Math.max(0, atMs - 900), tap: atMs, out: atMs + (opts.hold ?? 700),
  };
}

const highlight = (target: string, a: number, b: number, pad = 8): Effect =>
  ({ type: "highlight", target, in: a, out: b, pad });
const spotlight = (target: string, a: number, b: number, pad = 10): Effect =>
  ({ type: "spotlight", target, in: a, out: b, pad });
const callout = (text: string, sub: string | undefined, a: number, b: number, at: "top" | "bottom" = "bottom"): Effect =>
  ({ type: "callout", text, sub, in: a, out: b, at });
const arrow = (target: string, a: number, b: number, side: "left" | "right" = "left"): Effect =>
  ({ type: "arrow", target, in: a, out: b, side });

/**
 * The captures are exactly the screen's aspect ratio, so ANY zoom above 1.0
 * crops horizontally — and because the app's own side padding is only ~16px,
 * even a 10% punch-in starts slicing characters off the start of every line.
 * The brief calls for no clipping, and an employee has to be able to read the
 * field labels, so the app is always shown whole.
 *
 * Emphasis is carried entirely by the annotation layer instead — the highlight
 * ring, the blur spotlight, arrows and callouts — which is how a full-bleed
 * mobile screen is normally handled in a product demo. Movement comes from the
 * captured scroll sequences and from the annotations animating in and out.
 */
const settleZoom = () => 1;

/** Push a scene using absolute audio times; effect times are made relative. */
function scene(s: Omit<Scene, "start" | "end"> & { start: number; end: number }) {
  const rel = (v: unknown) => (typeof v === "number" ? Math.round(v - s.start) : v);
  const effects = (s.effects ?? []).map((e) => {
    const o: Effect = { ...e };
    for (const k of ["in", "out", "tap", "mid"]) if (k in o) o[k] = rel(o[k]);
    return o;
  });
  const camera = (s.camera ?? []).map((k) => ({
    ...k,
    at: Math.round(k.at - s.start),
    zoom: settleZoom(),
  }));
  const frames = (s.frames ?? []).map((f) => ({ ...f, at: Math.round(f.at - s.start) }));
  scenes.push({ ...s, effects, camera, frames });
}

// ─────────────────────────────────────────────────────────────────
// Directors
// ─────────────────────────────────────────────────────────────────

type Director = (sec: Section) => void;

const directors: Record<string, Director> = {
  /** Title card over the home screen, pulling back to reveal the app. */
  intro(sec) {
    const a = ms(sec.start), b = ms(sec.end);
    const s2 = ms(sent(sec, 2).start);
    scene({
      id: sec.id, start: a, end: b, shot: "open-home",
      camera: [
        { at: a, zoom: 1.35, focus: "card" },
        { at: s2, zoom: 1.0, cx: 195, cy: 300, ease: "inOut" },
        { at: b, zoom: 1.02, cx: 195, cy: 330 },
      ],
      effects: [
        { type: "chapter", kicker: sec.kicker, text: sec.chapter, in: a + 200, out: s2 - 200 },
        callout("हर visit, दो मिनट में", "distance और पैसा — दोनों अपने आप", ms(sent(sec, 2).start) + 200, ms(sent(sec, 4).end)),
        callout("चलिए शुरू करते हैं", undefined, ms(sent(sec, 5).start), b - 250),
      ],
    });
  },

  /** The three tabs, highlighted one at a time as they are named. */
  open(sec) {
    const a = ms(sec.start), b = ms(sec.end);
    const tabsAt = ms(sent(sec, 4).start);
    const focusAt = ms(sent(sec, 5).start);
    scene({
      id: sec.id, start: a, end: b, shot: "open-home",
      camera: [
        { at: a, zoom: 1.0, cx: 195, cy: 300 },
        { at: tabsAt, zoom: 1.75, focus: "nav" },
        { at: ms(sent(sec, 6).start), zoom: 1.15, cx: 195, cy: 300 },
        { at: b, zoom: 1.05, cx: 195, cy: 320 },
      ],
      effects: [
        { type: "chapter", kicker: sec.kicker, text: sec.chapter, in: a + 100, out: a + 2600 },
        callout("App खोलिए", "इसे home screen पर save कर लीजिए", ms(sent(sec, 3).start), tabsAt - 250),
        highlight("tabCheckIn", tabsAt + 200, tabsAt + 2400, 6),
        highlight("tabAdmin", tabsAt + 2500, tabsAt + 3900, 6),
        highlight("tabSettings", tabsAt + 4000, focusAt - 200, 6),
        spotlight("tabCheckIn", focusAt, ms(sent(sec, 6).start) - 200, 6),
        callout("Check In", "यही आपका main page है", focusAt + 150, ms(sent(sec, 6).start) - 250, "top"),
      ],
    });
  },

  /** Tap the name field, watch the list filter as it is typed, pick the match. */
  name(sec) {
    const a = ms(sec.start), b = ms(sec.end);
    const tapAt = ms(sent(sec, 1).start) + 900;
    const listAt = ms(sent(sec, 2).start);
    const typeFrom = ms(sent(sec, 3).start);
    const typeTo = ms(sent(sec, 3).end);
    const pickAt = ms(sent(sec, 4).start);

    scene({
      id: sec.id + "-a", start: a, end: pickAt, shot: "open-home",
      frames: [
        { at: a, shot: "open-home" },
        { at: tapAt + 260, shot: "name-open" },
        ...framesAcross(seq("name-type"), typeFrom, typeTo),
        { at: typeTo, shot: "name-match" },
      ],
      frameFade: 90,
      camera: [
        { at: a, zoom: 1.15, cx: 195, cy: 330 },
        { at: tapAt - 400, zoom: 1.55, focus: "open-home.emp" },
        { at: listAt, zoom: 1.12, cx: 195, cy: 420 },
        { at: typeFrom, zoom: 1.3, cx: 195, cy: 330 },
        { at: pickAt, zoom: 1.3, cx: 195, cy: 330 },
      ],
      effects: [
        { type: "chapter", kicker: sec.kicker, text: sec.chapter, in: a + 100, out: a + 2500 },
        highlight("open-home.emp", ms(sent(sec, 1).start), tapAt + 200, 7),
        tap("open-home.emp", tapAt),
        callout("Your Name", "अपने नाम पर tap कीजिए", ms(sent(sec, 1).start) + 300, tapAt - 100),
        callout("सारे staff के नाम", "typing से तुरंत filter होता है", listAt + 200, typeFrom - 200),
      ],
    });

    scene({
      id: sec.id + "-b", start: pickAt, end: b,
      frames: [
        { at: pickAt, shot: "name-match" },
        { at: pickAt + 900, shot: "name-chosen" },
      ],
      frameFade: 120,
      shot: "name-chosen",
      camera: [
        { at: pickAt, zoom: 1.3, cx: 195, cy: 330 },
        { at: pickAt + 1400, zoom: 1.45, focus: "name-chosen.emp" },
        { at: b, zoom: 1.15, cx: 195, cy: 380 },
      ],
      effects: [
        tap("name-match.option", pickAt + 420),
        highlight("name-chosen.emp", pickAt + 1100, ms(sent(sec, 5).start), 7),
        callout("नाम select हो गया", undefined, pickAt + 1200, ms(sent(sec, 5).start) - 200),
        callout("हमेशा अपना ही नाम", "किसी और का नहीं", ms(sent(sec, 5).start) + 200, b - 300),
      ],
    });
  },

  /** Destination picker, plus the point that trip 1 always starts at the office. */
  location(sec) {
    const a = ms(sec.start), b = ms(sec.end);
    const tapAt = ms(sent(sec, 1).start) + 700;
    const typeFrom = ms(sent(sec, 3).start);
    const typeTo = ms(sent(sec, 3).end) - 300;
    const officeAt = ms(sent(sec, 4).start);

    scene({
      id: sec.id + "-a", start: a, end: officeAt,
      frames: [
        { at: a, shot: "loc-trip1" },
        { at: tapAt + 260, shot: "loc-open" },
        ...framesAcross(seq("loc-type"), typeFrom, typeTo),
        { at: typeTo, shot: "loc-picked" },
      ],
      frameFade: 90,
      shot: "loc-trip1",
      camera: [
        { at: a, zoom: 1.2, focus: "loc-trip1.dest" },
        { at: tapAt, zoom: 1.4, focus: "loc-trip1.dest" },
        { at: ms(sent(sec, 2).start), zoom: 1.1, cx: 195, cy: 430 },
        { at: typeFrom, zoom: 1.25, cx: 195, cy: 360 },
        { at: officeAt, zoom: 1.2, cx: 195, cy: 400 },
      ],
      effects: [
        { type: "chapter", kicker: sec.kicker, text: sec.chapter, in: a + 100, out: a + 2400 },
        highlight("loc-trip1.dest", ms(sent(sec, 1).start), tapAt + 200, 7),
        tap("loc-trip1.dest", tapAt),
        callout("Where Are You Going", "site का नाम या शहर लिखिए", ms(sent(sec, 1).start) + 250, tapAt - 100),
        callout("सारी sites की list", "client और शहर के साथ", ms(sent(sec, 2).start) + 200, typeFrom - 200),
      ],
    });

    scene({
      id: sec.id + "-b", start: officeAt, end: b, shot: "loc-picked",
      camera: [
        { at: officeAt, zoom: 1.2, cx: 195, cy: 400 },
        { at: officeAt + 900, zoom: 1.6, focus: "loc-trip1.startPoint" },
        { at: b, zoom: 1.35, cx: 195, cy: 420 },
      ],
      effects: [
        spotlight("loc-trip1.startPoint", officeAt + 700, ms(sent(sec, 5).start), 12),
        arrow("loc-trip1.startPoint", officeAt + 900, ms(sent(sec, 5).start), "left"),
        callout("पहली trip = Head Office से", "आपको कुछ भरना नहीं है", officeAt + 800, b - 300, "top"),
      ],
    });
  },

  /** GPS fallback when the site is not in the master list. */
  gps(sec) {
    const a = ms(sec.start), b = ms(sec.end);
    const tapAt = ms(sent(sec, 3).start) + 500;
    const detectedAt = ms(sent(sec, 5).start);
    scene({
      id: sec.id, start: a, end: b,
      frames: [
        { at: a, shot: "loc-picked" },
        { at: tapAt + 300, shot: "gps-panel" },
        { at: detectedAt, shot: "gps-detected" },
      ],
      frameFade: 140,
      shot: "gps-detected",
      camera: [
        { at: a, zoom: 1.15, cx: 195, cy: 420 },
        { at: tapAt - 300, zoom: 1.5, focus: "gps-panel.gpsBtn" },
        { at: detectedAt, zoom: 1.25, focus: "gps-detected.detected" },
        { at: b, zoom: 1.15, cx: 195, cy: 480 },
      ],
      effects: [
        { type: "chapter", kicker: sec.kicker, text: sec.chapter, in: a + 100, out: a + 2500 },
        callout("Site list में नहीं है?", "घबराइए मत — GPS use कीजिए", ms(sent(sec, 1).start), tapAt - 200),
        highlight("gps-panel.gpsBtn", ms(sent(sec, 3).start), tapAt + 250, 7),
        tap("gps-panel.gpsBtn", tapAt),
        callout("Location को Allow कीजिए", undefined, ms(sent(sec, 4).start), detectedAt - 200),
        highlight("gps-detected.detected", detectedAt + 200, ms(sent(sec, 6).start), 8),
        callout("App ने जगह पकड़ ली", "यहीं से distance गिना जाएगा", detectedAt + 300, ms(sent(sec, 6).start) - 200),
        callout("Site पर पहुँच कर ही GPS", "तभी location सही record होगी", ms(sent(sec, 6).start) + 150, b - 300),
      ],
    });
  },

  /** The three travel modes and their rates. */
  transport(sec) {
    const a = ms(sec.start), b = ms(sec.end);
    const scrollFrames = seq("trans-scroll");
    const showAt = ms(sent(sec, 1).start);
    const bikeAt = ms(sent(sec, 2).start);
    const carAt = ms(sent(sec, 3).start);
    const busAt = ms(sent(sec, 4).start);
    const pickAt = ms(sent(sec, 5).start) + 500;

    scene({
      id: sec.id, start: a, end: b,
      frames: [
        { at: a, shot: "loc-picked" },
        ...framesAcross(scrollFrames, a + 900, showAt),
        { at: showAt, shot: "trans-bike" },
        { at: carAt + 400, shot: "trans-car" },
        { at: busAt + 400, shot: "trans-bus" },
        { at: pickAt + 300, shot: "trans-back-bike" },
      ],
      frameFade: 110,
      shot: "trans-bike",
      camera: [
        { at: a, zoom: 1.15, cx: 195, cy: 420 },
        { at: showAt, zoom: 1.5, focus: "trans-bike.modes" },
        { at: bikeAt, zoom: 1.55, focus: "trans-bike.bike" },
        { at: carAt, zoom: 1.55, focus: "trans-bike.car" },
        { at: busAt, zoom: 1.55, focus: "trans-bike.bus" },
        { at: pickAt, zoom: 1.35, focus: "trans-bike.modes" },
        { at: b, zoom: 1.2, cx: 195, cy: 520 },
      ],
      effects: [
        { type: "chapter", kicker: sec.kicker, text: sec.chapter, in: a + 100, out: a + 2300 },
        highlight("trans-bike.bike", bikeAt, carAt - 200, 7),
        callout("Bike — ₹4 / km", undefined, bikeAt + 150, carAt - 250, "top"),
        highlight("trans-bike.car", carAt, busAt - 200, 7),
        callout("Car — ₹11 / km", undefined, carAt + 150, busAt - 250, "top"),
        highlight("trans-bike.bus", busAt, pickAt - 200, 7),
        callout("Bus / Metro — ₹3 / km", "या actual ticket", busAt + 150, pickAt - 250, "top"),
        tap("trans-bike.bike", pickAt),
      ],
    });
  },

  /** Log the visit and show the confirmation. */
  log(sec) {
    const a = ms(sec.start), b = ms(sec.end);
    const tapAt = ms(sent(sec, 0).start) + 1500;
    const doneAt = ms(sent(sec, 1).start);
    scene({
      id: sec.id, start: a, end: b,
      frames: [
        { at: a, shot: "log-ready" },
        { at: doneAt, shot: "log-done" },
      ],
      frameFade: 160,
      shot: "log-done",
      camera: [
        { at: a, zoom: 1.2, cx: 195, cy: 560 },
        { at: tapAt - 500, zoom: 1.6, focus: "log-ready.logBtn" },
        { at: doneAt, zoom: 1.35, focus: "log-done.msg" },
        { at: b, zoom: 1.15, cx: 195, cy: 400 },
      ],
      effects: [
        { type: "chapter", kicker: sec.kicker, text: sec.chapter, in: a + 100, out: a + 2200 },
        highlight("log-ready.logBtn", ms(sent(sec, 0).start) + 400, tapAt + 250, 7),
        tap("log-ready.logBtn", tapAt),
        highlight("log-done.msg", doneAt + 250, ms(sent(sec, 2).start), 8),
        callout("Visit record हो गई!", undefined, doneAt + 300, ms(sent(sec, 2).start) - 200),
        callout("Distance और पैसा — अपने आप", "आपको कुछ जोड़ना घटाना नहीं है", ms(sent(sec, 2).start) + 150, b - 300),
      ],
    });
  },

  /** The heart of the tutorial: each trip starts where the last one ended. */
  chain(sec) {
    const a = ms(sec.start), b = ms(sec.end);
    const t2At = ms(sent(sec, 3).start);
    const abAt = ms(sent(sec, 4).start);
    const stepsAt = ms(sent(sec, 7).start);
    const bcAt = ms(sent(sec, 8).start);
    const cdAt = ms(sent(sec, 9).start);
    const anyAt = ms(sent(sec, 11).start);
    const timeline = seq("chain-timeline");

    scene({
      id: sec.id + "-a", start: a, end: bcAt,
      frames: [
        { at: a, shot: "log-done" },
        { at: t2At, shot: "chain-trip2" },
        { at: stepsAt, shot: "chain-trip2-est" },
      ],
      frameFade: 150,
      shot: "chain-trip2",
      camera: [
        { at: a, zoom: 1.1, cx: 195, cy: 400 },
        { at: t2At, zoom: 1.45, focus: "chain-trip2.startPoint" },
        { at: stepsAt, zoom: 1.2, cx: 195, cy: 430 },
        { at: bcAt, zoom: 1.4, focus: "chain-trip2.startPoint" },
      ],
      effects: [
        { type: "chapter", kicker: sec.kicker, text: sec.chapter, in: a + 150, out: a + 3200 },
        callout("दिन भर में कई sites", "हर बार वही चार steps", ms(sent(sec, 1).start), t2At - 300),
        spotlight("chain-trip2.startPoint", t2At + 200, abAt + 2600, 12),
        callout("Trip 1 — Head Office से पहली site", "A → B", abAt, abAt + 2600, "top"),
        callout("नाम → site → transport → Log", "बस यही चार steps", stepsAt + 150, bcAt - 250),
      ],
    });

    scene({
      id: sec.id + "-b", start: bcAt, end: cdAt,
      frames: [
        { at: bcAt, shot: "chain-trip3" },
        { at: bcAt + 2600, shot: "chain-trip3-est" },
      ],
      frameFade: 150,
      shot: "chain-trip3",
      camera: [
        { at: bcAt, zoom: 1.45, focus: "chain-trip3.startPoint" },
        { at: bcAt + 2600, zoom: 1.2, cx: 195, cy: 430 },
        { at: cdAt, zoom: 1.3, cx: 195, cy: 400 },
      ],
      effects: [
        spotlight("chain-trip3.startPoint", bcAt + 150, bcAt + 3000, 12),
        arrow("chain-trip3.startPoint", bcAt + 400, bcAt + 3000, "left"),
        callout("Trip 2 — पिछली site से आगे", "B → C, अपने आप", bcAt + 250, bcAt + 3000, "top"),
      ],
    });

    scene({
      id: sec.id + "-c", start: cdAt, end: b,
      frames: [
        { at: cdAt, shot: "chain-trip4" },
        ...framesAcross(timeline, anyAt, anyAt + 3200),
        { at: anyAt + 3200, shot: "chain-timeline-end" },
      ],
      frameFade: 110,
      shot: "chain-timeline-end",
      camera: [
        { at: cdAt, zoom: 1.4, focus: "chain-trip4.startPoint" },
        { at: anyAt, zoom: 1.12, cx: 195, cy: 430 },
        { at: anyAt + 3400, zoom: 1.25, focus: "chain-timeline-end.recentTrips" },
        { at: b, zoom: 1.15, cx: 195, cy: 430 },
      ],
      effects: [
        callout("Trip 3 — C → D", "फिर वही चार steps", cdAt + 200, anyAt - 300, "top"),
        callout("चार sites हों या दस", "हिसाब अपने आप जुड़ता जाएगा", anyAt + 200, ms(sent(sec, 12).start) - 200),
        callout("Head Office वापस जाने की ज़रूरत नहीं", "kilometer याद रखने की भी नहीं",
          ms(sent(sec, 12).start) + 150, b - 300),
      ],
    });
  },

  /** Reset the chain back to the head office. */
  reset(sec) {
    const a = ms(sec.start), b = ms(sec.end);
    const tapAt = ms(sent(sec, 1).start) + 3200;
    const afterAt = ms(sent(sec, 2).start);
    scene({
      id: sec.id, start: a, end: b,
      frames: [
        { at: a, shot: "reset-before" },
        { at: afterAt, shot: "reset-after" },
      ],
      frameFade: 180,
      shot: "reset-after",
      camera: [
        { at: a, zoom: 1.2, cx: 195, cy: 400 },
        { at: tapAt - 700, zoom: 1.6, focus: "reset-before.reset" },
        { at: afterAt, zoom: 1.45, focus: "reset-after.startPoint" },
        { at: ms(sent(sec, 3).start), zoom: 1.15, cx: 195, cy: 400 },
        { at: b, zoom: 1.1, cx: 195, cy: 400 },
      ],
      effects: [
        { type: "chapter", kicker: sec.kicker, text: sec.chapter, in: a + 100, out: a + 2600 },
        highlight("reset-before.reset", ms(sent(sec, 1).start) + 1200, tapAt + 250, 7),
        callout("Reset Journey", "अगली visit फिर Head Office से", ms(sent(sec, 1).start) + 1400, tapAt - 150),
        tap("reset-before.reset", tapAt),
        spotlight("reset-after.startPoint", afterAt + 250, ms(sent(sec, 3).start) - 200, 12),
        callout("फिर से Head Office से शुरू", undefined, afterAt + 350, ms(sent(sec, 3).start) - 250, "top"),
        callout("सोच समझ कर reset कीजिए", "बिना वजह नहीं — हिसाब गड़बड़ हो सकता है",
          ms(sent(sec, 4).start), b - 300),
      ],
    });
  },

  /** Scroll through today's summary to the totals. */
  summary(sec) {
    const a = ms(sec.start), b = ms(sec.end);
    const scrollA = seq("sum-scroll");
    const scrollB = seq("sum-totals");
    const listAt = ms(sent(sec, 1).start);
    const breakdownAt = ms(sent(sec, 2).start);
    const totalAt = ms(sent(sec, 3).start);
    const grandAt = ms(sent(sec, 4).start);
    scene({
      id: sec.id, start: a, end: b,
      frames: [
        { at: a, shot: "reset-after" },
        ...framesAcross(scrollA, a + 600, listAt),
        { at: listAt, shot: "sum-list" },
        ...framesAcross(scrollB, totalAt, grandAt - 400),
        { at: grandAt - 400, shot: "sum-grand" },
      ],
      frameFade: 100,
      shot: "sum-grand",
      camera: [
        { at: a, zoom: 1.1, cx: 195, cy: 420 },
        { at: listAt, zoom: 1.05, cx: 195, cy: 420 },
        { at: breakdownAt, zoom: 1.3, cx: 195, cy: 380 },
        { at: totalAt, zoom: 1.15, cx: 195, cy: 480 },
        { at: grandAt, zoom: 1.45, focus: "sum-grand.grand" },
        { at: b, zoom: 1.3, cx: 195, cy: 520 },
      ],
      effects: [
        { type: "chapter", kicker: sec.kicker, text: sec.chapter, in: a + 100, out: a + 2400 },
        callout("Today's Summary", "आज का पूरा दिन एक जगह", listAt + 150, breakdownAt - 250, "top"),
        callout("हर trip — km, transport, पैसा", "line by line", breakdownAt + 200, totalAt - 250),
        highlight("sum-list.totalConv", totalAt + 200, grandAt - 300, 7),
        callout("Total Conveyance", "दिन भर की सारी trips का जोड़", totalAt + 300, grandAt - 350, "top"),
        highlight("sum-grand.grand", grandAt + 200, b - 400, 7),
        callout("Grand Total", "conveyance + बाकी खर्चे", grandAt + 300, b - 300, "top"),
      ],
    });
  },

  /** Attaching a bill to a logged trip. */
  bill(sec) {
    const a = ms(sec.start), b = ms(sec.end);
    const billAt = ms(sent(sec, 0).start) + 4200;
    scene({
      id: sec.id, start: a, end: b, shot: "bill-control",
      camera: [
        { at: a, zoom: 1.2, cx: 195, cy: 430 },
        { at: billAt - 800, zoom: 1.75, focus: "bill-control.addBill" },
        { at: b, zoom: 1.3, cx: 195, cy: 430 },
      ],
      effects: [
        { type: "chapter", kicker: sec.kicker, text: sec.chapter, in: a + 100, out: a + 2200 },
        highlight("bill-control.addBill", billAt - 900, billAt + 400, 7),
        arrow("bill-control.addBill", billAt - 700, billAt + 400, "left"),
        tap("bill-control.addBill", billAt),
        callout("Add bill", "ticket की photo upload कीजिए", billAt - 600, ms(sent(sec, 1).start) - 200, "top"),
        callout("Record पक्का, payment में दिक्कत नहीं", undefined, ms(sent(sec, 1).start) + 150, b - 300),
      ],
    });
  },

  /** Non-conveyance expenses: parking, toll, food. */
  misc(sec) {
    const a = ms(sec.start), b = ms(sec.end);
    const scrollF = seq("misc-scroll");
    const cardAt = ms(sent(sec, 1).start);
    const nameAt = ms(sent(sec, 2).start);
    const formAt = nameAt + 2200;
    scene({
      id: sec.id, start: a, end: b,
      frames: [
        { at: a, shot: "sum-grand" },
        ...framesAcross(scrollF, a + 500, cardAt),
        { at: cardAt, shot: "misc-card" },
        { at: nameAt, shot: "misc-emp-chosen" },
        { at: formAt, shot: "misc-form" },
        { at: formAt + 2200, shot: "misc-filled" },
      ],
      frameFade: 120,
      shot: "misc-filled",
      camera: [
        { at: a, zoom: 1.15, cx: 195, cy: 430 },
        { at: cardAt, zoom: 1.25, focus: "misc-card.title" },
        { at: nameAt, zoom: 1.45, focus: "misc-card.miscEmp" },
        { at: formAt, zoom: 1.1, cx: 195, cy: 430 },
        { at: b, zoom: 1.2, cx: 195, cy: 430 },
      ],
      effects: [
        { type: "chapter", kicker: sec.kicker, text: sec.chapter, in: a + 100, out: a + 2400 },
        callout("Parking, Toll, खाना", "आने-जाने के अलावा के खर्चे", ms(sent(sec, 1).start) + 200, nameAt - 250, "top"),
        highlight("misc-card.miscEmp", nameAt + 150, formAt - 300, 7),
        callout("यहाँ भी पहले नाम चुनिए", "फिर खर्चा भर दीजिए", nameAt + 250, formAt - 350),
        callout("Conveyance से अलग", "पर summary और report में जुड़ जाता है",
          ms(sent(sec, 3).start) + 150, b - 300),
      ],
    });
  },

  /** Recap — the four steps, then the closing card. */
  ending(sec) {
    const a = ms(sec.start), b = ms(sec.end);
    const stepsAt = ms(sent(sec, 1).start);
    const gpsAt = ms(sent(sec, 2).start);
    const resetAt = ms(sent(sec, 3).start);
    const billAt = ms(sent(sec, 4).start);
    const miscAt = ms(sent(sec, 5).start);
    const timeAt = ms(sent(sec, 6).start);
    const thanksAt = ms(sent(sec, 8).start);
    scene({
      id: sec.id, start: a, end: b, shot: "end-home",
      camera: [
        { at: a, zoom: 1.15, cx: 195, cy: 380 },
        { at: stepsAt, zoom: 1.35, focus: "end-home.emp" },
        { at: gpsAt, zoom: 1.2, cx: 195, cy: 430 },
        { at: timeAt, zoom: 1.05, cx: 195, cy: 340 },
        { at: b, zoom: 1.0, cx: 195, cy: 330 },
      ],
      effects: [
        { type: "chapter", kicker: sec.kicker, text: sec.chapter, in: a + 100, out: stepsAt - 300 },
        callout("१. नाम   २. Location", "३. Transport   ४. Log This Visit", stepsAt + 150, gpsAt - 250),
        callout("Site list में न हो → GPS", undefined, gpsAt + 100, resetAt - 200),
        callout("नई trip → Reset Journey", undefined, resetAt + 100, billAt - 200),
        callout("Bill हो → photo upload", undefined, billAt + 100, miscAt - 200),
        callout("Parking, Toll, खाना → Miscellaneous", undefined, miscAt + 100, timeAt - 200),
        callout("Visit के time ही entry कीजिए", "बाद के लिए मत छोड़िए", timeAt + 150, thanksAt - 300),
        { type: "chapter", kicker: "धन्यवाद", text: "Watcon Conveyance Tracker", in: thanksAt, out: b },
      ],
    });
  },
};

// ─────────────────────────────────────────────────────────────────

function main() {
  const missing: string[] = [];
  for (const sec of sections) {
    const d = directors[sec.id];
    if (!d) { missing.push(sec.id); continue; }
    d(sec);
  }
  if (missing.length) throw new Error(`No director for: ${missing.join(", ")}`);

  scenes.sort((a, b) => a.start - b.start);

  // Validate that every shot a scene references was actually captured.
  const bad = new Set<string>();
  for (const s of scenes) {
    for (const n of [s.shot, ...(s.frames ?? []).map((f) => f.shot)]) {
      if (n && !has(n)) bad.add(n);
    }
  }
  if (bad.size) throw new Error(`Timeline references uncaptured shots: ${[...bad].join(", ")}`);

  // Close any gap between consecutive scenes so a frame is never blank.
  for (let i = 0; i < scenes.length - 1; i++) scenes[i].end = scenes[i + 1].start;
  scenes[scenes.length - 1].end = Math.round(audioSec * 1000);

  const subtitles = sections.flatMap((s) =>
    s.sentences.map((c) => ({ start: ms(c.start), end: ms(c.end), text: c.text })));

  const timeline = {
    durationMs: Math.round(audioSec * 1000),
    fps: 60,
    width: 1080,
    height: 1920,
    burnSubtitles: process.env.TUT_BURN_SUBS === "1",
    subtitles,
    scenes,
  };
  writeFileSync(join(BUILD, "timeline.json"), JSON.stringify(timeline, null, 2));

  console.log(`✔ ${scenes.length} scenes over ${(audioSec).toFixed(1)}s`);
  for (const s of scenes) {
    const fx = (s.effects ?? []).length, fr = (s.frames ?? []).length;
    console.log(`  ${(s.start / 1000).toFixed(1).padStart(6)}s → ${(s.end / 1000).toFixed(1).padStart(6)}s  ` +
                `${s.id.padEnd(12)} ${String(fr).padStart(3)} frames, ${String(fx).padStart(2)} effects`);
  }
}

main();
