/**
 * Phase A — capture every screen state the tutorial needs from the REAL app.
 *
 * Runs against the isolated SQLite recording database (never production).
 * Each capture is a fully settled state: no spinners, no half-loaded lists, no
 * console, no misclicks. Motion between these stills is added in Phase B, so
 * the final video never shows a loading delay or a dropped frame.
 *
 * Output: video/build/shots/<name>.png  +  video/build/shots.json (geometry
 * for every control the compositor needs to zoom to, highlight or tap).
 */
import { chromium, type Page, type Browser } from "playwright";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.TUT_BASE_URL ?? "http://localhost:3100";
const OUT = join(process.cwd(), "video", "build", "shots");
const VIEWPORT = { width: 390, height: 844 }; // Pixel-class Android viewport
const DPR = 3; // 390 * 3 = 1170px wide source, downscaled to 1080 — always crisp

/** Okhla Phase II — the head office, used as the simulated GPS fix. */
const GPS_FIX = { latitude: 28.5355, longitude: 77.2731 };

const overlayCss = readFileSync(join(process.cwd(), "video", "overlay.css"), "utf8");

interface Box { x: number; y: number; width: number; height: number }
interface Shot {
  name: string;
  file: string;
  boxes: Record<string, Box>;
  scrollY: number;
  note?: string;
}

const shots: Shot[] = [];

async function settle(page: Page, ms = 200) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
  await page.evaluate(() => new Promise<void>((r) =>
    requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

async function shoot(
  page: Page,
  name: string,
  selectors: Record<string, string> = {},
  note?: string,
): Promise<Shot> {
  await settle(page);
  const file = `${name}.png`;
  await page.screenshot({ path: join(OUT, file), animations: "disabled", caret: "hide" });

  const boxes: Record<string, Box> = {};
  for (const [key, sel] of Object.entries(selectors)) {
    const b = await page.locator(sel).first().boundingBox().catch(() => null);
    if (b) boxes[key] = { x: b.x, y: b.y, width: b.width, height: b.height };
    else console.warn(`  ! ${name}: selector not found → ${key} (${sel})`);
  }
  const scrollY = await page.evaluate(() => window.scrollY);
  shots.push({ name, file, boxes, scrollY, note });
  console.log(`  · ${name}${note ? ` — ${note}` : ""}`);
  return shots[shots.length - 1];
}

/** Smooth scroll to an absolute offset, capturing intermediate stills. */
async function scrollSequence(page: Page, name: string, to: number, steps = 16, sel: Record<string, string> = {}) {
  const from = await page.evaluate(() => window.scrollY);
  for (let i = 1; i <= steps; i++) {
    const p = i / steps;
    const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    const y = Math.round(from + (to - from) * e);
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await shoot(page, `${name}-${String(i).padStart(2, "0")}`, i === steps ? sel : {}, `scroll ${y}px`);
  }
}

/** Type into the open combobox one character at a time, capturing each. */
async function typeSequence(page: Page, name: string, selector: string, text: string) {
  for (let i = 1; i <= text.length; i++) {
    await page.fill(selector, text.slice(0, i));
    await shoot(page, `${name}-${String(i).padStart(2, "0")}`,
      { list: '[role="listbox"]', option: '[role="option"]' }, `typed "${text.slice(0, i)}"`);
  }
}

/** Select an employee by name through the real combobox. */
async function pickEmployee(page: Page, query: string) {
  await page.click("#emp");
  await page.fill('input[role="combobox"]', query);
  await page.waitForSelector('[role="option"]');
  await page.click('[role="option"]');
  await settle(page, 800);
}

/** Select a destination site by name, then wait out the debounce + estimate. */
async function pickDestination(page: Page, query: string) {
  await page.click("#dest");
  await page.fill('input[role="combobox"]', query);
  await page.waitForSelector('[role="option"]');
  await page.click('[role="option"]');
  await settle(page, 1500);
}

async function logVisit(page: Page) {
  await page.click('button:has-text("Log This Visit")');
  await page.waitForSelector('text=/Trip \\d+ logged/', { timeout: 20000 });
  await settle(page, 900);
}

async function openApp(browser: Browser) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DPR,
    isMobile: true,
    hasTouch: true,
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    colorScheme: "light",
    reducedMotion: "reduce",
    permissions: ["geolocation"],
    geolocation: GPS_FIX,
  });
  await ctx.addInitScript(`
    (() => {
      const css = ${JSON.stringify(overlayCss)};
      const add = () => {
        if (document.getElementById("tut-style")) return;
        const s = document.createElement("style");
        s.id = "tut-style"; s.textContent = css;
        document.head.appendChild(s);
      };
      if (document.head) add(); else document.addEventListener("DOMContentLoaded", add);
    })();
  `);
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.warn("  page error:", m.text()); });
  // "Reset Journey" asks for confirmation; always accept during capture.
  page.on("dialog", (d) => d.accept());
  return { ctx, page };
}

/* Selectors reused across scenes. */
const S = {
  header: "header",
  nav: "nav",
  tabCheckIn: 'nav a:has-text("Check In")',
  tabAdmin: 'nav a:has-text("Admin")',
  tabSettings: 'nav a:has-text("Settings")',
  emp: "#emp",
  dest: "#dest",
  search: 'input[role="combobox"]',
  list: '[role="listbox"]',
  option: '[role="option"]',
  tripBadge: ".badge",
  reset: 'button:has-text("Reset Journey")',
  gpsBtn: 'button:has-text("Use Current GPS")',
  detect: 'button:has-text("Detect My Location")',
  useThis: 'button:has-text("Use This Location")',
  bike: 'button[aria-pressed]:has-text("Bike")',
  car: 'button[aria-pressed]:has-text("Car")',
  bus: 'button[aria-pressed]:has-text("Bus/Metro")',
  logBtn: 'button:has-text("Log This Visit")',
  modes: '[aria-pressed]',
  recentTrips: 'text=RECENT TRIPS TODAY',
  addBill: 'button:has-text("Add bill")',
  miscEmp: "#misc-emp",
};

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({
    args: ["--force-color-profile=srgb", "--disable-lcd-text", "--hide-scrollbars"],
  });
  const { page } = await openApp(browser);

  // ── 1 / 2 — app opens, the three tabs ─────────────────────────────
  console.log("\n▶ open — app launch & tabs");
  await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
  await shoot(page, "open-home", {
    header: S.header, nav: S.nav, emp: S.emp,
    tabCheckIn: S.tabCheckIn, tabAdmin: S.tabAdmin, tabSettings: S.tabSettings,
    card: ".card",
  }, "Check In page as it first appears");

  // ── 3 — choose your name ──────────────────────────────────────────
  console.log("\n▶ name — employee picker");
  await page.click(S.emp);
  await shoot(page, "name-open", { list: S.list, search: S.search, emp: S.emp }, "full staff list");
  await typeSequence(page, "name-type", S.search, "bharat");
  await shoot(page, "name-match", { option: S.option, list: S.list }, "match found");
  await page.click(S.option);
  await settle(page, 900);
  await shoot(page, "name-chosen", { emp: S.emp, tripBadge: S.tripBadge }, "name selected");

  // ── 4 — location picker + trip 1 starts at head office ────────────
  console.log("\n▶ location — destination picker");
  await shoot(page, "loc-trip1", {
    tripBadge: S.tripBadge, dest: S.dest, reset: S.reset,
    startPoint: 'text=STARTING POINT',
  }, "Trip 1 — starts at Head Office");
  await page.click(S.dest);
  await shoot(page, "loc-open", { list: S.list, search: S.search }, "all sites listed");
  await typeSequence(page, "loc-type", S.search, "soni");
  await page.click(S.option);
  await settle(page, 1600);
  await shoot(page, "loc-picked", { dest: S.dest, tripBadge: S.tripBadge }, "destination chosen");

  // ── 5 — GPS fallback ──────────────────────────────────────────────
  console.log("\n▶ gps — location by GPS");
  await page.click(S.gpsBtn);
  await settle(page, 400);
  await shoot(page, "gps-panel", { gpsBtn: S.gpsBtn, detect: S.detect }, "GPS panel open");
  await page.click(S.detect);
  await page.waitForSelector(S.useThis, { timeout: 25000 }).catch(() => {});
  await settle(page, 700);
  await shoot(page, "gps-detected", {
    useThis: S.useThis, detected: 'text=Detected address',
  }, "address detected from GPS");
  // Close the panel again — the tutorial continues with the site chosen above.
  await page.click(S.gpsBtn);
  await settle(page, 400);

  // ── 6 — transport modes ───────────────────────────────────────────
  console.log("\n▶ transport — mode of travel");
  const modesBox = await page.locator(S.bike).boundingBox();
  await scrollSequence(page, "trans-scroll", Math.max(0, (modesBox?.y ?? 0) + await page.evaluate(() => window.scrollY) - 300), 10);
  await shoot(page, "trans-bike", { bike: S.bike, car: S.car, bus: S.bus, modes: S.modes }, "Bike selected (₹4/km)");
  await page.click(S.car);
  await settle(page, 900);
  await shoot(page, "trans-car", { bike: S.bike, car: S.car, bus: S.bus }, "Car selected (₹11/km)");
  await page.click(S.bus);
  await settle(page, 900);
  await shoot(page, "trans-bus", { bike: S.bike, car: S.car, bus: S.bus }, "Bus/Metro selected (₹3/km)");
  await page.click(S.bike);
  await settle(page, 1500);
  await shoot(page, "trans-back-bike", { bike: S.bike, logBtn: S.logBtn }, "back to Bike");

  // ── 7 — log the visit ─────────────────────────────────────────────
  console.log("\n▶ log — logging trip 1");
  await shoot(page, "log-ready", { logBtn: S.logBtn }, "Log This Visit, estimate visible");
  await logVisit(page);
  await shoot(page, "log-done", {
    msg: 'text=/Trip \\d+ logged/', tripBadge: S.tripBadge,
  }, "trip 1 logged, now on Trip 2");

  // ── 8 — the chain: trip 2 and trip 3 ──────────────────────────────
  console.log("\n▶ chain — trip 2 & 3 continue from the last stop");
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page, 400);
  await shoot(page, "chain-trip2", {
    tripBadge: S.tripBadge, startPoint: 'text=STARTING POINT', dest: S.dest,
  }, "Trip 2 — starting point carried over");
  await pickDestination(page, "adhikansh");
  await shoot(page, "chain-trip2-est", { dest: S.dest }, "trip 2 estimate");
  await logVisit(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page, 400);
  await shoot(page, "chain-trip3", {
    tripBadge: S.tripBadge, startPoint: 'text=STARTING POINT',
  }, "Trip 3 — chain continues");
  await pickDestination(page, "maini");
  await shoot(page, "chain-trip3-est", { dest: S.dest }, "trip 3 estimate");
  await logVisit(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page, 500);
  await shoot(page, "chain-trip4", { tripBadge: S.tripBadge, startPoint: 'text=STARTING POINT' }, "Trip 4 ready");

  // Trip timeline built up over the day.
  const trips = await page.locator(S.recentTrips).boundingBox();
  if (trips) {
    await scrollSequence(page, "chain-timeline", Math.round(trips.y + await page.evaluate(() => window.scrollY) - 220), 14,
      { recentTrips: S.recentTrips });
  }
  await shoot(page, "chain-timeline-end", { recentTrips: S.recentTrips }, "three trips, running total");

  // ── 9 — reset the journey ─────────────────────────────────────────
  console.log("\n▶ reset — restart the chain");
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page, 400);
  await shoot(page, "reset-before", { reset: S.reset, tripBadge: S.tripBadge, startPoint: 'text=STARTING POINT' },
    "before reset — starts at last stop");
  await page.click(S.reset);
  await settle(page, 1600);
  await shoot(page, "reset-after", { reset: S.reset, tripBadge: S.tripBadge, startPoint: 'text=STARTING POINT' },
    "after reset — back to Head Office");

  // ── 10 / 11 — today's summary + add bill ──────────────────────────
  console.log("\n▶ summary — today's totals & bills");
  const sum = await page.locator('text=TODAY\'S SUMMARY').boundingBox();
  const pageY = await page.evaluate(() => window.scrollY);
  await scrollSequence(page, "sum-scroll", Math.round((sum?.y ?? 0) + pageY - 140), 18,
    { summary: "text=TODAY'S SUMMARY" });
  await shoot(page, "sum-list", {
    summary: "text=TODAY'S SUMMARY",
    totalConv: "text=Total Conveyance",
    addBill: S.addBill,
  }, "per-trip breakdown");
  await scrollSequence(page, "sum-totals", await page.evaluate(() => document.body.scrollHeight), 14,
    { grand: "text=Grand Total" });
  await shoot(page, "sum-grand", { grand: "text=Grand Total", totalConv: "text=Total Conveyance" }, "Grand Total");
  const bill = await page.locator(S.addBill).first().boundingBox();
  if (bill) await shoot(page, "bill-control", { addBill: S.addBill }, "Add bill control");

  // ── 12 — miscellaneous expenses ───────────────────────────────────
  console.log("\n▶ misc — other expenses");
  const misc = await page.locator(S.miscEmp).boundingBox();
  const y2 = await page.evaluate(() => window.scrollY);
  await scrollSequence(page, "misc-scroll", Math.round((misc?.y ?? 0) + y2 - 220), 14, { miscEmp: S.miscEmp });
  await shoot(page, "misc-card", { miscEmp: S.miscEmp, title: "text=MISCELLANEOUS EXPENSES" }, "Miscellaneous card");
  await page.click(S.miscEmp);
  await shoot(page, "misc-emp-open", { list: S.list }, "pick your name here too");
  await page.fill(S.search, "bharat");
  await page.waitForSelector(S.option);
  await page.click(S.option);
  await settle(page, 900);
  await shoot(page, "misc-emp-chosen", { addBtn: 'button:has-text("Add Expense")' }, "name chosen");
  await page.click('button:has-text("Add Expense")');
  await settle(page, 500);
  await shoot(page, "misc-form", {
    category: 'select', amount: 'input[type="number"]',
  }, "expense form");
  await page.selectOption("select", "PARKING").catch(() => {});
  await page.fill('input[type="number"]', "40");
  await settle(page, 400);
  await shoot(page, "misc-filled", { amount: 'input[type="number"]' }, "parking ₹40 entered");

  // ── 13 — ending: back to the top of the Check In page ─────────────
  console.log("\n▶ ending — recap");
  await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
  await pickEmployee(page, "bharat");
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page, 600);
  await shoot(page, "end-home", {
    emp: S.emp, dest: S.dest, tripBadge: S.tripBadge, nav: S.nav,
  }, "final recap frame");

  await browser.close();
  writeFileSync(
    join(process.cwd(), "video", "build", "shots.json"),
    JSON.stringify({ viewport: VIEWPORT, dpr: DPR, shots }, null, 2),
  );
  console.log(`\n✔ ${shots.length} states captured → video/build/shots/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
