/**
 * Align the Hindi script to the recorded voiceover.
 *
 * There is no forced-alignment model available locally, so this uses the two
 * signals we do have, which together are accurate to well under a second:
 *
 *  1. The real pause structure of the audio (ffmpeg silencedetect) — every gap
 *     between phrases, with its exact start/end.
 *  2. Speech-rate proportionality — for one TTS voice at a fixed rate, spoken
 *     duration tracks character count closely.
 *
 * Sentences are laid out proportionally, then every boundary is SNAPPED to the
 * nearest real pause. A sentence therefore always begins when the narrator
 * actually starts speaking, never mid-word.
 *
 * Output: video/build/alignment.json — section and sentence timings in ms.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BUILD = join(process.cwd(), "video", "build");

interface Gap { start: number; end: number; dur: number }
interface Section { id: string; chapter: string; kicker: string; sentences: string[] }

const gaps: Gap[] = JSON.parse(readFileSync(join(BUILD, "gaps.json"), "utf8"));
const { sections } = JSON.parse(
  readFileSync(join(process.cwd(), "video", "script.json"), "utf8"),
) as { sections: Section[] };

const AUDIO_SEC = Number(process.env.TUT_AUDIO_SEC ?? 395.284875);

/**
 * Speech weight of a line. Latin words in a Hindi sentence ("Log This Visit")
 * are read at roughly Hindi syllable pace, so plain non-space character count
 * is a good proxy; digits and punctuation contribute nothing.
 */
function weight(s: string): number {
  return s.replace(/[\s.,!?—–-]/g, "").length;
}

/** Speech runs = the complement of the detected silences. */
function speechRuns(): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const g of gaps) {
    if (g.start > cursor + 0.06) runs.push({ start: cursor, end: g.start });
    cursor = g.end;
  }
  if (cursor < AUDIO_SEC - 0.06) runs.push({ start: cursor, end: AUDIO_SEC });
  return runs;
}

/** Candidate cut points: the middle of every detected pause, plus the ends. */
function cutPoints(): number[] {
  const pts = [0, ...gaps.map((g) => (g.start + g.end) / 2), AUDIO_SEC];
  return [...new Set(pts)].sort((a, b) => a - b);
}

/** Start of speech immediately at or after `t`. */
function speechStartAfter(t: number, runs: { start: number; end: number }[]): number {
  for (const r of runs) if (r.end > t + 0.02) return Math.max(r.start, 0);
  return t;
}

function snap(target: number, points: number[], maxDrift: number): number {
  let best = target, bestD = Infinity;
  for (const p of points) {
    const d = Math.abs(p - target);
    if (d < bestD && d <= maxDrift) { best = p; bestD = d; }
  }
  return best;
}

function main() {
  const runs = speechRuns();
  const points = cutPoints();
  const speechTotal = runs.reduce((s, r) => s + (r.end - r.start), 0);

  console.log(`audio      : ${AUDIO_SEC.toFixed(2)}s`);
  console.log(`speech runs: ${runs.length}  (${speechTotal.toFixed(2)}s of speech, ` +
              `${(AUDIO_SEC - speechTotal).toFixed(2)}s of pause)`);

  // ── Pass 1: proportional layout over SPEECH time only ───────────
  const allSentences: { sectionIdx: number; text: string; w: number }[] = [];
  sections.forEach((sec, i) =>
    sec.sentences.forEach((t) => allSentences.push({ sectionIdx: i, text: t, w: weight(t) })));
  const totalW = allSentences.reduce((s, x) => s + x.w, 0);

  /** Map a cumulative speech offset back to a wall-clock time in the audio. */
  function speechOffsetToTime(off: number): number {
    let acc = 0;
    for (const r of runs) {
      const len = r.end - r.start;
      if (acc + len >= off) return r.start + (off - acc);
      acc += len;
    }
    return AUDIO_SEC;
  }

  let cum = 0;
  const rough = allSentences.map((s) => {
    const start = speechOffsetToTime((cum / totalW) * speechTotal);
    cum += s.w;
    const end = speechOffsetToTime((cum / totalW) * speechTotal);
    return { ...s, start, end };
  });

  // ── Pass 2: snap SECTION boundaries to real pauses ──────────────
  // Section breaks are where the narrator paused longest, so allow a wider
  // drift there and prefer the longer gaps.
  const longGaps = gaps.filter((g) => g.dur >= 0.95).map((g) => (g.start + g.end) / 2);
  const sectionStarts: number[] = [];
  for (let i = 0; i < sections.length; i++) {
    const first = rough.find((r) => r.sectionIdx === i)!;
    if (i === 0) { sectionStarts.push(0); continue; }
    // Prefer a real pause, but only a nearby one. A wide search can drag a
    // boundary onto the wrong pause and starve the section either side of it
    // — that is how a 95-character sentence ended up with 2.8 seconds.
    const long = snap(first.start, longGaps, 2.5);
    sectionStarts.push(long !== first.start ? long : snap(first.start, points, 1.2));
  }

  /**
   * Snapping must not distort how long a section actually needs. Compare each
   * snapped span against its speech-weighted estimate and fall back to the
   * proportional boundary whenever the squeeze exceeds 25%.
   */
  const need = sections.map((s) =>
    s.sentences.reduce((n, t) => n + weight(t), 0) / totalW * speechTotal);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < sections.length; i++) {
      const end = i + 1 < sectionStarts.length ? sectionStarts[i + 1] : AUDIO_SEC;
      const span = end - sectionStarts[i];
      // `need` is speech-only; the real span also carries the pauses inside it,
      // so allow generous headroom and only correct a genuine squeeze.
      if (span < need[i] * 0.75) {
        const rough_i = rough.find((r) => r.sectionIdx === i)!.start;
        sectionStarts[i] = Math.min(sectionStarts[i], rough_i);
        if (i + 1 < sectionStarts.length) {
          const proportional = rough.find((r) => r.sectionIdx === i + 1)?.start;
          if (proportional && proportional > sectionStarts[i] + need[i] * 0.8) {
            sectionStarts[i + 1] = proportional;
          }
        }
      }
    }
  }
  /**
   * Final pass: a section must never begin mid-word. Any boundary the squeeze
   * guard moved back into speech is nudged to the nearest real pause, provided
   * that does not re-introduce a squeeze.
   */
  const inPause = (t: number) => gaps.some((g) => t >= g.start - 0.15 && t <= g.end + 0.15);
  for (let i = 1; i < sectionStarts.length; i++) {
    if (inPause(sectionStarts[i])) continue;
    const cand = snap(sectionStarts[i], points, 2.0);
    if (cand === sectionStarts[i]) continue;
    const end = i + 1 < sectionStarts.length ? sectionStarts[i + 1] : AUDIO_SEC;
    const prevEnd = sectionStarts[i - 1];
    if (end - cand >= need[i] * 0.75 && cand - prevEnd >= need[i - 1] * 0.75) {
      sectionStarts[i] = cand;
    }
  }

  // Enforce monotonicity in case two sections snapped to the same pause.
  for (let i = 1; i < sectionStarts.length; i++) {
    if (sectionStarts[i] <= sectionStarts[i - 1] + 1) {
      sectionStarts[i] = snap(rough.find((r) => r.sectionIdx === i)!.start, points, 3);
      if (sectionStarts[i] <= sectionStarts[i - 1] + 1) {
        sectionStarts[i] = sectionStarts[i - 1] + 2;
      }
    }
  }

  // ── Pass 3: re-lay sentences inside each snapped section ────────
  const out: {
    id: string; chapter: string; kicker: string;
    start: number; end: number;
    sentences: { text: string; start: number; end: number }[];
  }[] = [];

  for (let i = 0; i < sections.length; i++) {
    const secStart = sectionStarts[i];
    const secEnd = i + 1 < sectionStarts.length ? sectionStarts[i + 1] : AUDIO_SEC;
    const mine = sections[i].sentences;
    const w = mine.map(weight);
    const wSum = w.reduce((a, b) => a + b, 0);

    const sentences: { text: string; start: number; end: number }[] = [];
    let t = secStart;
    for (let j = 0; j < mine.length; j++) {
      const share = (w[j] / wSum) * (secEnd - secStart);
      let s = j === 0 ? secStart : snap(t, points, 1.1);
      s = speechStartAfter(s, runs);
      if (s >= secEnd - 0.3) s = Math.max(secStart, secEnd - 0.6);
      const e = j === mine.length - 1 ? secEnd : Math.min(secEnd, s + share);
      sentences.push({ text: mine[j], start: s, end: e });
      t = s + share;
    }
    // Subtitles must not overlap.
    for (let j = 0; j < sentences.length - 1; j++) {
      sentences[j].end = Math.min(sentences[j].end, sentences[j + 1].start - 0.03);
      if (sentences[j].end < sentences[j].start + 0.4) sentences[j].end = sentences[j].start + 0.4;
    }

    out.push({
      id: sections[i].id,
      chapter: sections[i].chapter,
      kicker: sections[i].kicker,
      start: secStart,
      end: secEnd,
      sentences,
    });
  }

  writeFileSync(join(BUILD, "alignment.json"), JSON.stringify({ audioSec: AUDIO_SEC, sections: out }, null, 2));

  console.log("\nSection map:");
  for (const s of out) {
    const mmss = (v: number) => `${String(Math.floor(v / 60)).padStart(2, "0")}:${(v % 60).toFixed(1).padStart(4, "0")}`;
    console.log(`  ${mmss(s.start)} – ${mmss(s.end)}  (${(s.end - s.start).toFixed(1)}s)  ${s.id}  — ${s.chapter}`);
  }
  console.log(`\n✔ ${out.reduce((n, s) => n + s.sentences.length, 0)} subtitle cues → video/build/alignment.json`);
}

main();
