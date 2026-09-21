const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const probability = value => clamp(Number(value), 0.001, 0.999);
const logit = value => Math.log(probability(value) / (1 - probability(value)));
const sigmoid = value => 1 / (1 + Math.exp(-clamp(value, -30, 30)));
const brier = (rows, predict) => rows.length ? rows.reduce((sum, row) => sum + (predict(row) - row.outcome) ** 2, 0) / rows.length : null;
const logLoss = (rows, predict) => rows.length ? rows.reduce((sum, row) => {
  const p = probability(predict(row));
  return sum - row.outcome * Math.log(p) - (1 - row.outcome) * Math.log(1 - p);
}, 0) / rows.length : null;

export const ENGINE_VERSION = "ensemble-calibrated-v3";

export function marketFamily(key = "") {
  if (/^MATCH_/.test(key)) return "RESULT";
  if (/^DC_/.test(key)) return "DOUBLE_CHANCE";
  if (/^DNB_/.test(key)) return "DRAW_NO_BET";
  if (/^BTTS_/.test(key)) return "BTTS";
  if (/^(HOME|AWAY)_(OVER|UNDER)_/.test(key)) return "TEAM_TOTAL";
  if (/^(OVER|UNDER)_/.test(key)) return "TOTAL";
  if (/_(CLEAN|WIN_NIL)$/.test(key)) return "CLEAN_SHEET";
  if (/^HCP_/.test(key)) return "HANDICAP";
  if (/^ASIAN_/.test(key)) return "HANDICAP";
  if (/^HT_/.test(key)) return "FIRST_HALF";
  return "OTHER";
}

function applyPlatt(raw, profile) {
  if (!profile?.enabled) return probability(raw);
  return probability(sigmoid(profile.intercept + profile.slope * logit(raw)));
}

function solvePlatt(rows, regularization = 6) {
  let intercept = 0;
  let slope = 1;
  for (let iteration = 0; iteration < 40; iteration += 1) {
    let gradientA = regularization * intercept;
    let gradientB = regularization * (slope - 1);
    let hAA = regularization;
    let hAB = 0;
    let hBB = regularization;
    for (const row of rows) {
      const x = logit(row.probability);
      const fitted = sigmoid(intercept + slope * x);
      const error = fitted - row.outcome;
      const curvature = Math.max(1e-6, fitted * (1 - fitted));
      gradientA += error;
      gradientB += error * x;
      hAA += curvature;
      hAB += curvature * x;
      hBB += curvature * x * x;
    }
    const determinant = hAA * hBB - hAB * hAB;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-9) break;
    const stepA = (hBB * gradientA - hAB * gradientB) / determinant;
    const stepB = (-hAB * gradientA + hAA * gradientB) / determinant;
    intercept = clamp(intercept - stepA, -2.5, 2.5);
    slope = clamp(slope - stepB, 0.2, 2.5);
    if (Math.abs(stepA) + Math.abs(stepB) < 1e-7) break;
  }
  return { intercept, slope };
}

export function fitCalibration(rows, minimumSamples = 120) {
  const usable = rows.filter(row => Number.isFinite(row.probability) && (row.outcome === 0 || row.outcome === 1)).sort((a, b) => String(a.kickoff ?? "").localeCompare(String(b.kickoff ?? "")));
  const base = {
    enabled: false,
    samples: usable.length,
    intercept: 0,
    slope: 1,
    validationBrierRaw: null,
    validationBrierCalibrated: null,
    validationLogLossRaw: null,
    validationLogLossCalibrated: null,
    validationGain: 0,
  };
  if (usable.length < minimumSamples) return base;
  const split = Math.max(minimumSamples, Math.floor(usable.length * 0.75));
  if (split >= usable.length - 20) return base;
  const training = usable.slice(0, split);
  const validation = usable.slice(split);
  const candidate = solvePlatt(training);
  const rawBrier = brier(validation, row => probability(row.probability));
  const calibratedBrier = brier(validation, row => applyPlatt(row.probability, { ...candidate, enabled: true }));
  const rawLogLoss = logLoss(validation, row => probability(row.probability));
  const calibratedLogLoss = logLoss(validation, row => applyPlatt(row.probability, { ...candidate, enabled: true }));
  const validationGain = Number(rawBrier) - Number(calibratedBrier);
  const improves = validationGain >= 0.00015 && Number(calibratedLogLoss) <= Number(rawLogLoss) + 0.001;
  if (!improves) return { ...base, validationBrierRaw: rawBrier, validationBrierCalibrated: calibratedBrier, validationLogLossRaw: rawLogLoss, validationLogLossCalibrated: calibratedLogLoss, validationGain };
  const fitted = solvePlatt(usable);
  return {
    enabled: true,
    samples: usable.length,
    ...fitted,
    validationBrierRaw: rawBrier,
    validationBrierCalibrated: calibratedBrier,
    validationLogLossRaw: rawLogLoss,
    validationLogLossCalibrated: calibratedLogLoss,
    validationGain,
  };
}

function blendProbability(row, weight) {
  return probability(row.marketProbability * (1 - weight) + row.modelProbability * weight);
}

export function fitMarketBlend(rows, minimumSamples = 100) {
  const usable = rows.filter(row => Number.isFinite(row.modelProbability) && Number.isFinite(row.marketProbability) && (row.outcome === 0 || row.outcome === 1)).sort((a, b) => String(a.kickoff ?? "").localeCompare(String(b.kickoff ?? "")));
  const base = { enabled: false, samples: usable.length, modelWeight: 0, validationBrierMarket: null, validationBrierBlend: null, validationGain: 0 };
  if (usable.length < minimumSamples) return base;
  const split = Math.max(minimumSamples, Math.floor(usable.length * 0.75));
  if (split >= usable.length - 20) return base;
  const training = usable.slice(0, split);
  const validation = usable.slice(split);
  let weight = 0;
  let best = Infinity;
  // A structural model may adjust the efficient market, but it never receives
  // more than 40% of the final probability without stronger forward evidence.
  for (let candidate = 0; candidate <= 0.4001; candidate += 0.025) {
    const score = brier(training, row => blendProbability(row, candidate));
    if (Number(score) < best) { best = Number(score); weight = Number(candidate.toFixed(3)); }
  }
  const marketBrier = brier(validation, row => probability(row.marketProbability));
  const blendBrier = brier(validation, row => blendProbability(row, weight));
  const validationGain = Number(marketBrier) - Number(blendBrier);
  if (weight === 0 || validationGain < 0.0001) return { ...base, validationBrierMarket: marketBrier, validationBrierBlend: blendBrier, validationGain };
  return { enabled: true, samples: usable.length, modelWeight: weight, validationBrierMarket: marketBrier, validationBrierBlend: blendBrier, validationGain };
}

export function buildEngineParameters(calibrationRows, priceRows = [], generatedAt = new Date().toISOString()) {
  const byMarket = new Map();
  for (const row of calibrationRows) byMarket.set(row.key, [...(byMarket.get(row.key) ?? []), row]);
  const markets = Object.fromEntries([...byMarket.entries()].map(([key, rows]) => [key, fitCalibration(rows)]));

  // League adjustments are learned after the global market calibration. This
  // is hierarchical pooling: small leagues inherit the global model instead
  // of inventing unstable parameters from a few matches.
  const byLeagueFamily = new Map();
  for (const row of calibrationRows) {
    const globallyCalibrated = applyPlatt(row.probability, markets[row.key]);
    const id = `${row.leagueId ?? "football"}:${row.key}`;
    byLeagueFamily.set(id, [...(byLeagueFamily.get(id) ?? []), { ...row, probability: globallyCalibrated }]);
  }
  const leagues = Object.fromEntries([...byLeagueFamily.entries()].map(([key, rows]) => [key, fitCalibration(rows, 180)]));

  const byPriceFamily = new Map();
  for (const row of priceRows) {
    const id = marketFamily(row.key);
    byPriceFamily.set(id, [...(byPriceFamily.get(id) ?? []), row]);
  }
  const marketBlends = Object.fromEntries([...byPriceFamily.entries()].map(([key, rows]) => [key, fitMarketBlend(rows)]));
  return {
    version: ENGINE_VERSION,
    generatedAt,
    methodology: "Walk-forward Platt calibration with hierarchical league shrinkage and out-of-sample bookmaker-blend selection.",
    calibrationRows: calibrationRows.length,
    priceRows: priceRows.length,
    markets,
    leagues,
    marketBlends,
  };
}

export function calibratePrediction(raw, key, leagueId, parameters) {
  const globalProfile = parameters?.version === ENGINE_VERSION ? parameters.markets?.[key] : null;
  const globalProbability = applyPlatt(raw, globalProfile);
  const leagueProfile = parameters?.version === ENGINE_VERSION ? parameters.leagues?.[`${leagueId ?? "football"}:${key}`] : null;
  const calibrated = applyPlatt(globalProbability, leagueProfile);
  return {
    probability: calibrated,
    calibrated: Boolean(globalProfile?.enabled || leagueProfile?.enabled),
    calibrationSamples: Math.max(Number(globalProfile?.samples ?? 0), Number(leagueProfile?.samples ?? 0)),
    calibrationGain: Number(globalProfile?.validationGain ?? 0) + Number(leagueProfile?.validationGain ?? 0),
  };
}

export function modelBlendWeight(key, dataQuality, parameters) {
  const learned = parameters?.version === ENGINE_VERSION ? parameters.marketBlends?.[marketFamily(key)] : null;
  if (learned?.enabled) return { weight: learned.modelWeight, learned: true, samples: learned.samples, validationGain: learned.validationGain };
  const calibrated = parameters?.version === ENGINE_VERSION ? parameters.markets?.[key] : null;
  const quality = clamp(Number(dataQuality ?? 0), 0, 1);
  // Unpriced historical markets use a deliberately small contribution. A
  // validated calibrated model may contribute more, never enough to dominate.
  const weight = calibrated?.enabled ? 0.12 + quality * 0.13 : 0.05 + quality * 0.05;
  return { weight, learned: false, samples: Number(calibrated?.samples ?? 0), validationGain: Number(calibrated?.validationGain ?? 0) };
}
