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
  /** Title card, then the real Check In page. */
  intro(sec) {
    const a = ms(sec.start), b = ms(sec.end);
    const s1 = ms(sent(sec, 1).start);
    const s2 = ms(sent(sec, 2).start);
    scene({
      id: sec.id, start: a, end: b, shot: "open-home",
      effects: [
        { type: "chapter", kicker: sec.kicker, text: sec.chapter, in: a + 150, out: s1 - 250 },
        callout("हर visit — बस दो मिनट", "distance और पैसा, दोनों अपने आप", s1 + 150, s2 - 250),
        callout("चलिए शुरू करते हैं", undefined, s2 + 100, b - 250),
      ],
    });
  },

  /** Tap Your Name, filter the list by typing, pick the employee. */
  name(sec) {
    const a = ms(sec.start), b = ms(sec.end);
    const tapAt = ms(sent(sec, 1).start) + 1100;
    const typeFrom = tapAt + 900;
    const warnAt = ms(sent(sec, 2).start);
    const typeTo = warnAt - 1400;
    const pickAt = warnAt - 700;

    scene({
      id: sec.id, start: a, end: b,
      frames: [
        { at: a, shot: "open-home" },
        { at: tapAt + 280, shot: "name-open" },
        ...framesAcross(seq("name-type"), typeFrom, typeTo),
        { at: typeTo, shot: "name-match" },
        { at: pickAt + 450, shot: "name-chosen" },
      ],
      frameFade: 90,
      shot: "name-chosen",
      effects: [
        { type: "chapter", kicker: sec.kicker, text: sec.chapter, in: a + 100, out: a + 2200 },
        highlight("open-home.emp", ms(sent(sec, 1).start) + 200, tapAt + 250, 7),
        tap("open-home.emp", tapAt),
        callout("Your Name", "यहाँ tap कीजिए", ms(sent(sec, 1).start) + 350, tapAt - 150),
        callout("नाम लिखते ही list छँट जाती है", undefined, typeFrom + 300, pickAt - 200),
        tap("name-match.option", pickAt),
        callout("हमेशा अपना ही नाम", "किसी और का नहीं", warnAt + 150, b - 250),
      ],
    });
  },

  /** Destination picker, then the point that trip 1 begins at the office. */
  location(sec) {
    const a = ms(sec.start), b = ms(sec.end);
    const tapAt = a + 1600;
    const typeFrom = tapAt + 900;
    const officeAt = ms(sent(sec, 1).start);
    const typeTo = officeAt - 3000;
    const pickAt = officeAt - 2200;

    scene({
      id: sec.id + "-a", start: a, end: officeAt,
      frames: [
        { at: a, shot: "loc-trip1" },
        { at: tapAt + 280, shot: "loc-open" },
        ...framesAcross(seq("loc-type"), typeFrom, typeTo),
        { at: typeTo, shot: "loc-open" },
        { at: pickAt + 450, shot: "loc-picked" },
      ],
      frameFade: 90,
      shot: "loc-picked",
      effects: [
        { type: "chapter", kicker: sec.kicker, text: sec.chapter, in: a + 100, out: a + 2000 },
        highlight("loc-trip1.dest", a + 700, tapAt + 250, 7),
        tap("loc-trip1.dest", tapAt),
        callout("Where Are You Going", "site का नाम या शहर लिखिए", a + 850, tapAt - 150),
        callout("अपनी site चुन लीजिए", undefined, typeFrom + 300, pickAt - 200),
        tap("loc-open.option", pickAt),
      ],
    });

    scene({
      id: sec.id + "-b", start: officeAt, end: b, shot: "loc-picked",
      effects: [
        spotlight("loc-trip1.startPoint", officeAt + 250, b - 500, 12),
        arrow("loc-trip1.startPoint", officeAt + 500, b - 500, "left"),
        callout("पहली trip = Head Office से", "आपको कुछ भरना नहीं है", officeAt + 400, b - 300, "top"),
      ],
    });
  },

  /**
   * The three travel modes with their rates. The app offers Bike, Car and a
   * combined Bus/Metro — there is no separate Metro or "Other" card, and the
   * ticket itself is attached later via Add bill, which the narration's
   * "photo upload" line points at.
   */
  transport(sec) {
    const a = ms(sec.start), b = ms(sec.end);
    const scrollF = seq("trans-scroll");
    const showAt = a + 1500;
    const ratesAt = ms(sent(sec, 1).start);
    const carAt = ratesAt + 3200;
    const busAt = ms(sent(sec, 2).start);
    const ticketAt = ms(sent(sec, 3).start);

    scene({
      id: sec.id, start: a, end: b,
      frames: [
        { at: a, shot: "loc-picked" },
        ...framesAcross(scrollF, a + 400, showAt),
        { at: showAt, shot: "trans-bike" },
        { at: carAt + 300, shot: "trans-car" },
        { at: busAt + 400, shot: "trans-bus" },
        { at: ticketAt + 600, shot: "bill-control" },
      ],
      frameFade: 110,
      shot: "trans-bus",
      effects: [
        { type: "chapter", kicker: sec.kicker, text: sec.chapter, in: a + 100, out: a + 2000 },
        highlight("trans-bike.bike", ratesAt, carAt - 200, 7),
        callout("Bike — ₹4 / km", undefined, ratesAt + 150, carAt - 250, "top"),
        tap("trans-bike.car", carAt),
        highlight("trans-bike.car", carAt + 300, busAt - 200, 7),
        callout("Car — ₹11 / km", undefined, carAt + 400, busAt - 250, "top"),
        tap("trans-bike.bus", busAt),
        highlight("trans-bike.bus", busAt + 400, ticketAt - 200, 7),
        callout("Bus / Metro — as per actual", "जो ticket का खर्चा हुआ, वही", busAt + 500, ticketAt - 250, "top"),
        highlight("bill-control.addBill", ticketAt + 800, b - 400, 7),
        arrow("bill-control.addBill", ticketAt + 1000, b - 400, "left"),
        callout("Ticket की photo upload कीजिए", "Add bill से", ticketAt + 900, b - 300),
      ],
    });
  },

  /** Log the visit and show the automatic km + amount. */
  log(sec) {
    const a = ms(sec.start), b = ms(sec.end);
    const tapAt = a + 2200;
    const doneAt = ms(sent(sec, 1).start);
    scene({
      id: sec.id, start: a, end: b,
      frames: [
        { at: a, shot: "log-ready" },
        { at: doneAt, shot: "log-done" },
      ],
      frameFade: 160,
      shot: "log-done",
      effects: [
        { type: "chapter", kicker: sec.kicker, text: sec.chapter, in: a + 100, out: a + 1900 },
        highlight("log-ready.logBtn", a + 500, tapAt + 250, 7),
        callout("Log This Visit", "बस यही दबाना है", a + 650, tapAt - 150),
        tap("log-ready.logBtn", tapAt),
        highlight("log-done.msg", doneAt + 250, b - 400, 8),
        callout("हो गया!", "km और amount अपने आप", doneAt + 350, b - 300),
      ],
    });
  },

  /** Trip 2 and 3 continue automatically from the previous stop. */
  chain(sec) {
    const a = ms(sec.start), b = ms(sec.end);
    const stepsAt = ms(sent(sec, 1).start);
    const autoAt = ms(sent(sec, 2).start);
    const anyAt = ms(sent(sec, 3).start);
    const timeline = seq("chain-timeline");

    scene({
      id: sec.id + "-a", start: a, end: autoAt,
      frames: [
        { at: a, shot: "chain-trip2" },
        { at: stepsAt + 900, shot: "chain-trip2-est" },
      ],
      frameFade: 150,
      shot: "chain-trip2",
      effects: [
        { type: "chapter", kicker: sec.kicker, text: sec.chapter, in: a + 100, out: a + 2200 },
        callout("अगली site? फिर वही चार steps", undefined, a + 400, stepsAt - 250),
        callout("नाम → site → transport → Log", undefined, stepsAt + 200, autoAt - 250),
      ],
    });

    scene({
      id: sec.id + "-b", start: autoAt, end: anyAt,
      frames: [
        { at: autoAt, shot: "chain-trip3" },
        { at: autoAt + 2800, shot: "chain-trip3-est" },
      ],
      frameFade: 150,
      shot: "chain-trip3",
      effects: [
        spotlight("chain-trip3.startPoint", autoAt + 200, anyAt - 300, 12),
        arrow("chain-trip3.startPoint", autoAt + 450, anyAt - 300, "left"),
        callout("पिछली site से अपने आप", "App खुद हिसाब लगा लेगी", autoAt + 300, anyAt - 350, "top"),
      ],
    });

    scene({
      id: sec.id + "-c", start: anyAt, end: b,
      frames: [
        { at: anyAt, shot: "chain-trip4" },
        ...framesAcross(timeline, anyAt + 900, b - 1800),
        { at: b - 1800, shot: "chain-timeline-end" },
      ],
      frameFade: 110,
      shot: "chain-timeline-end",
      effects: [
        callout("जितनी भी sites जाएँ", "हर बार बस यही चार steps", anyAt + 300, b - 300),
      ],
    });
  },

  /** GPS fallback when the site is not on the list. */
  gps(sec) {
    const a = ms(sec.start), b = ms(sec.end);
    const tapAt = a + 2600;
    const detectedAt = ms(sent(sec, 1).start);
    const warnAt = ms(sent(sec, 2).start);
    scene({
      id: sec.id, start: a, end: b,
      frames: [
        { at: a, shot: "loc-picked" },
        { at: tapAt + 350, shot: "gps-panel" },
        { at: detectedAt, shot: "gps-detected" },
      ],
      frameFade: 140,
      shot: "gps-detected",
      effects: [
        { type: "chapter", kicker: sec.kicker, text: sec.chapter, in: a + 100, out: a + 2100 },
        highlight("gps-panel.gpsBtn", a + 700, tapAt + 250, 7),
        callout("Site list में नहीं है?", "GPS वाला option चुनिए", a + 850, tapAt - 150),
        tap("gps-panel.gpsBtn", tapAt),
        callout("Location को Allow कीजिए", undefined, tapAt + 500, detectedAt - 250),
        highlight("gps-detected.detected", detectedAt + 250, warnAt - 200, 8),
        callout("App ने सही जगह पकड़ ली", undefined, detectedAt + 350, warnAt - 250, "top"),
        callout("Site पर पहुँच कर ही GPS", undefined, warnAt + 150, b - 250),
      ],
    });
  },

  /** Reset the chain back to the head office. */
  reset(sec) {
    const a = ms(sec.start), b = ms(sec.end);
    const tapAt = a + 3000;
    const warnAt = ms(sent(sec, 1).start);
    scene({
      id: sec.id, start: a, end: b,
      frames: [
        { at: a, shot: "reset-before" },
        { at: tapAt + 700, shot: "reset-after" },
      ],
      frameFade: 180,
      shot: "reset-after",
      effects: [
        { type: "chapter", kicker: sec.kicker, text: sec.chapter, in: a + 100, out: a + 1800 },
        highlight("reset-before.reset", a + 600, tapAt + 250, 7),
        callout("Reset Trip", "अगली visit फिर Head Office से", a + 750, tapAt - 150),
        tap("reset-before.reset", tapAt),
        spotlight("reset-after.startPoint", tapAt + 900, warnAt - 200, 12),
        callout("बिना वजह reset मत कीजिए", undefined, warnAt + 150, b - 250),
      ],
    });
  },

  /** Today's summary and attaching a bill. */
  summary(sec) {
    const a = ms(sec.start), b = ms(sec.end);
    const scrollA = seq("sum-scroll");
    const billAt = ms(sent(sec, 1).start);
    scene({
      id: sec.id, start: a, end: b,
      frames: [
        { at: a, shot: "reset-after" },
        ...framesAcross(scrollA, a + 400, billAt - 1200),
        { at: billAt - 1200, shot: "sum-list" },
        { at: billAt + 1400, shot: "bill-control" },
      ],
      frameFade: 100,
      shot: "bill-control",
      effects: [
        { type: "chapter", kicker: sec.kicker, text: sec.chapter, in: a + 100, out: a + 2000 },
        callout("Today's Summary", "आज का पूरा दिन एक जगह", a + 500, billAt - 300, "top"),
        highlight("bill-control.addBill", billAt + 1500, b - 400, 7),
        arrow("bill-control.addBill", billAt + 1700, b - 400, "left"),
        callout("Add bill", "photo upload कर दीजिए", billAt + 1600, b - 300),
      ],
    });
  },

  /** Non-conveyance expenses. */
  misc(sec) {
    const a = ms(sec.start), b = ms(sec.end);
    const scrollF = seq("misc-scroll");
    const cardAt = a + 2200;
    const nameAt = a + 5000;
    scene({
      id: sec.id, start: a, end: b,
      frames: [
        { at: a, shot: "sum-grand" },
        ...framesAcross(scrollF, a + 300, cardAt),
        { at: cardAt, shot: "misc-card" },
        { at: nameAt, shot: "misc-emp-chosen" },
        { at: nameAt + 1600, shot: "misc-filled" },
      ],
      frameFade: 120,
      shot: "misc-filled",
      effects: [
        { type: "chapter", kicker: sec.kicker, text: sec.chapter, in: a + 100, out: a + 1900 },
        callout("Parking, Toll, खाना", "conveyance से अलग", cardAt + 200, nameAt - 250, "top"),
        highlight("misc-card.miscEmp", nameAt - 900, nameAt + 700, 7),
        callout("यहाँ भी अपना नाम चुनिए", undefined, nameAt + 200, b - 300),
      ],
    });
  },

  /** Recap and closing card. */
  ending(sec) {
    const a = ms(sec.start), b = ms(sec.end);
    const stepsAt = ms(sent(sec, 1).start);
    const timeAt = ms(sent(sec, 2).start);
    const thanksAt = ms(sent(sec, 3).start);
    scene({
      id: sec.id, start: a, end: b, shot: "end-home",
      effects: [
        callout("बस, इतना ही!", undefined, a + 200, stepsAt - 250),
        callout("१ नाम   २ Location", "३ Transport   ४ Log This Visit", stepsAt + 200, timeAt - 250),
        callout("Visit के time ही entry कीजिए", "ताकि payment time पर मिले", timeAt + 150, thanksAt - 300),
        { type: "chapter", kicker: "धन्यवाद", text: "Watcon Conveyance Tracker", in: thanksAt - 100, out: b },
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
    burnSubtitles: process.env.TUT_BURN_SUBS !== "0", // burned in by default
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
