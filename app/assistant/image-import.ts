import type { Fixture } from "../data";
import type { BookmakerSelection } from "../builder/providers";

export type ImagePredictionRow = {
  homeTeam: string;
  awayTeam: string;
  marketText: string;
  odds: number | null;
};

export type MatchedImagePrediction = {
  row: ImagePredictionRow;
  fixture: Fixture;
  selection: BookmakerSelection;
};

const clean = (value: string) => value.replace(/[•|]/g, " ").replace(/\s+/g, " ").trim();
const normalized = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(fc|cf|sc|afc|club|utd|united)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
const isMarket = (value: string) => /\b(over|under|btts|both teams|double chance|draw no bet|dnb|handicap|home win|away win|match result|to score|win or draw)\b/i.test(value);
const isNoise = (value: string) => /^(predictions? of the day|combined odds|kick.?off|time|odds|selection|match|today|tomorrow)$/i.test(value) || /^\d{1,2}:\d{2}\s*(?:am|pm)?$/i.test(value);

export function parsePredictionImageText(raw: string): ImagePredictionRow[] {
  const lines = raw.split(/\r?\n/).map(clean).filter((line) => line.length > 1 && !isNoise(line));
  const rows: ImagePredictionRow[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    let homeTeam = "";
    let awayTeam = "";
    let consumed = 0;
    const inline = lines[index]!.match(/^(.{2,60}?)\s+(?:vs\.?|versus|v)\s+(.{2,60}?)(?:\s+\d+(?:\.\d+)?)?$/i);
    if (inline) {
      homeTeam = clean(inline[1]!);
      awayTeam = clean(inline[2]!);
    } else {
      const next = lines[index + 1] ?? "";
      const nextAway = next.match(/^\s*(?:vs\.?|versus|v)\s+(.{2,60})$/i);
      if (nextAway) {
        homeTeam = lines[index]!;
        awayTeam = clean(nextAway[1]!);
        consumed = 1;
      } else if (/^(?:vs\.?|versus|v)$/i.test(next) && lines[index + 2]) {
        homeTeam = lines[index]!;
        awayTeam = lines[index + 2]!;
        consumed = 2;
      }
    }
    if (!homeTeam || !awayTeam || isMarket(homeTeam) || isMarket(awayTeam)) continue;

    const tail = lines.slice(index + consumed + 1, index + consumed + 6);
    const marketText = tail.find(isMarket) ?? "";
    if (!marketText) continue;
    const oddsLine = tail.filter((line) => line !== marketText).find((line) => /\b\d+\.\d{1,3}\b/.test(line));
    const odds = oddsLine?.match(/\b(\d+\.\d{1,3})\b/)?.[1];
    rows.push({ homeTeam, awayTeam, marketText, odds: odds ? Number(odds) : null });
    index += consumed;
  }
  return rows.filter((row, index, all) => all.findIndex((candidate) => normalized(candidate.homeTeam) === normalized(row.homeTeam) && normalized(candidate.awayTeam) === normalized(row.awayTeam) && normalized(candidate.marketText) === normalized(row.marketText)) === index);
}

function teamScore(left: string, right: string) {
  const a = normalized(left), b = normalized(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return .88;
  const leftWords = new Set(a.split(" "));
  const rightWords = new Set(b.split(" "));
  const shared = [...leftWords].filter((word) => rightWords.has(word)).length;
  return shared / Math.max(leftWords.size, rightWords.size);
}

function marketSelection(row: ImagePredictionRow, fixture: Fixture): Omit<BookmakerSelection, "fixtureId" | "homeTeam" | "awayTeam" | "kickoff"> | null {
  const text = normalized(row.marketText);
  const numericText = row.marketText.toLowerCase().replace(/,/g, ".");
  const total = numericText.match(/\b(over|under)\s*(\d+(?:\.\d+)?)\b/);
  if (total) {
    const direction = total[1]!.toUpperCase();
    const line = Number(total[2]);
    const keyLine = String(line).replace(".", "_");
    const teamPrefix = /home team|team 1/.test(text) ? "HOME_" : /away team|team 2/.test(text) ? "AWAY_" : "";
    return { marketKey: `${teamPrefix}${direction}_${keyLine}`, marketName: teamPrefix ? `${teamPrefix === "HOME_" ? "Home" : "Away"} team goals` : "Total goals", selection: `${direction === "OVER" ? "Over" : "Under"} ${line}`, line, quotedOdds: row.odds };
  }
  if (/btts|both teams.*score|\bgg\b|\bng\b/.test(text)) {
    const yes = !/\b(no|ng)\b/.test(text);
    return { marketKey: yes ? "BTTS_YES" : "BTTS_NO", marketName: "Both teams to score", selection: yes ? "Yes" : "No", quotedOdds: row.odds };
  }
  if (/draw no bet|\bdnb\b/.test(text)) {
    const away = /away|team 2/.test(text) || normalized(row.marketText).includes(normalized(fixture.awayTeam.name));
    return { marketKey: away ? "DNB_AWAY" : "DNB_HOME", marketName: "Draw no bet", selection: away ? fixture.awayTeam.name : fixture.homeTeam.name, quotedOdds: row.odds };
  }
  if (/double chance|win or draw|\b1x\b|\bx2\b|\b12\b/.test(text)) {
    const key = /\bx2\b|away.*draw|draw.*away/.test(text) ? "DC_X2" : /\b12\b|either team/.test(text) ? "DC_12" : "DC_1X";
    const selection = key === "DC_X2" ? `Draw or ${fixture.awayTeam.name}` : key === "DC_12" ? `${fixture.homeTeam.name} or ${fixture.awayTeam.name}` : `${fixture.homeTeam.name} or draw`;
    return { marketKey: key, marketName: "Double chance", selection, quotedOdds: row.odds };
  }
  const handicap = numericText.match(/(?:handicap)?.*?([+-]\d+(?:\.\d+)?)/);
  if (/handicap/.test(text) && handicap) {
    const line = Number(handicap[1]);
    const away = /away|team 2/.test(text) || text.includes(normalized(fixture.awayTeam.name));
    const side = away ? "AWAY" : "HOME";
    const direction = line >= 0 ? "P" : "M";
    return { marketKey: `ASIAN_${side}_${direction}${String(Math.abs(line)).replace(".", "_")}`, marketName: "Asian handicap", selection: `${away ? fixture.awayTeam.name : fixture.homeTeam.name} (${line > 0 ? "+" : ""}${line})`, line, quotedOdds: row.odds };
  }
  if (/draw/.test(text) && !/win/.test(text)) return { marketKey: "MATCH_DRAW", marketName: "Match result", selection: "Draw", quotedOdds: row.odds };
  if (/away win|team 2 win|\b2\b/.test(text)) return { marketKey: "MATCH_AWAY", marketName: "Match result", selection: fixture.awayTeam.name, quotedOdds: row.odds };
  if (/home win|team 1 win|match result|\b1\b/.test(text)) return { marketKey: "MATCH_HOME", marketName: "Match result", selection: fixture.homeTeam.name, quotedOdds: row.odds };
  return null;
}

export function matchImageRowsToFixtures(rows: ImagePredictionRow[], fixtures: Fixture[]) {
  const matched: MatchedImagePrediction[] = [];
  const unmatched: Array<ImagePredictionRow & { reason: string }> = [];
  for (const row of rows) {
    const candidates = fixtures
      .map((fixture) => ({ fixture, score: (teamScore(row.homeTeam, fixture.homeTeam.name) + teamScore(row.awayTeam, fixture.awayTeam.name)) / 2 }))
      .filter((candidate) => candidate.score >= .7)
      .sort((left, right) => right.score - left.score);
    const candidate = candidates[0];
    if (!candidate) { unmatched.push({ ...row, reason: "No current fixture matched both team names." }); continue; }
    const market = marketSelection(row, candidate.fixture);
    if (!market) { unmatched.push({ ...row, reason: "The market text needs review before it can be converted safely." }); continue; }
    matched.push({ row, fixture: candidate.fixture, selection: { fixtureId: candidate.fixture.id, homeTeam: candidate.fixture.homeTeam.name, awayTeam: candidate.fixture.awayTeam.name, kickoff: candidate.fixture.kickoff, ...market } });
  }
  return { matched, unmatched };
}
