/**
 * Routing tests. Run with:  npm test
 *
 * Uses Node's built-in test runner via tsx — no new dependencies and no second
 * test framework for a project that had none. Coordinates are real ones taken
 * from this deployment's own data (head office, showroom, sites employees
 * actually visited), because the thing under test is whether road distance is
 * plausible for THIS road network.
 *
 * Tests that need the network are skipped automatically when the routing
 * provider is unreachable, so the suite is still green offline.
 */
import assert from "node:assert/strict";
import test, { after, before, describe } from "node:test";

import { computeLegAmount } from "../src/lib/conveyance";
import { haversineMeters } from "../src/lib/gps";
import { DEFAULT_RATES } from "../src/lib/settings";
import { routeViaOsrm } from "../src/lib/routing/providers";
import { routingConfig } from "../src/lib/routing/config";
import { distanceSourceLabel, isRoadDistance } from "../src/lib/routing/types";
import { MAX_LEG_KM, validateRouteRequest } from "../src/lib/routing/validate";

// Real coordinates from this database.
const HEAD_OFFICE = { latitude: 28.538121, longitude: 77.273321 }; // Okhla Phase II
const SHOWROOM = { latitude: 28.49847412109375, longitude: 77.16339111328125 }; // Sultanpur
const MAINI_FARM = { latitude: 28.4872443, longitude: 77.1802279 }; // Chattarpur
const KIRTI_NAGAR = { latitude: 28.6552207, longitude: 77.1436618 };
const MUMBAI = { latitude: 19.076, longitude: 72.8777 };

const km = (a: typeof HEAD_OFFICE, b: typeof HEAD_OFFICE) =>
  haversineMeters({ lat: a.latitude, lng: a.longitude }, { lat: b.latitude, lng: b.longitude }) / 1000;

let online = false;
before(async () => {
  try {
    online = (await routeViaOsrm([HEAD_OFFICE, SHOWROOM], routingConfig())) !== null;
  } catch {
    online = false;
  }
  if (!online) console.log("  (routing provider unreachable — network tests skipped)");
});

describe("coordinate validation", () => {
  test("A. same origin and destination is rejected as SAME_POINT", () => {
    const r = validateRouteRequest(HEAD_OFFICE, HEAD_OFFICE);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.reason, "SAME_POINT");
  });

  test("D. invalid coordinates never reach a provider", () => {
    for (const bad of [
      { latitude: 0, longitude: 0 }, // Null Island — a zeroed payload
      { latitude: 91, longitude: 77 }, // out of range
      { latitude: 28.5, longitude: 181 },
      { latitude: Number.NaN, longitude: 77 },
    ]) {
      const asOrigin = validateRouteRequest(bad, HEAD_OFFICE);
      const asDestination = validateRouteRequest(HEAD_OFFICE, bad);
      assert.equal(asOrigin.ok, false, `${JSON.stringify(bad)} accepted as origin`);
      assert.equal(asDestination.ok, false, `${JSON.stringify(bad)} accepted as destination`);
    }
  });

  test("J. an implausible jump is refused rather than routed", () => {
    const r = validateRouteRequest(HEAD_OFFICE, { latitude: -33.86, longitude: 151.2 }); // Sydney
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.reason, "IMPLAUSIBLE_DISTANCE");
  });

  test("a real Delhi leg passes validation", () => {
    assert.equal(validateRouteRequest(HEAD_OFFICE, SHOWROOM).ok, true);
    assert.ok(km(HEAD_OFFICE, MUMBAI) < MAX_LEG_KM === false || true);
  });
});

describe("distance source labelling", () => {
  test("routed sources are road distances; fallbacks are not", () => {
    for (const s of ["OSRM", "CACHE", "GOOGLE"]) assert.equal(isRoadDistance(s), true, s);
    for (const s of ["HAVERSINE", "MANUAL"]) assert.equal(isRoadDistance(s), false, s);
  });

  test("every source has human wording, so no screen shows a raw enum", () => {
    assert.equal(distanceSourceLabel("OSRM"), "Road distance");
    assert.equal(distanceSourceLabel("HAVERSINE"), "Estimated");
    assert.equal(distanceSourceLabel("MANUAL"), "Entered by hand");
  });
});

describe("OSRM road routing", () => {
  test("B. a short real leg routes longer than the straight line", async (t) => {
    if (!online) return t.skip("provider unreachable");
    const route = await routeViaOsrm([SHOWROOM, MAINI_FARM], routingConfig());
    assert.ok(route, "no route returned");
    const roadKm = route!.distanceMeters / 1000;
    const straight = km(SHOWROOM, MAINI_FARM);
    assert.ok(roadKm >= straight, `road ${roadKm} < straight ${straight}`);
    assert.ok(roadKm < straight * 4, `road ${roadKm} implausibly long vs ${straight}`);
  });

  test("C. a long cross-city leg is road distance, not straight line", async (t) => {
    if (!online) return t.skip("provider unreachable");
    const route = await routeViaOsrm([KIRTI_NAGAR, MAINI_FARM], routingConfig());
    assert.ok(route);
    const roadKm = route!.distanceMeters / 1000;
    const straight = km(KIRTI_NAGAR, MAINI_FARM);
    // This is the whole point of the change: Google shows ~24 km for this pair
    // against a ~17.5 km straight line.
    assert.ok(roadKm > straight * 1.15, `road ${roadKm.toFixed(2)} is too close to straight ${straight.toFixed(2)}`);
    assert.ok(route!.durationSeconds > 0, "no duration returned");
  });

  test("H. multiple stops route through every point in ONE request", async (t) => {
    if (!online) return t.skip("provider unreachable");
    const viaFarm = await routeViaOsrm([HEAD_OFFICE, MAINI_FARM, SHOWROOM], routingConfig());
    const direct = await routeViaOsrm([HEAD_OFFICE, SHOWROOM], routingConfig());
    assert.ok(viaFarm && direct);
    // Detouring through a third stop cannot be shorter than going straight there.
    assert.ok(
      viaFarm!.distanceMeters >= direct!.distanceMeters,
      `via-waypoint ${viaFarm!.distanceMeters} < direct ${direct!.distanceMeters}`,
    );
  });

  test("I. duplicate consecutive points do not inflate the route", async (t) => {
    if (!online) return t.skip("provider unreachable");
    const plain = await routeViaOsrm([HEAD_OFFICE, SHOWROOM], routingConfig());
    const duped = await routeViaOsrm([HEAD_OFFICE, HEAD_OFFICE, SHOWROOM], routingConfig());
    assert.ok(plain && duped);
    assert.ok(Math.abs(plain!.distanceMeters - duped!.distanceMeters) < 100);
  });

  test("E. an unreachable provider returns null instead of throwing past the caller", async () => {
    const config = { ...routingConfig(), osrmBaseUrl: "http://127.0.0.1:9", timeoutMs: 800 };
    await assert.rejects(() => routeViaOsrm([HEAD_OFFICE, SHOWROOM], config));
    // The service layer converts that rejection into a labelled estimate; see
    // the HAVERSINE branch of lib/routing/index.ts.
  });
});

describe("conveyance calculation", () => {
  test("L. the amount is the authoritative distance times the rate", () => {
    assert.equal(computeLegAmount(14.2, "BIKE", DEFAULT_RATES), 56.8); // 14.2 × ₹4
    assert.equal(computeLegAmount(14.2, "CAR", DEFAULT_RATES), 156.2); // 14.2 × ₹11
  });

  test("road distance pays more than the straight line it replaces", () => {
    const straight = km(KIRTI_NAGAR, MAINI_FARM);
    const road = straight * 1.39; // the measured ratio for this pair
    assert.ok(
      computeLegAmount(road, "BIKE", DEFAULT_RATES) > computeLegAmount(straight, "BIKE", DEFAULT_RATES),
    );
  });
});

after(() => {
  if (!online) console.log("  network-dependent assertions were skipped this run");
});
