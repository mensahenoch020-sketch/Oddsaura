import type { ProviderId } from "../builder/providers";
import type { LeagueFilter } from "../leagues";

export const ASSISTANT_TIME_ZONE = "Africa/Lagos";

export type DateWindow = {
  kind: "TODAY" | "TOMORROW" | "DAY" | "WEEK" | "WEEKEND" | "NEXT_DAYS" | "MONTH" | "YEAR" | "TIME";
  label: string;
  start: string;
  end: string;
};

type RequestContext = {
  dateWindow: DateWindow | null;
  marketKeys?: string[];
  leagueFilters?: LeagueFilter[];
};

export type RecommendationStrategy = "protection" | "value";

export type AssistantIntent =
  | { kind: "build"; confidence: number; targetOdds: number | null; provider: ProviderId | null } & RequestContext
  | { kind: "split"; confidence: number; code: string | null; targetOdds: number | null; parts: number | null; provider: ProviderId | null } & RequestContext
  | { kind: "convert"; confidence: number; code: string | null; sourceProvider: ProviderId | null; destinationProvider: ProviderId | null; allDestinations: boolean }
  | { kind: "textCode"; confidence: number; text: string; provider: ProviderId | null }
  | { kind: "analyze"; confidence: number; code: string | null; provider: ProviderId | null }
  | { kind: "explain"; confidence: number; subject: string }
  | { kind: "revise"; confidence: number; action: "safer" | "remove" | "replace" | "riskiest" | "safest"; subject: string }
  | { kind: "match"; confidence: number; homeTeam: string; awayTeam: string; provider: ProviderId | null }
  | { kind: "help"; confidence: number }
  | { kind: "limits"; confidence: number; subject: string }
  | { kind: "best"; confidence: number; provider: ProviderId | null; strategy: RecommendationStrategy } & RequestContext
  | { kind: "allPicks"; confidence: number; provider: ProviderId | null; strategy: RecommendationStrategy } & RequestContext
  | { kind: "daily"; confidence: number; provider: ProviderId | null; strategy: RecommendationStrategy } & RequestContext
  | { kind: "fixtures"; confidence: number; provider: ProviderId | null } & RequestContext
  | { kind: "confirm"; confidence: number }
  | { kind: "results"; confidence: number } & RequestContext
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
  return value.toLowerCase().replace(/\btoday[’']s\b/g, "today").replace(/[’']/g, "").replace(/[^a-z0-9.:\/-]+/g, " ").trim();
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
  const excluded = new Set('convert conversion transfer move from into code codes booking sporty sportybet betway betpawa betking bet9ja please this that give odds today tomorrow btts dnb gg ng epl'.split(' '));
  const valid = (candidate: string) => !excluded.has(candidate.toLowerCase()) && !providerAliases.some(provider => provider.aliases.some(alias => normalize(alias).replaceAll(' ', '') === candidate.toLowerCase()));
  const mixed = candidates.find(candidate => /[A-Z]/.test(candidate) && /\d/.test(candidate) && valid(candidate));
  if (mixed) return mixed;
  // Real share codes can contain letters only. Prefer explicitly labelled codes,
  // otherwise accept uppercase tokens rather than ordinary words in the request.
  const explicit = input.match(/\b(?:booking\s+code|code)\s*[:#]?\s*([a-z0-9]{4,16})\b/i)?.[1];
  if (explicit && valid(explicit)) return explicit.toUpperCase();
  return (input.match(/\b[A-Z]{4,16}\b/g) ?? []).find(valid) ?? null;
}

function extractNumbers(input: string) {
  const text = normalize(input.replace(/(\d),(?=\d{3}\b)/g, "$1"));
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
    ?? text.match(/(\d+)\s+(?:separate|smaller)\s+(?:slips?|tickets?|codes?)/)?.[1]
    ?? text.match(/\b(?:split|divide|break|separate)\b.*?\b(?:into|across)\s+(\d+)\b/)?.[1];
  if (numeric) return Math.max(2, Math.min(10, Number(numeric)));
  const words: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6 };
  for (const [word, value] of Object.entries(words)) {
    if (new RegExp(`(?:into|across|to) ${word} (?:slips?|tickets?|codes?|parts?)`).test(text)) return value;
  }
  return null;
}

function extractTarget(input: string, parts: number | null) {
  const withoutDates = input
    .replace(/\b(?:next|coming)\s+(\d+|two|three|four|five|six|seven)\s+days?\b/g, " ")
    .replace(/\b(?:over|under)\s+\d+(?:\.\d+)?\b/g, " ")
    .replace(/\b20\d{2}[\/.\-]\d{1,2}[\/.\-]\d{1,2}\b/g, " ")
    .replace(/\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]20\d{2}\b/g, " ")
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\b(?:[01]?\d|2[0-3]):[0-5]\d\s*(?:am|pm)?\b/g, " ")
    .replace(/\b(?:1[0-2]|0?[1-9])\s*(?::[0-5]\d)?\s*(?:am|pm)\b/g, " ")
    .replace(/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+20\d{2})?\b/g, " ")
    .replace(/\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?(?:\s+20\d{2})?\b/g, " ");
  const numbers = extractNumbers(withoutDates).filter((item) => item.value >= 1.2);
  if (!numbers.length) return null;
  if (parts != null) {
    const nonParts = numbers.find((item) => item.value !== parts);
    if (nonParts) return nonParts.value;
  }
  return numbers[0].value;
}

const DAY_MS = 86_400_000;
const LAGOS_OFFSET_MS = 60 * 60_000;
const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function lagosDateParts(referenceTime: number) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ASSISTANT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
  }).formatToParts(referenceTime);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { year: Number(value("year")), month: Number(value("month")), day: Number(value("day")), weekday: value("weekday").toLowerCase() };
}

function lagosStart(year: number, month: number, day: number) {
  return Date.UTC(year, month - 1, day) - LAGOS_OFFSET_MS;
}

function dayWindow(timestamp: number, kind: DateWindow["kind"], label: string, days = 1): DateWindow {
  const date = new Date(timestamp + LAGOS_OFFSET_MS);
  const start = lagosStart(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  return { kind, label, start: new Date(start).toISOString(), end: new Date(start + days * DAY_MS).toISOString() };
}

function calendarDateWindow(year: number, month: number, day: number, label: string) {
  const timestamp = lagosStart(year, month, day);
  const date = new Date(timestamp + LAGOS_OFFSET_MS);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return dayWindow(timestamp, "DAY", label);
}

export function extractDateWindow(input: string, referenceTime = Date.now()): DateWindow | null {
  const text = normalize(input);
  const today = lagosDateParts(referenceTime);
  const todayStart = lagosStart(today.year, today.month, today.day);

  if (/\b(?:this|current) month\b/.test(text)) {
    const start = lagosStart(today.year, today.month, 1);
    const end = today.month === 12 ? lagosStart(today.year + 1, 1, 1) : lagosStart(today.year, today.month + 1, 1);
    return { kind: "MONTH", label: "this month", start: new Date(start).toISOString(), end: new Date(end).toISOString() };
  }
  if (/\b(?:this|current) year\b/.test(text)) {
    const start = lagosStart(today.year, 1, 1);
    return { kind: "YEAR", label: "this year", start: new Date(start).toISOString(), end: new Date(lagosStart(today.year + 1, 1, 1)).toISOString() };
  }
  const explicitIso = text.match(/\b(20\d{2})[\/.\-](\d{1,2})[\/.\-](\d{1,2})\b/);
  if (explicitIso) return calendarDateWindow(Number(explicitIso[1]), Number(explicitIso[2]), Number(explicitIso[3]), explicitIso[0]);
  const explicitDmy = text.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2})\b/);
  if (explicitDmy) return calendarDateWindow(Number(explicitDmy[3]), Number(explicitDmy[2]), Number(explicitDmy[1]), explicitDmy[0]);
  const dayMonth = text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${months.join("|")})(?:\\s+(20\\d{2}))?\\b`));
  const monthDay = text.match(new RegExp(`\\b(${months.join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(20\\d{2}))?\\b`));
  if (dayMonth || monthDay) {
    const monthName = dayMonth?.[2] ?? monthDay?.[1] ?? "";
    const day = Number(dayMonth?.[1] ?? monthDay?.[2]);
    let year = Number(dayMonth?.[3] ?? monthDay?.[3] ?? today.year);
    const explicitYear = Boolean(dayMonth?.[3] ?? monthDay?.[3]);
    const month = months.indexOf(monthName) + 1;
    const label = `${monthName} ${day}${explicitYear ? `, ${year}` : ""}`;
    let window = calendarDateWindow(year, month, day, label);
    if (window && !explicitYear && Date.parse(window.end) <= referenceTime) window = calendarDateWindow(++year, month, day, `${monthName} ${day}`);
    return window;
  }
  const namedMonthYear = text.match(new RegExp(`\\b(${months.join("|")})\\s+(20\\d{2})\\b`));
  if (namedMonthYear && !new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${namedMonthYear[1]}\\b`).test(text)) {
    const month = months.indexOf(namedMonthYear[1]!) + 1;
    const year = Number(namedMonthYear[2]);
    const start = lagosStart(year, month, 1);
    const end = month === 12 ? lagosStart(year + 1, 1, 1) : lagosStart(year, month + 1, 1);
    return { kind: "MONTH", label: `${months[month - 1]} ${year}`, start: new Date(start).toISOString(), end: new Date(end).toISOString() };
  }
  const time = text.match(/\b(?:at\s+)?(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b|\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (time) {
    let hour = Number(time[1] ?? time[4]);
    const minute = Number(time[2] ?? time[5] ?? 0);
    if (time[3] === "pm" && hour < 12) hour += 12;
    if (time[3] === "am" && hour === 12) hour = 0;
    let base = todayStart;
    const isoDate = text.match(/\b(20\d{2})[/.\-](\d{1,2})[/.\-](\d{1,2})\b/);
    const dmyDate = text.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](20\d{2})\b/);
    const namedDate = text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${months.join("|")})\\s+(20\\d{2})\\b`));
    const namedDateReverse = text.match(new RegExp(`\\b(${months.join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+(20\\d{2})\\b`));
    if (isoDate) base = lagosStart(Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3]));
    else if (dmyDate) base = lagosStart(Number(dmyDate[3]), Number(dmyDate[2]), Number(dmyDate[1]));
    else if (namedDate) base = lagosStart(Number(namedDate[3]), months.indexOf(namedDate[2]!) + 1, Number(namedDate[1]));
    else if (namedDateReverse) base = lagosStart(Number(namedDateReverse[3]), months.indexOf(namedDateReverse[1]!) + 1, Number(namedDateReverse[2]));
    else if (/\btomorrow\b/.test(text)) base += DAY_MS;
    else if (/\byesterday\b/.test(text)) base -= DAY_MS;
    const start = base + hour * 60 * 60_000 + minute * 60_000;
    return { kind: "TIME", label: `matches around ${time[0].trim()}`, start: new Date(start).toISOString(), end: new Date(start + 60 * 60_000).toISOString() };
  }

  if (/\bday after tomorrow\b/.test(text)) return dayWindow(todayStart + 2 * DAY_MS, "DAY", "the day after tomorrow");
  if (/\byesterday\b/.test(text)) return dayWindow(todayStart - DAY_MS, "DAY", "yesterday");
  if (/\btomorrow\b|\btmrw\b|\btomoro\b/.test(text)) return dayWindow(todayStart + DAY_MS, "TOMORROW", "tomorrow");
  if (/\btoday\b|\btonight\b|\bthis evening\b/.test(text)) return dayWindow(todayStart, "TODAY", "today");
  if (/\b(?:upcoming|future)\b/.test(text)) return dayWindow(todayStart, "NEXT_DAYS", "the next 7 days", 7);

  const nextDays = text.match(/\b(?:next|coming)\s+(\d+|two|three|four|five|six|seven)\s+days?\b/);
  if (nextDays) {
    const words: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
    const days = Math.max(1, Math.min(7, Number(nextDays[1]) || words[nextDays[1]] || 1));
    return dayWindow(todayStart, "NEXT_DAYS", `the next ${days} days`, days);
  }

  if (/\b(?:this|current|next) week\b/.test(text)) {
    const todayIndex = weekdays.indexOf(today.weekday);
    const mondayOffset = (todayIndex + 6) % 7;
    const nextOffset = /\bnext week\b/.test(text) ? 7 : 0;
    return dayWindow(todayStart - mondayOffset * DAY_MS + nextOffset * DAY_MS, "WEEK", /\bnext week\b/.test(text) ? "next week" : "this week", 7);
  }

  if (/\b(?:this|coming) weekend\b|\bweekend\b/.test(text)) {
    const todayIndex = weekdays.indexOf(today.weekday);
    const daysUntilSaturday = todayIndex === 0 ? -1 : (6 - todayIndex + 7) % 7;
    const start = todayStart + daysUntilSaturday * DAY_MS;
    return dayWindow(start, "WEEKEND", "this weekend", 2);
  }

  const iso = text.match(/\b(20\d{2})[\/.\-](\d{1,2})[\/.\-](\d{1,2})\b/);
  if (iso) return calendarDateWindow(Number(iso[1]), Number(iso[2]), Number(iso[3]), iso[0]);
  const dmy = text.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2})\b/);
  if (dmy) return calendarDateWindow(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]), dmy[0]);

  const monthYear = text.match(new RegExp(`\\b(${months.join("|")})(?:\\s+(20\\d{2}))?\\b`));
  if (monthYear && !new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${monthYear[1]}\\b`).test(text) && /\b(?:in|during|for|of|from)\b/.test(text)) {
    const month = months.indexOf(monthYear[1]!) + 1;
    const year = Number(monthYear[2] ?? today.year);
    const start = lagosStart(year, month, 1);
    const end = month === 12 ? lagosStart(year + 1, 1, 1) : lagosStart(year, month + 1, 1);
    return { kind: "MONTH", label: `${months[month - 1]} ${year}`, start: new Date(start).toISOString(), end: new Date(end).toISOString() };
  }
  const yearOnly = text.match(/\b(20\d{2})\b/);
  if (yearOnly && /\b(?:in|during|for|of|from|year)\b/.test(text)) {
    const year = Number(yearOnly[1]);
    return { kind: "YEAR", label: String(year), start: new Date(lagosStart(year, 1, 1)).toISOString(), end: new Date(lagosStart(year + 1, 1, 1)).toISOString() };
  }

  for (const [index, weekday] of weekdays.entries()) {
    if (!new RegExp(`\\b(?:this|next|on)?\\s*${weekday}\\b`).test(text)) continue;
    const todayIndex = weekdays.indexOf(today.weekday);
    let delta = (index - todayIndex + 7) % 7;
    if (new RegExp(`\\bnext\\s+${weekday}\\b`).test(text)) delta = delta === 0 ? 7 : delta;
    return dayWindow(todayStart + delta * DAY_MS, "DAY", weekday);
  }
  return null;
}

export function isWithinDateWindow(kickoff: string, window: DateWindow | null) {
  if (!window) return true;
  const timestamp = Date.parse(kickoff);
  return Number.isFinite(timestamp) && timestamp >= Date.parse(window.start) && timestamp < Date.parse(window.end);
}

export function requestedMarketKeys(input: string): string[] | undefined {
  const text = normalize(input);
  const keys = new Set<string>();
  const nonTotals = [
    'MATCH_HOME', 'MATCH_DRAW', 'MATCH_AWAY', 'DC_1X', 'DC_X2', 'DC_12', 'DNB_HOME', 'DNB_AWAY',
    'BTTS_YES', 'BTTS_NO', 'ASIAN_HOME_P0_5', 'ASIAN_AWAY_P0_5', 'ASIAN_HOME_P1', 'ASIAN_AWAY_P1',
    'ASIAN_HOME_P1_5', 'ASIAN_AWAY_P1_5', 'ASIAN_HOME_M0_5', 'ASIAN_AWAY_M0_5', 'ASIAN_HOME_M1', 'ASIAN_AWAY_M1',
  ];
  if (/\b(?:no|without|dont use|do not use)\s+(?:over.?under|totals?|goal markets?)\b/.test(text)) nonTotals.forEach((key) => keys.add(key));
  const total = text.match(/\b(over|under)\s+(\d+(?:\.\d+)?)\b/);
  if (total) {
    const team = /\bhome\b/.test(text) ? 'HOME_' : /\baway\b/.test(text) ? 'AWAY_' : '';
    keys.add(`${team}${total[1].toUpperCase()}_${total[2].replace('.', '_')}`);
  }
  if (/\bbtts\b|both teams to score|\bgg\b|\bng\b/.test(text)) keys.add(/\b(?:no|ng)\b/.test(text) ? 'BTTS_NO' : 'BTTS_YES');
  if (/double chance|\b1x\b|\bx2\b|\b12\b/.test(text)) {
    if (/\b1x\b/.test(text)) keys.add('DC_1X');
    else if (/\bx2\b/.test(text)) keys.add('DC_X2');
    else if (/\b12\b/.test(text)) keys.add('DC_12');
    else ['DC_1X', 'DC_X2', 'DC_12'].forEach((key) => keys.add(key));
  }
  const hasDnb = /draw.?no.?bet|\bdnb\b/.test(text);
  if (hasDnb) ['DNB_HOME', 'DNB_AWAY'].forEach((key) => keys.add(key));
  if (!hasDnb && /\b(?:straight|match)\s+(?:win|result)|\bhome wins?\b|\baway wins?\b|\bdraws?\b/.test(text)) {
    if (/\bhome wins?\b/.test(text)) keys.add('MATCH_HOME');
    else if (/\baway wins?\b/.test(text)) keys.add('MATCH_AWAY');
    else if (/\bdraws?\b/.test(text)) keys.add('MATCH_DRAW');
    else ['MATCH_HOME', 'MATCH_DRAW', 'MATCH_AWAY'].forEach((key) => keys.add(key));
  }
  if (/\bteam goals?\b|team to score/.test(text)) ['HOME_OVER_0_5', 'AWAY_OVER_0_5', 'HOME_OVER_1_5', 'AWAY_OVER_1_5'].forEach((key) => keys.add(key));
  if (/asian handicap|positive handicap|handicap cover/.test(text)) [
    'ASIAN_HOME_P0_5', 'ASIAN_AWAY_P0_5', 'ASIAN_HOME_P1', 'ASIAN_AWAY_P1', 'ASIAN_HOME_P1_5', 'ASIAN_AWAY_P1_5',
    'ASIAN_HOME_M0_5', 'ASIAN_AWAY_M0_5', 'ASIAN_HOME_M1', 'ASIAN_AWAY_M1',
  ].forEach((key) => keys.add(key));
  return keys.size ? [...keys] : undefined;
}

export function matchesRequestedMarket(key: string, keys?: string[]) {
  return !keys || keys.includes(key);
}

export function requestedLeagueFilters(input: string): LeagueFilter[] | undefined {
  const text = normalize(input);
  const aliases: Array<[LeagueFilter, RegExp]> = [
    ["PREMIER_LEAGUE", /\b(?:premier league|epl|english premier)\b/],
    ["LA_LIGA", /\b(?:la liga|laliga|spanish primera)\b/],
    ["SERIE_A", /\b(?:serie a|seria a|italian league)\b/],
    ["BUNDESLIGA", /\b(?:bundesliga|german league)\b/],
    ["LIGUE_1", /\b(?:ligue 1|french league)\b/],
    ["EREDIVISIE", /\b(?:eredivisie|dutch league)\b/],
    ["SAUDI_PRO", /\b(?:saudi pro|saudi league|roshan league)\b/],
    ["PORTUGAL", /\b(?:primeira liga|portugal league|portuguese league)\b/],
    ["TURKIYE", /\b(?:super lig|turkiye league|turkish league)\b/],
    ["CHAMPIONS_LEAGUE", /\b(?:uefa champions league|champions league|ucl)\b/],
    ["EUROPA_LEAGUE", /\b(?:uefa europa league|europa league|uel)\b/],
    ["CONFERENCE_LEAGUE", /\b(?:uefa conference league|conference league|uecl)\b/],
    ["MLS", /\b(?:major league soccer|mls|american soccer league)\b/],
    ["INTERNATIONAL_FRIENDLY", /\b(?:international friendl(?:y|ies)|friendly internationals?|national team friendl(?:y|ies))\b/],
    ["CLUB_FRIENDLY", /\b(?:club friendl(?:y|ies)|friendly clubs?)\b/],
    ["WORLD_CUP", /\b(?:fifa world cup|world cup(?: qualifiers?| qualification)?)\b/],
    ["NATIONS_LEAGUE", /\b(?:uefa nations league|womens? nations league|concacaf nations league|nations league)\b/],
    ["AFCON", /\b(?:africa(?:n)? (?:cup of )?nations|afcon|africa nations matches?|african nations(?: cup| championship)?(?: qualifiers?| qualifying)?)\b/],
  ];
  const filters = aliases.filter(([, matcher]) => matcher.test(text)).map(([id]) => id);
  return filters.length ? filters : undefined;
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

function extractMatchup(input: string) {
  const text = normalize(input);
  const match = text.match(/(.{2,55}?)\s+(?:vs\.?|versus|v|against)\s+(.{2,55})/);
  if (!match) return null;
  const cleanLeft = match[1]!.replace(/^.*\b(?:about|for|between|on|think of|predict)\s+/, "").replace(/^\b(?:who will win|best pick)\s+/, "").trim();
  const cleanRight = match[2]!.replace(/\b(?:today|tonight|tomorrow|this weekend|on sportybet|on sporty|on betking|on bet9ja|on betway|on betpawa)\b.*$/, "").trim();
  if (!cleanLeft || !cleanRight || cleanLeft.length > 40 || cleanRight.length > 40) return null;
  return { homeTeam: cleanLeft, awayTeam: cleanRight };
}

export function interpretAssistantRequest(input: string, referenceTime = Date.now()): AssistantIntent {
  const text = normalize(input.replace(/(\d),(?=\d{3}\b)/g, "$1"));
  if (!text) return { kind: "unknown", confidence: 0 };
  const scores = intentScores(text);
  const providers = mentionedProviders(text);
  const code = extractCode(input);
  const parts = extractParts(text);
  const dateWindow = extractDateWindow(text, referenceTime);
  if (!dateWindow && /\b(?:20\d{2}[\/-]\d{1,2}[\/-]\d{1,2}|\d{1,2}[\/-]\d{1,2}[\/-]20\d{2})\b/.test(text)) return { kind: "unknown", confidence: 0 };
  const leagueFilters = requestedLeagueFilters(text);
  const matchup = extractMatchup(input);
  const context = { dateWindow, marketKeys: requestedMarketKeys(text), leagueFilters };
  const strategy: RecommendationStrategy = /\b(value|valuable|edge|price)\b/.test(text) ? "value" : "protection";
  const hasSplitLanguage = /\b(split|divide|break|separate|smaller|across)\b/.test(text);
  const hasConversionLanguage = /\b(convert|change|move|transfer|translate|turn|carry)\b|\bsend (?:this |the )?(?:code|slip|bet)\b/.test(text);
  const hasAnalysisLanguage = /\b(analy[sz]e|assess|review|rate|risky|opinion)\b|\bwhat do you think\b|\bhow (?:good|safe|strong)\b/.test(text);
  const hasExplanationLanguage = /\bwhy\b|\bexplain\b|\breason\b|\bhow come\b|\bwhat made you\b|what (?:could|can|might) make .{0,40}(?:lose|fail)|how (?:could|can|might) .{0,40}(?:lose|fail)|can (?:this|that|the) .{0,24}(?:lose|fail)/.test(text);
  const hasBuildLanguage = /\b(odds?|bet|slip|ticket|games?|matches?|booking|picks?|predictions?)\b/.test(text);
  const hasFixtureListLanguage = /\b(?:list|show|display|give me|what|which|find|see)\b.*\b(?:fixtures?|matches?|games?|schedule|playing)\b|\b(?:fixtures?|matches?|games?|schedule)\b.*\b(?:today|tomorrow|weekend|upcoming|next|in the|in 20\d{2})\b/.test(text);
  const requestsPrediction = /\b(?:predictions?|picks?|best|safe|safest|value|strongest|protected|odds?|bet|slip|ticket)\b/.test(text);
  const requestsAllPredictions = requestsPrediction && /\b(?:all|every|each)\b/.test(text) && /\b(?:matches?|games?|fixtures?|predictions?|picks?)\b/.test(text);
  const typedTeamRows = input.split(/[;\n]+/).some(line => /^\s*(?:\d+[.)]\s*)?[^\r\n]{2,55}?\s*[-–—:]\s*(?:1\s*up|2\s*up|1up|2up|ml|moneyline)\s*$/i.test(line));
  const typedMarket = /\b(?:home|away)?\s*(?:1\s*up|2\s*up|win|moneyline|ml|draw no bet|dnb|btts|both teams to score|over\s*\d+(?:\.\d+)?|under\s*\d+(?:\.\d+)?|handicap\s*[+-]\d+(?:\.\d+)?|1x|x2|12)\b/.test(text);
  const allDestinations = /\b(?:all|every)\s+(?:the\s+)?(?:bookmakers?|books?)\b|\b(?:everywhere|to all)\b/.test(text);

  if (/\b(?:guaranteed|guarantee|sure win|cannot lose|100 percent)\b|\b(?:correct score|corners?|cards?|player bets?|goalscorer)\b/.test(text)
    || (!matchup && /\b(?:1\s*up|2\s*up)\b/.test(text) && !typedTeamRows)) return { kind: "limits", confidence: 1, subject: input.trim() };
  if (/^(?:hi|hello|hey|good morning|good afternoon|good evening)\b/.test(text) || /\b(?:what can you do|how can you help|help me|show me how|what should i ask)\b/.test(text)) return { kind: "help", confidence: 1 };
  if (/^(?:yes|okay|ok|continue|proceed|do it|send it|send it like that|use the available|keep the available|go ahead)(?: please)?$/.test(text)
    || /\b(?:continue|proceed|create|send|keep|use)\b.*\b(?:available|remaining|matched)\b/.test(text)) return { kind: "confirm", confidence: 1 };

  // Explicit verbs win over weak inferences. Previously any code plus a
  // bookmaker was treated as conversion, so "split this Sporty code" could
  // never reach the split action.
  if (hasExplanationLanguage) return { kind: "explain", confidence: 1, subject: input.trim() };
  const reviseAction = /\b(?:remove|drop|delete|take out)\b/.test(text) ? "remove"
    : /\b(?:replace|swap|change)\b/.test(text) && /\b(?:pick|selection|match|game|weakest|riskiest|that|it)\b/.test(text) ? "replace"
    : /\b(?:make|build|give)\b.*\bsafer\b|\bsafer\s+(?:one|slip|option)\b/.test(text) || (/\btoo risky\b/.test(text) && !extractTarget(text, null)) ? "safer"
    : /\b(?:which|show|tell).*(?:riskiest|weakest)\b|\b(?:riskiest|weakest)\s+(?:pick|selection|match|game)\b/.test(text) ? "riskiest"
    : /\b(?:which|show|tell).*(?:safest|strongest)\b.*\b(?:pick|selection|match|game|one)\b/.test(text) ? "safest"
    : null;
  if (reviseAction) return { kind: "revise", confidence: 1, action: reviseAction, subject: input.trim() };
  if (((matchup && typedMarket) || typedTeamRows) && !requestsPrediction && !/\bwho will win\b|\bwill .{0,30} win\b/.test(text)) return { kind: "textCode", confidence: 1, text: input.trim(), provider: providers[0]?.id ?? null };
  if (matchup) return { kind: "match", confidence: 1, ...matchup, provider: providers[0]?.id ?? null };
  if (hasSplitLanguage || parts || scores.split >= .62) {
    return { kind: "split", confidence: Math.min(1, scores.split + (hasSplitLanguage ? .2 : 0) + (code ? .15 : 0)), code, targetOdds: code ? null : extractTarget(text, parts), parts, provider: providers[0]?.id ?? null, ...context };
  }
  if ((hasAnalysisLanguage || (code && !hasConversionLanguage)) && !extractTarget(text, null)) return { kind: "analyze", confidence: 1, code, provider: providers[0]?.id ?? null };
  if (hasConversionLanguage || (code && providers.length > 0) || scores.convert >= .56) {
    const routes = conversionProviders(text, providers);
    return { kind: "convert", confidence: Math.min(1, scores.convert + (code ? .22 : 0) + (hasConversionLanguage ? .18 : 0)), code, ...routes, allDestinations };
  }
  if (/\b(results?|settled|won|lost|performance|hit rate)\b/.test(text)) return { kind: "results", confidence: 1, ...context };
  const explicitTarget = extractTarget(text, null);
  if (explicitTarget && /\bodds?\b/.test(text)) return { kind: "build", confidence: 1, targetOdds: explicitTarget, provider: providers[0]?.id ?? null, ...context };
  if ((hasFixtureListLanguage || Boolean(leagueFilters?.length && /\b(?:list|show|display|give me|find|see)\b/.test(text)) || Boolean(leagueFilters?.length && /\b(?:fixtures?|matches?|games?|schedule)\b/.test(text) && !requestsPrediction)) && !requestsPrediction) {
    return { kind: "fixtures", confidence: 1, provider: providers[0]?.id ?? null, ...context };
  }
  if (requestsAllPredictions) return { kind: "allPicks", confidence: 1, provider: providers[0]?.id ?? null, strategy, ...context };
  if (scores.best >= .58 || /\b(best|safe|safest|protected|strongest|strong|reliable|top|low risk|lower risk)\b/.test(text) || Boolean(context.marketKeys?.length && !extractTarget(text, null) && /\b(picks?|predictions?|options?|selections?)\b/.test(text)) || Boolean(leagueFilters?.length && /\b(picks?|predictions?)\b/.test(text))) {
    return { kind: "best", confidence: Math.min(1, scores.best + .18), provider: providers[0]?.id ?? null, strategy, ...context };
  }
  if (scores.daily >= .6 || /\bdaily\b|\btoday.?s?(?:\s+[a-z]+){0,2}\s+(?:odds|tickets|slips)\b|\bready made (?:tickets|slips)\b/.test(text) || Boolean(dateWindow && /\b(?:odds|picks|predictions)\b/.test(text) && !extractTarget(text, parts))) {
    return { kind: "daily", confidence: Math.min(1, scores.daily + .18), provider: providers[0]?.id ?? null, strategy, ...context };
  }
  if (scores.results >= .58 || /\b(results?|settled|won|lost|performance|hit rate)\b/.test(text)) {
    return { kind: "results", confidence: Math.min(1, scores.results + .18), dateWindow };
  }
  const targetOdds = extractTarget(text, null);
  if (hasBuildLanguage || targetOdds || providers.length || scores.build >= .43) {
    return { kind: "build", confidence: Math.min(1, scores.build + (targetOdds ? .18 : 0) + (providers.length ? .12 : 0)), targetOdds, provider: providers[0]?.id ?? null, ...context };
  }
  return { kind: "unknown", confidence: Math.max(...Object.values(scores)) };
}
