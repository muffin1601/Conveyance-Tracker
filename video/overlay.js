/**
 * Tutorial overlay layer, injected into the real app during capture.
 *
 * Everything here is presentation-only: a soft touch pointer, a ripple on tap,
 * an animated highlight rectangle, a callout box and an arrow, plus a spotlight
 * that blurs everything except the element being explained.
 *
 * It is driven imperatively from the capture script (window.__tut.*) and
 * captures into the same screenshot as the app, so the composite is
 * pixel-perfect with no post-hoc alignment.
 */
(() => {
  if (window.__tut) return;

  const NS = "tut";
  const root = document.createElement("div");
  root.id = `${NS}-root`;
  root.setAttribute("aria-hidden", "true");
  document.documentElement.appendChild(root);

  root.innerHTML = `
    <div id="${NS}-dim"></div>
    <div id="${NS}-spot"></div>
    <div id="${NS}-ring"></div>
    <div id="${NS}-ripple"></div>
    <div id="${NS}-pointer"><span></span></div>
    <div id="${NS}-callout"><b></b><i></i></div>
    <div id="${NS}-arrow"><svg viewBox="0 0 100 40" preserveAspectRatio="none">
      <path d="M2,20 L82,20" stroke="currentColor" stroke-width="5" stroke-linecap="round" fill="none"/>
      <path d="M70,7 L88,20 L70,33" stroke="currentColor" stroke-width="5"
            stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </svg></div>
  `;

  const $ = (id) => root.querySelector(`#${NS}-${id}`);
  const dim = $("dim"), spot = $("spot"), ring = $("ring"), ripple = $("ripple");
  const pointer = $("pointer"), callout = $("callout"), arrow = $("arrow");

  /** Viewport box of a target, accepting a selector, element or explicit rect. */
  function boxOf(target) {
    if (!target) return null;
    if (typeof target === "object" && "x" in target && "width" in target) return target;
    const el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }

  const api = {
    /** Move the touch pointer. `press` scales it down like a fingertip contact. */
    pointer(x, y, { show = true, press = false } = {}) {
      pointer.style.opacity = show ? "1" : "0";
      pointer.style.transform =
        `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${press ? 0.78 : 1})`;
      pointer.dataset.press = press ? "1" : "0";
    },

    /** Ripple at a point. `t` is 0..1 progress, letting the renderer drive it. */
    ripple(x, y, t) {
      if (t == null || t < 0 || t > 1) { ripple.style.opacity = "0"; return; }
      const size = 26 + t * 104;
      ripple.style.opacity = String((1 - t) * 0.85);
      ripple.style.width = ripple.style.height = `${size}px`;
      ripple.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    },

    /** Animated rectangle around a control. `t` 0..1 draws it on. */
    highlight(target, t = 1, { pad = 8, radius = 12 } = {}) {
      const b = boxOf(target);
      if (!b || t <= 0) { ring.style.opacity = "0"; return; }
      const grow = 1 + (1 - Math.min(t, 1)) * 0.06;
      ring.style.opacity = String(Math.min(t * 2, 1));
      ring.style.left = `${b.x - pad}px`;
      ring.style.top = `${b.y - pad}px`;
      ring.style.width = `${b.width + pad * 2}px`;
      ring.style.height = `${b.height + pad * 2}px`;
      ring.style.borderRadius = `${radius}px`;
      ring.style.transform = `scale(${grow})`;
    },

    /**
     * Blur everything except `target`. Implemented as a backdrop-filtered
     * sheet with a transparent cut-out, so the app itself is never mutated.
     */
    spotlight(target, t = 1, { pad = 10, radius = 14 } = {}) {
      const b = boxOf(target);
      if (!b || t <= 0) { dim.style.opacity = "0"; spot.style.opacity = "0"; return; }
      dim.style.opacity = String(t);
      spot.style.opacity = "1";
      const x = b.x - pad, y = b.y - pad, w = b.width + pad * 2, h = b.height + pad * 2;
      // A hole punched with an inset box-shadow keeps edges crisp at any DPR.
      spot.style.left = `${x}px`;
      spot.style.top = `${y}px`;
      spot.style.width = `${w}px`;
      spot.style.height = `${h}px`;
      spot.style.borderRadius = `${radius}px`;
      dim.style.clipPath =
        `polygon(0% 0%, 0% 100%, ${x}px 100%, ${x}px ${y}px, ${x + w}px ${y}px, ` +
        `${x + w}px ${y + h}px, ${x}px ${y + h}px, ${x}px 100%, 100% 100%, 100% 0%)`;
    },

    /** Caption bubble. `t` 0..1 fades and lifts it in. */
    callout(text, sub, t = 1, { at = "bottom" } = {}) {
      if (!text || t <= 0) { callout.style.opacity = "0"; return; }
      callout.querySelector("b").textContent = text;
      callout.querySelector("i").textContent = sub || "";
      callout.querySelector("i").style.display = sub ? "block" : "none";
      callout.dataset.at = at;
      callout.style.opacity = String(Math.min(t * 1.4, 1));
      callout.style.transform = `translateY(${(1 - Math.min(t, 1)) * 14}px)`;
    },

    /** Arrow pointing at a target from the given side. */
    arrow(target, t = 1, { side = "left", length = 70 } = {}) {
      const b = boxOf(target);
      if (!b || t <= 0) { arrow.style.opacity = "0"; return; }
      arrow.style.opacity = String(Math.min(t * 1.5, 1));
      const len = length * Math.min(t, 1);
      if (side === "left") {
        arrow.style.left = `${b.x - len - 10}px`;
        arrow.style.top = `${b.y + b.height / 2 - 14}px`;
        arrow.style.transform = "none";
      } else {
        arrow.style.left = `${b.x + b.width + 10}px`;
        arrow.style.top = `${b.y + b.height / 2 - 14}px`;
        arrow.style.transform = "scaleX(-1)";
      }
      arrow.style.width = `${len}px`;
      arrow.style.height = "28px";
    },

    /** Hide every overlay element at once. */
    clear() {
      for (const el of [dim, spot, ring, ripple, pointer, callout, arrow]) el.style.opacity = "0";
    },

    /** Absolute viewport box of a selector — used by the compositor for zooms. */
    box(sel) { return boxOf(sel); },
  };

  api.clear();
  window.__tut = api;
})();
