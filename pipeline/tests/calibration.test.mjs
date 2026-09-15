import assert from "node:assert/strict";
import test from "node:test";
import { ENGINE_VERSION, buildEngineParameters, calibratePrediction, fitCalibration, fitMarketBlend, modelBlendWeight } from "../lib/calibration.mjs";
import { assertSourceAuthorized } from "../lib/source-policy.mjs";

const rows = (count, probability, winEvery, key = "MATCH_HOME", leagueId = "league") => Array.from({ length: count }, (_, index) => ({
  key,
  leagueId,
  kickoff: new Date(Date.UTC(2020, 0, index + 1)).toISOString(),
  probability,
  outcome: index % winEvery === 0 ? 1 : 0,
}));

test("walk-forward calibration corrects a persistently overconfident market", () => {
  const profile = fitCalibration(rows(320, .8, 2));
  assert.equal(profile.enabled, true);
  assert.ok(profile.validationBrierCalibrated < profile.validationBrierRaw);
  const parameters = buildEngineParameters(rows(320, .8, 2));
  const calibrated = calibratePrediction(.8, "MATCH_HOME", "league", parameters);
  assert.equal(parameters.version, ENGINE_VERSION);
  assert.equal(calibrated.calibrated, true);
  assert.ok(calibrated.probability < .8);
});

test("market blending gives a harmful structural model zero influence", () => {
  const samples = Array.from({ length: 320 }, (_, index) => ({
    key: "MATCH_HOME",
    kickoff: new Date(Date.UTC(2020, 0, index + 1)).toISOString(),
    marketProbability: index % 2 ? .2 : .8,
    modelProbability: index % 2 ? .8 : .2,
    outcome: index % 2 ? 0 : 1,
  }));
  const profile = fitMarketBlend(samples);
  assert.equal(profile.enabled, false);
  assert.equal(profile.modelWeight, 0);
});

test("unvalidated markets remain a small adjustment rather than dominating prices", () => {
  const blend = modelBlendWeight("BTTS_YES", 1, { version: ENGINE_VERSION, markets: {}, marketBlends: {} });
  assert.equal(blend.learned, false);
  assert.ok(blend.weight <= .1);
});

test("restricted historical sources require an explicit recorded authorization", () => {
  const policy = { sources: { "football-data.co.uk": { status: "owner-confirmed", permittedUses: ["historical-training"] } } };
  assert.equal(assertSourceAuthorized(policy, "football-data.co.uk", "historical-training").status, "owner-confirmed");
  assert.throws(() => assertSourceAuthorized(policy, "thestatsapi.com", "historical-training"), /not authorized/);
});
