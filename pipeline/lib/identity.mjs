const aliases = new Map(Object.entries({
  "wolves": "wolverhampton-wanderers",
  "wolverhampton": "wolverhampton-wanderers",
  "wolverhampton-wanderers": "wolverhampton-wanderers",
  "man-utd": "manchester-united",
  "man-united": "manchester-united",
  "manchester-utd": "manchester-united",
  "man-city": "manchester-city",
  "spurs": "tottenham-hotspur",
  "tottenham": "tottenham-hotspur",
  "newcastle": "newcastle-united",
  "west-ham": "west-ham-united",
  "brighton": "brighton-and-hove-albion",
  "paris-saint-germain": "psg",
  "paris-sg": "psg",
  "internazionale": "inter-milan",
  "inter": "inter-milan",
  "ac-milan": "milan",
  "athletico-madrid": "atletico-madrid",
  "atletico-de-madrid": "atletico-madrid",
  "bayern-munich": "bayern-munchen",
  "bayern-munchen": "bayern-munchen",
  "borussia-monchengladbach": "borussia-monchengladbach",
  "monchengladbach": "borussia-monchengladbach",
}));

export function normalizedName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/\b(fc|afc|cf|sc|calcio|club de futbol|football club)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

export function canonicalTeamId(name) {
  const normalized = normalizedName(name);
  return aliases.get(normalized) ?? normalized;
}

export function canonicalLeagueId(value) {
  const normalized = normalizedName(value);
  if (/eng-1|english-premier|premier-league/.test(normalized)) return "eng.1";
  if (/esp-1|la-liga|spanish-primera/.test(normalized)) return "esp.1";
  if (/ita-1|serie-a|italian-serie/.test(normalized)) return "ita.1";
  if (/ger-1|bundesliga|german-bundesliga/.test(normalized)) return "ger.1";
  if (/fra-1|ligue-1|french-ligue/.test(normalized)) return "fra.1";
  return normalized;
}

export function sameTeam(left, right) {
  return Boolean(left && right && canonicalTeamId(left) === canonicalTeamId(right));
}
