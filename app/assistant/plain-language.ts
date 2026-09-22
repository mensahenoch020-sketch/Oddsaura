type ExplainablePick = {
  selection: string;
  market: { key: string; name: string };
  confidence?: number | null;
  quotedOdds?: number | null;
};

function marketReason(key: string, selection: string) {
  if (/^DC_/.test(key)) return `${selection} covers two possible match results, so it offers more protection than choosing one winner.`;
  if (/^DNB_/.test(key)) return `${selection} protects the stake if the match finishes level.`;
  if (/^ASIAN_.*_P/.test(key)) return `${selection} starts with a goal advantage, which gives the pick extra protection.`;
  if (/^ASIAN_/.test(key)) return `${selection} was the strongest supported handicap for this match.`;
  if (key === "BTTS_NO") return "This option suits a match where at least one team may struggle to score.";
  if (key === "BTTS_YES") return "Both teams have a realistic route to scoring, so this was stronger than choosing the match winner.";
  if (/^(HOME|AWAY)_OVER_0_5$/.test(key)) return `${selection} only needs that team to score once, making it safer than backing them to win.`;
  if (/^(HOME|AWAY)_OVER_1_5$/.test(key)) return `${selection} backs the stronger scoring opportunity without requiring a particular match result.`;
  if (key === "UNDER_3_5") return "This allows up to three match goals and gives more room than a stricter low-score option.";
  if (key === "OVER_1_5") return "Only two match goals are needed, which is more forgiving than choosing the winner.";
  if (/^MATCH_/.test(key)) return `${selection} was the strongest supported match-result option.`;
  return `${selection} was the clearest supported option available for this match.`;
}

export function plainPickExplanation(pick: ExplainablePick, bookmaker?: string | null) {
  const support = bookmaker ? ` It was available at ${bookmaker} when OddsAura checked.` : " It was available when OddsAura checked.";
  return `${marketReason(pick.market.key, pick.selection)}${support}`;
}

export function unmetTargetMessage(bookmaker: string, target: number, availableOdds?: number, hasCode = false) {
  const requested = target.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (hasCode && availableOdds != null) {
    const available = availableOdds.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `I couldn’t safely reach ${requested} odds. I created the closest available ${bookmaker} code at ${available} odds instead.`;
  }
  return `I couldn’t safely reach ${requested} odds for ${bookmaker}. There were not enough available matches to create a reliable code.`;
}
