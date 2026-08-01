/**
 * Deterministic timeline player for the tutorial compositor.
 *
 * The renderer calls window.__seek(timeMs) for every frame and screenshots the
 * result. Nothing here depends on wall-clock time, requestAnimationFrame or
 * CSS transitions, so frame N is byte-identical on every run and the video can
 * never drop a frame or drift out of sync with the voiceover.
 */
(() => {
  const SCREEN = { w: 390, h: 844 }; // app viewport, in CSS px
  const STAGE = { w: 1080, h: 1920 };

  const el = {
    phone: document.getElementById("phone"),
    screen: document.getElementById("screen"),
    camera: document.getElementById("camera"),
    annot: document.getElementById("annot"),
    imgA: document.getElementById("imgA"),
    imgB: document.getElementById("imgB"),
    ring: document.getElementById("ring"),
    ripple: document.getElementById("ripple"),
    pointer: document.getElementById("pointer"),
    arrow: document.getElementById("arrow"),
    dim: document.getElementById("dim"),
    spot: document.getElementById("spot"),
    callout: document.getElementById("callout"),
    chapter: document.getElementById("chapter"),
    sub: document.getElementById("sub"),
    fade: document.getElementById("fade"),
  };

  // ── Device sizing ────────────────────────────────────────────────
  // Fill the stage vertically with a comfortable margin, keeping the exact
  // 390:844 aspect of the source captures so nothing is ever stretched.
  const SCALE = 1830 / SCREEN.h; // ≈2.168 → screen renders at 846 × 1830
  const SW = Math.round(SCREEN.w * SCALE);
  const SH = Math.round(SCREEN.h * SCALE);
  el.screen.style.width = SW + "px";
  el.screen.style.height = SH + "px";
  el.phone.style.marginLeft = -(SW / 2 + 11) + "px";
  el.phone.style.marginTop = -(SH / 2 + 11) + "px";

  // ── Easing ───────────────────────────────────────────────────────
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const ease = {
    linear: (t) => t,
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    out: (t) => 1 - Math.pow(1 - t, 3),
    outQuint: (t) => 1 - Math.pow(1 - t, 5),
    in: (t) => t * t * t,
  };
  /** Progress of `now` across [a,b], eased. */
  const span = (now, a, b, fn = "inOut") =>
    b <= a ? (now >= b ? 1 : 0) : ease[fn](clamp01((now - a) / (b - a)));
  const lerp = (a, b, t) => a + (b - a) * t;

  // ── Timeline data (injected by the renderer) ─────────────────────
  /** Captures are served from video/build/shots/, relative to compositor.html. */
  const SHOT_DIR = "build/shots/";
  let TL = { durationMs: 0, scenes: [] };
  let SHOTS = {};

  window.__load = (timeline, shotIndex) => {
    TL = timeline;
    SHOTS = shotIndex;
  };

  /** Resolve a target to a box in app-viewport CSS px. */
  function resolveBox(scene, target) {
    if (!target) return null;
    if (Array.isArray(target)) return { x: target[0], y: target[1], width: target[2], height: target[3] };
    if (typeof target === "object") return target;
    // "shotName.boxName" or just "boxName" (looked up on the scene's shot)
    const [a, b] = target.includes(".") ? target.split(".") : [scene.shot, target];
    const s = SHOTS[a];
    return (s && s.boxes && s.boxes[b]) || null;
  }

  const centreOf = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

  // ── Camera ───────────────────────────────────────────────────────
  /**
   * A camera state is {zoom, cx, cy}: zoom factor and the app-space point held
   * at the centre of the screen. Converted to a transform on the image stack.
   */
  function applyCamera(cam) {
    const z = cam.zoom ?? 1;
    const cx = cam.cx ?? SCREEN.w / 2;
    const cy = cam.cy ?? SCREEN.h / 2;
    // Screen-space scale, then translate so (cx,cy) sits at the screen centre.
    const s = SCALE * z;
    let tx = SW / 2 - cx * s;
    let ty = SH / 2 - cy * s;
    // Never reveal empty space beyond the app content.
    const maxX = 0, minX = SW - SCREEN.w * s;
    const maxY = 0, minY = SH - SCREEN.h * s;
    tx = Math.min(maxX, Math.max(minX, tx));
    ty = Math.min(maxY, Math.max(minY, ty));
    const t = `translate(${tx}px, ${ty}px) scale(${s})`;
    el.camera.style.transform = t;
    el.annot.style.transform = t;
    // Counter-scale annotation strokes so borders stay a constant screen width.
    el.annot.style.setProperty("--inv", String(1 / s));
    return { s, tx, ty };
  }

  /** Camera keyframes: [{at: ms, zoom, cx, cy, ease}] interpolated over time. */
  function cameraAt(scene, now) {
    const ks = scene.camera;
    if (!ks || !ks.length) return { zoom: 1, cx: SCREEN.w / 2, cy: SCREEN.h / 2 };
    const resolved = ks.map((k) => {
      let cx = k.cx, cy = k.cy;
      if (k.focus) {
        const b = resolveBox(scene, k.focus);
        if (b) { const c = centreOf(b); cx = c.x; cy = c.y; }
      }
      return { at: k.at, zoom: k.zoom ?? 1, cx: cx ?? SCREEN.w / 2, cy: cy ?? SCREEN.h / 2, ease: k.ease ?? "inOut" };
    });
    if (now <= resolved[0].at) return resolved[0];
    for (let i = 0; i < resolved.length - 1; i++) {
      const a = resolved[i], b = resolved[i + 1];
      if (now >= a.at && now <= b.at) {
        const t = span(now, a.at, b.at, b.ease);
        return { zoom: lerp(a.zoom, b.zoom, t), cx: lerp(a.cx, b.cx, t), cy: lerp(a.cy, b.cy, t) };
      }
    }
    return resolved[resolved.length - 1];
  }

  // ── Frame image selection ────────────────────────────────────────
  /**
   * A scene shows either one shot, or a `frames` list of {at, shot} that steps
   * through captured stills (typing, scrolling) with an optional cross-fade.
   */
  function applyImage(scene, now) {
    let shot = scene.shot;
    let next = null, mix = 0;
    if (scene.frames && scene.frames.length) {
      let i = 0;
      while (i < scene.frames.length - 1 && now >= scene.frames[i + 1].at) i++;
      shot = scene.frames[i].shot;
      const nf = scene.frames[i + 1];
      const fade = scene.frameFade ?? 0;
      if (nf && fade > 0 && now > nf.at - fade) {
        next = nf.shot;
        mix = clamp01((now - (nf.at - fade)) / fade);
      }
    }
    const src = (n) => `${SHOT_DIR}${SHOTS[n] ? SHOTS[n].file : n + ".png"}`;
    if (el.imgA.dataset.shot !== shot) { el.imgA.src = src(shot); el.imgA.dataset.shot = shot; }
    if (next) {
      if (el.imgB.dataset.shot !== next) { el.imgB.src = src(next); el.imgB.dataset.shot = next; }
      el.imgB.style.opacity = String(mix);
    } else {
      el.imgB.style.opacity = "0";
    }
  }

  // ── Annotations ──────────────────────────────────────────────────
  function hideAll() {
    for (const k of ["ring", "ripple", "pointer", "arrow", "dim", "spot", "callout", "chapter", "sub", "fade"]) {
      el[k].style.opacity = "0";
    }
  }

  function drawPointer(scene, fx, now) {
    // Move along the path, then press + ripple at `tap`.
    const from = resolveBox(scene, fx.from);
    const to = resolveBox(scene, fx.to ?? fx.target);
    if (!to) return;
    const pTo = centreOf(to);
    const pFrom = from ? centreOf(from) : { x: pTo.x, y: pTo.y + 190 };
    const moveEnd = fx.tap ?? fx.out ?? fx.in;
    const t = span(now, fx.in, moveEnd, "outQuint");
    const x = lerp(pFrom.x, pTo.x, t);
    const y = lerp(pFrom.y, pTo.y, t);

    const visible = span(now, fx.in, fx.in + 160, "out") * (1 - span(now, (fx.out ?? 1e9) - 200, fx.out ?? 1e9, "in"));
    el.pointer.style.opacity = String(clamp01(visible));

    // Press dip around the tap moment.
    let press = 1;
    if (fx.tap != null) {
      const d = Math.abs(now - fx.tap);
      if (d < 170) press = 1 - 0.22 * (1 - d / 170);
    }
    el.pointer.style.transform =
      `translate(${x}px, ${y}px) translate(-50%,-50%) scale(${press * (1 / (SCALE * (scene.__z || 1)))})`;
    el.pointer.style.width = "52px";
    el.pointer.style.height = "52px";

    if (fx.tap != null && now >= fx.tap && now <= fx.tap + 620) {
      const rt = (now - fx.tap) / 620;
      const size = (24 + rt * 150) / (SCALE * (scene.__z || 1));
      el.ripple.style.opacity = String((1 - rt) * 0.9);
      el.ripple.style.width = size + "px";
      el.ripple.style.height = size + "px";
      el.ripple.style.transform = `translate(${pTo.x}px, ${pTo.y}px) translate(-50%,-50%)`;
      el.ripple.style.borderWidth = (3 / (SCALE * (scene.__z || 1))) + "px";
    }
  }

  function drawHighlight(scene, fx, now) {
    const b = resolveBox(scene, fx.target);
    if (!b) return;
    const inT = span(now, fx.in, fx.in + (fx.dur ?? 380), "out");
    const outT = fx.out != null ? span(now, fx.out - 260, fx.out, "in") : 0;
    const a = clamp01(inT - outT);
    if (a <= 0) return;
    const pad = (fx.pad ?? 8);
    const overshoot = 1 + (1 - inT) * 0.05;
    const inv = 1 / (SCALE * (scene.__z || 1));
    el.ring.style.opacity = String(a);
    el.ring.style.left = (b.x - pad) + "px";
    el.ring.style.top = (b.y - pad) + "px";
    el.ring.style.width = (b.width + pad * 2) + "px";
    el.ring.style.height = (b.height + pad * 2) + "px";
    el.ring.style.borderWidth = (3 * inv) + "px";
    el.ring.style.borderRadius = (14 * inv) + "px";
    el.ring.style.transform = `scale(${overshoot})`;
  }

  function drawSpotlight(scene, fx, now) {
    const b = resolveBox(scene, fx.target);
    if (!b) return;
    const a = clamp01(span(now, fx.in, fx.in + 340, "out") - (fx.out != null ? span(now, fx.out - 300, fx.out, "in") : 0));
    if (a <= 0) return;
    const pad = fx.pad ?? 10;
    const x = b.x - pad, y = b.y - pad, w = b.width + pad * 2, h = b.height + pad * 2;
    el.dim.style.opacity = String(a * 0.96);
    el.dim.style.clipPath =
      `polygon(0 0, 0 ${SCREEN.h}px, ${x}px ${SCREEN.h}px, ${x}px ${y}px, ${x + w}px ${y}px, ` +
      `${x + w}px ${y + h}px, ${x}px ${y + h}px, ${x}px ${SCREEN.h}px, ${SCREEN.w}px ${SCREEN.h}px, ${SCREEN.w}px 0)`;
    const inv = 1 / (SCALE * (scene.__z || 1));
    el.spot.style.opacity = String(a);
    el.spot.style.left = x + "px"; el.spot.style.top = y + "px";
    el.spot.style.width = w + "px"; el.spot.style.height = h + "px";
    el.spot.style.borderRadius = (16 * inv) + "px";
  }

  function drawArrow(scene, fx, now) {
    const b = resolveBox(scene, fx.target);
    if (!b) return;
    const t = span(now, fx.in, fx.in + 420, "out");
    const a = clamp01(t - (fx.out != null ? span(now, fx.out - 260, fx.out, "in") : 0));
    if (a <= 0) return;
    const inv = 1 / (SCALE * (scene.__z || 1));
    const len = (fx.length ?? 64) * inv * t;
    el.arrow.style.opacity = String(a);
    el.arrow.style.height = (26 * inv) + "px";
    el.arrow.style.width = len + "px";
    el.arrow.style.top = (b.y + b.height / 2 - 13 * inv) + "px";
    if ((fx.side ?? "left") === "left") {
      el.arrow.style.left = (b.x - len - 8 * inv) + "px";
      el.arrow.style.transform = "none";
    } else {
      el.arrow.style.left = (b.x + b.width + 8 * inv) + "px";
      el.arrow.style.transform = "scaleX(-1)";
    }
  }

  function drawCallout(fx, now) {
    const a = clamp01(span(now, fx.in, fx.in + 320, "out") - (fx.out != null ? span(now, fx.out - 300, fx.out, "in") : 0));
    if (a <= 0) return;
    el.callout.querySelector("b").textContent = fx.text || "";
    const i = el.callout.querySelector("i");
    i.textContent = fx.sub || "";
    i.style.display = fx.sub ? "block" : "none";
    el.callout.style.opacity = String(a);
    el.callout.style.transform = `translateY(${(1 - a) * 26}px)`;
    if (fx.at === "top") { el.callout.style.top = "170px"; el.callout.style.bottom = "auto"; }
    else { el.callout.style.bottom = "250px"; el.callout.style.top = "auto"; }
  }

  function drawChapter(fx, now) {
    const a = clamp01(span(now, fx.in, fx.in + 380, "out") - (fx.out != null ? span(now, fx.out - 380, fx.out, "in") : 0));
    if (a <= 0) return;
    el.chapter.querySelector(".kicker").textContent = fx.kicker || "";
    el.chapter.querySelector(".title").textContent = fx.text || "";
    el.chapter.style.opacity = String(a);
    el.chapter.querySelector(".title").style.transform = `translateY(${(1 - a) * 24}px)`;
  }

  function drawFade(fx, now) {
    // in → opaque at `mid` → out. Used for section changes.
    const up = span(now, fx.in, fx.mid ?? fx.in + 220, "in");
    const down = fx.out != null ? span(now, fx.mid ?? fx.in + 220, fx.out, "out") : 0;
    el.fade.style.opacity = String(clamp01(up - down));
  }

  // ── Subtitles ────────────────────────────────────────────────────
  /** Break a cue onto at most two balanced lines so the band stays compact. */
  function wrapCue(text, max = 34) {
    if (text.length <= max) return text;
    const words = text.split(" ");
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
      const score = Math.abs(a.length - b.length) + Math.max(0, Math.max(a.length, b.length) - max) * 4;
      if (!best || score < best.score) best = { score, text: a + String.fromCharCode(10) + b };
    }
    return best ? best.text : text;
  }

  function drawSubtitle(now) {
    if (!TL.subtitles || !TL.burnSubtitles) return;
    const cue = TL.subtitles.find((c) => now >= c.start && now < c.end);
    if (!cue) return;
    el.sub.querySelector("span").textContent = wrapCue(cue.text);
    el.sub.style.opacity = "1";
  }

  // ── Main seek ────────────────────────────────────────────────────
  window.__seek = (now) => {
    hideAll();

    const scene = TL.scenes.find((s) => now >= s.start && now < s.end) ||
                  TL.scenes[TL.scenes.length - 1];
    if (!scene) return;
    const local = now - scene.start;

    applyImage(scene, local);
    const cam = cameraAt(scene, local);
    scene.__z = cam.zoom;
    applyCamera(cam);

    for (const fx of scene.effects || []) {
      if (now < scene.start + (fx.in ?? 0) - 1) continue;
      switch (fx.type) {
        case "tap": drawPointer(scene, fx, local); break;
        case "highlight": drawHighlight(scene, fx, local); break;
        case "spotlight": drawSpotlight(scene, fx, local); break;
        case "arrow": drawArrow(scene, fx, local); break;
        case "callout": drawCallout(fx, local); break;
        case "chapter": drawChapter(fx, local); break;
        case "fade": drawFade(fx, local); break;
      }
    }

    drawSubtitle(now);
    document.title = `t=${(now / 1000).toFixed(2)}s`;
  };

  /** Resolves once every image referenced by the timeline is decoded. */
  window.__preload = async () => {
    const names = new Set();
    for (const s of TL.scenes) {
      if (s.shot) names.add(s.shot);
      for (const f of s.frames || []) names.add(f.shot);
    }
    await Promise.all([...names].map((n) => new Promise((res) => {
      const im = new Image();
      im.onload = im.onerror = () => res();
      im.src = `${SHOT_DIR}${SHOTS[n] ? SHOTS[n].file : n + ".png"}`;
    })));
    await document.fonts.ready;
    return names.size;
  };

  window.__ready = true;
})();
