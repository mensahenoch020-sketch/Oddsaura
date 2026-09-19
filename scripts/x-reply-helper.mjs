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

export function parseXConversionRequest(input) {
  const requestText = String(input || "").trim();
  const mentions = mentionedBookmakers(requestText);
  const destinationText = requestText.match(/\b(?:to|into|for)\s+(sporty ?bet|sporting ?bet|sporty|bet ?pawa|bet ?9ja|bet ?king|bet ?way)\b/i)?.[1];
  const sourceText = requestText.match(/\bfrom\s+(sporty ?bet|sporting ?bet|sporty|bet ?pawa|bet ?9ja|bet ?king|bet ?way)\b/i)?.[1];
  let destinationProvider = normalizeBookmaker(destinationText);
  let sourceProvider = normalizeBookmaker(sourceText);
  if (!destinationProvider && mentions.length > 1) destinationProvider = mentions.at(-1)?.provider ?? null;
  if (!sourceProvider && mentions.length > 1) sourceProvider = mentions.find((item) => item.provider !== destinationProvider)?.provider ?? null;
  const code = (requestText.toUpperCase().match(/\b(?=[A-Z0-9]{4,16}\b)(?=[A-Z0-9]*\d)[A-Z0-9]+\b/g) ?? [])
    .find((token) => !/^BET(?:9JA|WAY|KING|PAWA)$/.test(token) && !/^SPORTY(?:BET)?$/.test(token)) ?? null;
  if (!sourceProvider && code?.startsWith("BW")) sourceProvider = "betway";
  return { requestText, sourceProvider, destinationProvider, code };
}

export function buildXReply({ sourceProvider, destinationProvider, sourceCode, result }) {
  const resolved = Array.isArray(result?.resolved) ? result.resolved : [];
  const sourceIssues = Array.isArray(result?.sourceIssues) ? result.sourceIssues : [];
  const unmatched = Array.isArray(result?.unmatched) ? result.unmatched : [];
  const decoded = Number(result?.decoded) || resolved.length + unmatched.length;
  const total = Math.max(decoded + sourceIssues.length, resolved.length + unmatched.length + sourceIssues.length);
  const included = resolved.length || Math.max(0, decoded - unmatched.length);
  const unavailable = Math.max(0, total - included);
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

export function extractXPostId(value) {
  return String(value || "").match(/(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d+)/i)?.[1] ?? null;
}
