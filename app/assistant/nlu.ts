import type { ProviderId } from "../builder/providers";

export type AssistantIntent =
  | { kind: "build"; confidence: number; targetOdds: number | null; provider: ProviderId | null }
  | { kind: "split"; confidence: number; targetOdds: number | null; parts: number | null; provider: ProviderId | null }
  | { kind: "convert"; confidence: number; code: string | null; sourceProvider: ProviderId | null; destinationProvider: ProviderId | null }
  | { kind: "best"; confidence: number; provider: ProviderId | null }
  | { kind: "daily"; confidence: number }
  | { kind: "results"; confidence: number }
  | { kind: "unknown"; confidence: number };

const providerAliases: Array<{ id: ProviderId; aliases: string[] }> = [
  { id: "sportybet", aliases: ["sportybet", "sporty bet", "sporty"] },
  { id: "betpawa", aliases: ["betpawa", "bet pawa", "pawa"] },
  { id: "betway", aliases: ["betway", "bet way"] },
  { id: "betking", aliases: ["betking", "bet king", "king"] },
  { id: "bet9ja", aliases: ["bet9ja", "bet 9ja", "9ja"] },
];

const examples = {
  build: [
    "give me 20 odds for sporty", "build 10 odds on betpawa", "i need 50 odds betway",
    "abeg find me 5 odds for sporty", "make booking code of 100 odds", "create a bet for betking",
    "i want twenty odds", "help me arrange 30 odd", "generate sporty games for me",
  ],
  split: [
    "split 100 odds into 3 sporty codes", "divide my odds into tickets", "break 50 odds into two slips",
    "share the games across four betpawa codes", "separate this bet into smaller booking codes",
  ],
  convert: [
    "convert this sporty code to betpawa", "change betway booking code to sporty", "turn this code into betking",
    "move my bet code from sporty to pawa", "convert booking number", "carry this code go another bookmaker",
  ],
  best: [
    "show me the best bet", "what is the safest match", "give me your strongest pick",
    "best game today", "which prediction is most reliable", "show top bets",
  ],
  daily: [
    "show daily odds", "today's tickets", "give me the daily accumulator",
    "what odds are available today", "show two odds and five odds", "today betting slips",
  ],
  results: [
    "show recent results", "how did the predictions perform", "which tickets won",
    "show settled bets", "check yesterday results", "did the last odds win",
  ],
} as const;

function normalize(value: string) {
  return value.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9.]+/g, " ").trim();
}

function features(value: string) {
  const normalized = ` ${normalize(value)} `;
  const result = new Map<string, number>();
  for (const word of normalized.trim().split(/\s+/)) {
    if (word.length > 1) result.set(`w:${word}`, (result.get(`w:${word}`) ?? 0) + 1.8);
  }
  for (let index = 0; index <= normalized.length - 3; index += 1) {
    const gram = normalized.slice(index, index + 3);
    result.set(`c:${gram}`, (result.get(`c:${gram}`) ?? 0) + .22);
  }
  return result;
}

function cosine(left: Map<string, number>, right: Map<string, number>) {
  let dot = 0; let normLeft = 0; let normRight = 0;
  for (const value of left.values()) normLeft += value * value;
  for (const value of right.values()) normRight += value * value;
  for (const [key, value] of left) dot += value * (right.get(key) ?? 0);
  return normLeft && normRight ? dot / Math.sqrt(normLeft * normRight) : 0;
}

const exampleFeatures = Object.fromEntries(Object.entries(examples).map(([intent, rows]) => [intent, rows.map(features)])) as Record<keyof typeof examples, Array<Map<string, number>>>;

function intentScores(input: string) {
  const vector = features(input);
  return Object.fromEntries(Object.entries(exampleFeatures).map(([intent, rows]) => [intent, Math.max(...rows.map((row) => cosine(vector, row)))])) as Record<keyof typeof examples, number>;
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      previous[rightIndex] = Math.min(previous[rightIndex] + 1, previous[rightIndex - 1] + 1, diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[right.length];
}

function mentionedProviders(input: string) {
  const text = normalize(input);
  return providerAliases.flatMap((provider) => {
    const positions = provider.aliases.map((alias) => text.indexOf(alias)).filter((position) => position >= 0);
    if (positions.length) return [{ id: provider.id, position: Math.min(...positions) }];
    const tokens = text.split(/\s+/);
    for (let index = 0; index < tokens.length; index += 1) {
      for (const alias of provider.aliases.filter((item) => !item.includes(" ") && item.length >= 5)) {
        if (editDistance(tokens[index], alias) <= (alias.length >= 8 ? 2 : 1)) return [{ id: provider.id, position: text.indexOf(tokens[index]) }];
      }
    }
    return [];
  }).sort((left, right) => left.position - right.position);
}

function extractCode(input: string) {
  const candidates = input.toUpperCase().match(/\b[A-Z0-9]{4,16}\b/g) ?? [];
  return candidates.find((candidate) => /[A-Z]/.test(candidate) && /\d/.test(candidate) && !providerAliases.some((provider) => provider.aliases.some((alias) => normalize(alias).replaceAll(" ", "") === candidate.toLowerCase()))) ?? null;
}

function extractNumbers(input: string) {
  const text = normalize(input);
  const numeric = [...text.matchAll(/\b(\d+(?:\.\d+)?)\b/g)].map((match) => ({ value: Number(match[1]), index: match.index ?? 0 }));
  const units: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const tokens = text.split(/\s+/);
  for (let index = 0; index < tokens.length; index += 1) {
    if (units[tokens[index]] == null) continue;
    let value = units[tokens[index]];
    let consumed = 1;
    if (value >= 20 && units[tokens[index + 1]] > 0 && units[tokens[index + 1]] < 10) { value += units[tokens[index + 1]]; consumed += 1; }
    const scale = tokens[index + consumed] === "hundred" ? 100 : tokens[index + consumed] === "thousand" ? 1000 : 1;
    if (scale > 1) value *= scale;
    numeric.push({ value, index: text.indexOf(tokens[index]) });
  }
  return numeric.sort((left, right) => left.index - right.index);
}

function extractParts(input: string) {
  const text = normalize(input);
  const numeric = text.match(/(?:into|across|to)\s+(\d+)(?:\s+[a-z0-9]+){0,3}\s+(?:slips?|tickets?|codes?|parts?)/)?.[1]
    ?? text.match(/(\d+)\s+(?:separate|smaller)\s+(?:slips?|tickets?|codes?)/)?.[1];
  if (numeric) return Math.max(2, Math.min(10, Number(numeric)));
  const words: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6 };
  for (const [word, value] of Object.entries(words)) {
    if (new RegExp(`(?:into|across|to) ${word} (?:slips?|tickets?|codes?|parts?)`).test(text)) return value;
  }
  return null;
}

function extractTarget(input: string, parts: number | null) {
  const numbers = extractNumbers(input).filter((item) => item.value >= 1.2);
  if (!numbers.length) return null;
  if (parts != null) {
    const nonParts = numbers.find((item) => item.value !== parts);
    if (nonParts) return nonParts.value;
  }
  return numbers[0].value;
}

function conversionProviders(input: string, providers: ReturnType<typeof mentionedProviders>) {
  const text = normalize(input);
  let sourceProvider: ProviderId | null = null;
  let destinationProvider: ProviderId | null = null;
  for (const provider of providers) {
    const before = text.slice(Math.max(0, provider.position - 8), provider.position);
    if (/\b(from|on)\s*$/.test(before)) sourceProvider = provider.id;
    if (/\b(to|into|for)\s*$/.test(before)) destinationProvider = provider.id;
  }
  if (providers.length >= 2) {
    sourceProvider ??= providers[0].id;
    destinationProvider ??= providers.find((provider) => provider.id !== sourceProvider)?.id ?? null;
  } else if (providers.length === 1) {
    if (/\b(to|into)\b/.test(text.slice(0, providers[0].position))) destinationProvider = providers[0].id;
    else if (/\bcode\b/.test(text.slice(providers[0].position))) sourceProvider = providers[0].id;
    else destinationProvider = providers[0].id;
  }
  return { sourceProvider, destinationProvider };
}

export function interpretAssistantRequest(input: string): AssistantIntent {
  const text = normalize(input);
  if (!text) return { kind: "unknown", confidence: 0 };
  const scores = intentScores(text);
  const providers = mentionedProviders(text);
  const code = extractCode(input);
  const parts = extractParts(text);
  const hasSplitLanguage = /\b(split|divide|break|separate|smaller|across)\b/.test(text);
  const hasConversionLanguage = /\b(convert|change|move|transfer|translate|turn)\b/.test(text);
  const hasBuildLanguage = /\b(odds?|bet|slip|ticket|games?|matches?|booking)\b/.test(text);

  if (hasConversionLanguage || (code && providers.length > 0) || scores.convert >= .56) {
    const routes = conversionProviders(text, providers);
    return { kind: "convert", confidence: Math.min(1, scores.convert + (code ? .22 : 0) + (hasConversionLanguage ? .18 : 0)), code, ...routes };
  }
  if (hasSplitLanguage || parts || scores.split >= .62) {
    return { kind: "split", confidence: Math.min(1, scores.split + (hasSplitLanguage ? .2 : 0)), targetOdds: extractTarget(text, parts), parts, provider: providers[0]?.id ?? null };
  }
  if (scores.best >= .58 || /\b(best|safest|strongest|strong|reliable|top)\b/.test(text)) {
    return { kind: "best", confidence: Math.min(1, scores.best + .18), provider: providers[0]?.id ?? null };
  }
  if (scores.daily >= .6 || /\bdaily\b|\btoday.?s?(?:\s+[a-z]+){0,2}\s+(?:odds|tickets|slips)\b|\bready made (?:tickets|slips)\b/.test(text)) {
    return { kind: "daily", confidence: Math.min(1, scores.daily + .18) };
  }
  if (scores.results >= .58 || /\b(results?|settled|won|lost|performance|hit rate)\b/.test(text)) {
    return { kind: "results", confidence: Math.min(1, scores.results + .18) };
  }
  const targetOdds = extractTarget(text, null);
  if (hasBuildLanguage || targetOdds || providers.length || scores.build >= .43) {
    return { kind: "build", confidence: Math.min(1, scores.build + (targetOdds ? .18 : 0) + (providers.length ? .12 : 0)), targetOdds, provider: providers[0]?.id ?? null };
  }
  return { kind: "unknown", confidence: Math.max(...Object.values(scores)) };
}
