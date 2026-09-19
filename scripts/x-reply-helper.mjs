export const bookmakerLabels = {
  sportybet: "SportyBet",
  betpawa: "betPawa",
  bet9ja: "Bet9ja",
  betking: "BetKing",
  betway: "Betway",
};

const aliases = [
  ["sportybet", /\b(?:sporty ?bet|sporting ?bet|sporty)\b/i],
  ["betpawa", /\bbet ?pawa\b/i],
  ["bet9ja", /\bbet ?9ja\b/i],
  ["betking", /\bbet ?king\b/i],
  ["betway", /\bbet ?way\b/i],
];

const ignoredCodeWords = /^(?:BET(?:9JA|WAY|KING|PAWA)|SPORTY(?:BET)?|ODDSAURA|CONVERT)$/;

export function normalizeBookmaker(value) {
  const text = String(value || "").trim();
  return aliases.find(([, matcher]) => matcher.test(text))?.[0] ?? null;
}

function mentionedBookmakers(text) {
  return aliases.flatMap(([provider, matcher]) => {
    const match = matcher.exec(text);
    return match ? [{ provider, index: match.index }] : [];
  }).sort((a, b) => a.index - b.index);
}

function codeLabel(line, code) {
  const before = line.slice(0, Math.max(0, line.toUpperCase().indexOf(code)));
  const odds = before.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(?:odds?|x)\b/i)?.[1];
  return odds ? `${odds} odds` : null;
}

export function extractBookingCodes(input) {
  const requestText = String(input || "");
  const found = [];
  const seen = new Set();
  for (const line of requestText.split(/\r?\n/)) {
    const scanLine = line.replace(/(?:https?:\/\/|pic\.twitter\.com\/)[^\s]+/gi, " ");
    const tokens = scanLine.toUpperCase().match(/\b(?=[A-Z0-9]{4,20}\b)(?=[A-Z0-9]*\d)[A-Z0-9]+\b/g) ?? [];
    for (const code of tokens) {
      if (ignoredCodeWords.test(code) || seen.has(code)) continue;
      seen.add(code);
      found.push({ code, label: codeLabel(scanLine, code) });
    }
  }
  return found;
}

export function parseXConversionRequest(input) {
  const requestText = String(input || "").trim();
  const mentions = mentionedBookmakers(requestText);
  const destinationText = requestText.match(/\b(?:to|into|for)\s+(sporty ?bet|sporting ?bet|sporty|bet ?pawa|bet ?9ja|bet ?king|bet ?way)\b/i)?.[1];
  const sourceText = requestText.match(/\bfrom\s+(sporty ?bet|sporting ?bet|sporty|bet ?pawa|bet ?9ja|bet ?king|bet ?way)\b/i)?.[1];
  let destinationProvider = normalizeBookmaker(destinationText);
  let sourceProvider = normalizeBookmaker(sourceText);
  if (!destinationProvider && mentions.length > 1) destinationProvider = mentions.at(-1)?.provider ?? null;
  if (!sourceProvider && mentions.length > 1) sourceProvider = mentions.find((item) => item.provider !== destinationProvider)?.provider ?? null;
  const codes = extractBookingCodes(requestText);
  if (!sourceProvider && codes.some((item) => item.code.startsWith("BW"))) sourceProvider = "betway";
  return { requestText, sourceProvider, destinationProvider, code: codes[0]?.code ?? null, codes };
}

function resultCounts(result) {
  const resolved = Array.isArray(result?.resolved) ? result.resolved : [];
  const sourceIssues = Array.isArray(result?.sourceIssues) ? result.sourceIssues : [];
  const unmatched = Array.isArray(result?.unmatched) ? result.unmatched : [];
  const decoded = Number(result?.decoded) || resolved.length + unmatched.length;
  const total = Math.max(decoded + sourceIssues.length, resolved.length + unmatched.length + sourceIssues.length);
  const included = resolved.length || Math.max(0, decoded - unmatched.length);
  return { resolved, sourceIssues, unmatched, total, included, unavailable: Math.max(0, total - included) };
}

export function buildXReply({ sourceProvider, destinationProvider, sourceCode, result }) {
  const { resolved, total, included, unavailable } = resultCounts(result);
  const totalOdds = resolved.reduce((product, item) => Number.isFinite(item?.odds) && Number(item.odds) > 1 ? product * Number(item.odds) : product, 1);
  const oddsText = totalOdds > 1 ? ` | ${totalOdds.toFixed(2)} Odds` : "";
  return [
    `🔄 Converted ${bookmakerLabels[sourceProvider] ?? sourceProvider} ${sourceCode} ➡️ ${bookmakerLabels[destinationProvider] ?? destinationProvider}`,
    `📋 ${included}/${total || included} Selections Matched${oddsText}`,
    `📌 Code: ${result.code}`,
    unavailable ? `⚠️ ${unavailable} selection(s) unavailable on ${bookmakerLabels[destinationProvider] ?? destinationProvider}` : "✅ Every selection matched",
    "",
    "Converted by OddsAura · Check the final bookmaker slip · 18+",
  ].join("\n");
}

function issueGame(issue) {
  const home = String(issue?.homeTeam || "").trim();
  const away = String(issue?.awayTeam || "").trim();
  const event = String(issue?.eventName || issue?.fixtureName || "").trim();
  const game = home && away ? `${home}-${away}` : event.replace(/\s+v(?:s\.?|\.)?\s+/i, "-");
  const market = String(issue?.marketName || issue?.market || "").trim();
  return game ? `${game}${market ? ` (${market})` : ""}` : null;
}

export function batchMissingSelections(items) {
  const output = [];
  const seen = new Set();
  for (const item of items ?? []) {
    const result = item?.result ?? {};
    for (const issue of [...(Array.isArray(result.unmatched) ? result.unmatched : []), ...(Array.isArray(result.sourceIssues) ? result.sourceIssues : [])]) {
      const label = issueGame(issue);
      if (!label || seen.has(label.toLowerCase())) continue;
      seen.add(label.toLowerCase());
      output.push(label);
    }
  }
  return output;
}

function truncate(text, limit) {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

export function buildBatchXReply({ sourceProvider, destinationProvider, items, resultUrl = "" }) {
  const source = bookmakerLabels[sourceProvider] ?? sourceProvider;
  const destination = bookmakerLabels[destinationProvider] ?? destinationProvider;
  const successes = (items ?? []).filter((item) => item?.result?.code);
  const failedCodes = (items ?? []).filter((item) => !item?.result?.code).map((item) => item.sourceCode);
  const missing = batchMissingSelections(items);
  const lines = [`${source} → ${destination}`];
  for (const item of successes) {
    const name = item.label || item.sourceCode;
    const candidate = `${name}: ${item.result.code}`;
    const reserve = 90 + (resultUrl ? resultUrl.length : 0);
    if ([...lines, candidate].join("\n").length <= 280 - reserve) lines.push(candidate);
    else break;
  }
  const omittedSuccesses = successes.length - (lines.length - 1);
  if (omittedSuccesses > 0) lines.push(`+${omittedSuccesses} converted code${omittedSuccesses === 1 ? "" : "s"}`);
  if (failedCodes.length) {
    const namedFailures = `Failed: ${failedCodes.join(", ")}`;
    lines.push(failedCodes.length <= 3 && namedFailures.length <= 70 ? namedFailures : `${failedCodes.length} code${failedCodes.length === 1 ? "" : "s"} failed`);
  }
  if (missing.length) {
    const missingLine = `Not converted: ${missing.join("; ")}`;
    const withMissing = [...lines, missingLine, "Check every slip before betting. 18+"].join("\n");
    if (withMissing.length <= 280) lines.push(missingLine);
    else lines.push(`Not converted: ${missing.length} selection${missing.length === 1 ? "" : "s"}${resultUrl ? ` · ${resultUrl}` : ""}`);
  } else if (!failedCodes.length) lines.push("All available selections converted.");
  if ((omittedSuccesses > 0 || failedCodes.length > 0) && resultUrl && !lines.some((line) => line.includes(resultUrl))) lines.push(`Details: ${resultUrl}`);
  lines.push("Check every slip before betting. 18+");
  let reply = lines.join("\n");
  if (reply.length <= 280) return reply;
  const compact = [
    `${source} → ${destination}`,
    `${successes.length} converted · ${failedCodes.length} failed · ${missing.length} not converted`,
    resultUrl || "Review the conversion details in OddsAura.",
    "Check every slip before betting. 18+",
  ];
  reply = compact.join("\n");
  return truncate(reply, 280);
}

export function extractXPostId(value) {
  return String(value || "").match(/(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d+)/i)?.[1] ?? null;
}

export function isValidXPostUrl(value) {
  return Boolean(extractXPostId(value));
}
