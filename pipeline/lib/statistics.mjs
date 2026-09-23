const round = (value, digits = 6) => Number(value.toFixed(digits));

export function rankedProbabilityScore(probabilities, actualIndex) {
  if (!Array.isArray(probabilities) || probabilities.length < 2 || actualIndex < 0 || actualIndex >= probabilities.length) return null;
  let score = 0;
  for (let index = 0; index < probabilities.length - 1; index++) {
    const predicted = probabilities.slice(0, index + 1).reduce((sum, value) => sum + value, 0);
    const observed = actualIndex <= index ? 1 : 0;
    score += (predicted - observed) ** 2;
  }
  return score / (probabilities.length - 1);
}

export function wilsonInterval(wins, total, z = 1.959964) {
  if (!Number.isFinite(wins) || !Number.isFinite(total) || total <= 0) return null;
  const rate = wins / total;
  const denominator = 1 + (z ** 2) / total;
  const centre = (rate + (z ** 2) / (2 * total)) / denominator;
  const margin = z * Math.sqrt((rate * (1 - rate) + (z ** 2) / (4 * total)) / total) / denominator;
  return { low: round(Math.max(0, centre - margin)), high: round(Math.min(1, centre + margin)) };
}

export function bootstrapMeanInterval(values, { iterations = 2000, seed = 20260923 } = {}) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < 2) return null;
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const means = [];
  for (let iteration = 0; iteration < iterations; iteration++) {
    let sum = 0;
    for (let index = 0; index < clean.length; index++) sum += clean[Math.floor(random() * clean.length)];
    means.push(sum / clean.length);
  }
  means.sort((a, b) => a - b);
  return {
    low: round(means[Math.floor(iterations * .025)]),
    high: round(means[Math.min(iterations - 1, Math.ceil(iterations * .975) - 1)]),
  };
}
