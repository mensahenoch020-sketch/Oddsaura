import type { Fixture } from "../data";
import type { BookmakerSelection } from "../builder/providers";

export type ImagePredictionRow = {
  homeTeam: string;
  awayTeam: string;
  selectionTeam?: string;
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
const isMarket = (value: string) => /\b(?:over|under)(?=\s*\d)|\b(btts|both teams|double chance|draw no bet|dnb|handicap|home win|away win|match result|to score|win or draw|moneyline|ml|1up|1 up|2up|2 up)\b/i.test(value);
const isNoise = (value: string) => /^(predictions? of the day|combined odds|kick.?off|time|odds|selection|match|today|tomorrow|preview)$/i.test(value) || /(?:europe:|uefa nations league|league [abcd])\b/i.test(value) || /^(?:[a-z]\s+){2,}[a-z](?:\s+\d+)?$/i.test(value) || /^\d{1,2}:\d{2}\s*(?:am|pm)?$/i.test(value);

function scrubOcrDecorations(value: string) {
  return clean(value
    .replace(/\bpreview\b/ig, " ")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ")
    .replace(/(?:^|\s)[+-]\d{2,4}(?=\s|$)/g, " ")
    .replace(/^[★⭐*✓✅☑✔+=$£§#%\s]+/u, " ")
    .replace(/^\d{1,2}\s+(?=[A-Z])/u, " ")
    .replace(/^(?:ass|ar|au)\s+(?=[A-Z])/u, " ")
    .replace(/^KX\s+om\.?\s+(?=[A-Z])/u, " ")
    .replace(/\s+(?:[A-Za-z]{1,2}\s+)?\d{3,4}$/u, " ")
    .replace(/\s+[a-z]$/u, " ")
    .replace(/[+$£]\s*$/u, " "));
}

function stripListPrefix(value: string) {
  return clean(value.replace(/^[✅☑✔★⭐\s]*/u, "").replace(/^\d{1,2}[.)]\s*/, ""));
}

function singleTeamRow(value: string): ImagePredictionRow | null {
  const line = stripListPrefix(value).replace(/\b1tup\b/i, "1UP");
  const match = line.match(/^(.{2,55}?)\s*[-–—:]\s*((?:1|2)\s*up|(?:1|2)up|up|ml|moneyline|home win|away win)(?:\s+(\d+(?:\.\d+)?))?$/i);
  if (!match) return null;
  const team = clean(match[1]!);
  if (!team || isMarket(team)) return null;
  const marketText = /^up$/i.test(clean(match[2]!)) ? "1UP" : clean(match[2]!).replace(/1tup/i, "1UP");
  return { homeTeam: team, awayTeam: "", selectionTeam: team, marketText, odds: match[3] ? Number(match[3]) : null };
}

function standaloneTeamMarketRow(value: string): ImagePredictionRow | null {
  const line = scrubOcrDecorations(value).replace(/\b1tup\b/i, "1UP");
  const match = line.match(/^(.{2,55}?)\s+(ml|moneyline|1up|2up)(?:\s+[a-z0-9 ]{1,12})?$/i);
  if (!match) return null;
  const team = clean(match[1]!);
  if (!team || isMarket(team)) return null;
  return { homeTeam: team, awayTeam: "", selectionTeam: team, marketText: clean(match[2]!), odds: null };
}

function splitAwayAndMarket(value: string, homeTeam: string) {
  const next = scrubOcrDecorations(value);
  const escaped = homeTeam.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const repeatedTeam = next.match(new RegExp(`^(.{2,55}?)\\s+(${escaped}\\s+(?:ml|moneyline|1t?up|2up))$`, "i"));
  if (repeatedTeam) return { awayTeam: clean(repeatedTeam[1]!), marketText: clean(repeatedTeam[2]!).replace(/1tup/i, "1UP") };
  const general = next.match(/^(.{2,55}?)\s+[^a-z0-9]{0,4}((?:over|under)\s*\d+(?:\.\d+)?|(?:1|2)\s*up|(?:1|2)up)\b/i);
  return general ? { awayTeam: clean(general[1]!), marketText: clean(general[2]!) } : null;
}

export function parsePredictionImageText(raw: string): ImagePredictionRow[] {
  const lines = raw.split(/\r?\n/).map(scrubOcrDecorations).filter((line) => line.length > 1 && (normalized(line).replace(/\d/g, "").length > 2 || /^\d+\.\d+$/.test(line)) && !isNoise(line));
  const rows: ImagePredictionRow[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const single = singleTeamRow(lines[index]!);
    if (single) {
      rows.push(single);
      continue;
    }
    const nextStandalone = standaloneTeamMarketRow(lines[index + 1] ?? "");
    const nextSplit = splitAwayAndMarket(lines[index + 1] ?? "", lines[index]!);
    if (nextStandalone && !nextSplit && teamScore(nextStandalone.selectionTeam ?? "", lines[index]!) >= .8) {
      rows.push({ ...nextStandalone, homeTeam: lines[index]!, selectionTeam: lines[index]! });
      index += 1;
      continue;
    }
    let homeTeam = "";
    let awayTeam = "";
    let consumed = 0;
    let directMarket = "";
    let directMarketIndex = -1;
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
      } else {
        const combinedAway = splitAwayAndMarket(next, lines[index]!);
        const followingMarket = lines[index + 2] ?? "";
        if (combinedAway && !isMarket(lines[index]!)) {
          homeTeam = lines[index]!;
          awayTeam = combinedAway.awayTeam;
          directMarket = combinedAway.marketText;
          directMarketIndex = index + 1;
          consumed = 1;
        } else if (isMarket(next) && lines[index + 2] && !isMarket(lines[index + 2]!)) {
          homeTeam = lines[index]!;
          awayTeam = lines[index + 2]!;
          directMarket = next;
          directMarketIndex = index + 1;
          consumed = 2;
        } else if (!isMarket(lines[index]!) && next && !isMarket(next) && splitAwayAndMarket(followingMarket, lines[index]!)) {
          const recovered = splitAwayAndMarket(followingMarket, lines[index]!)!;
          homeTeam = lines[index]!;
          awayTeam = recovered.awayTeam;
          directMarket = recovered.marketText;
          directMarketIndex = index + 2;
          consumed = 2;
        } else if (!isMarket(lines[index]!) && next && !isMarket(next) && isMarket(followingMarket)) {
          homeTeam = lines[index]!;
          awayTeam = next;
          consumed = 1;
        }
      }
    }
    if (!homeTeam || !awayTeam || isMarket(homeTeam) || isMarket(awayTeam)) {
      const standalone = standaloneTeamMarketRow(lines[index]!);
      if (standalone) rows.push(standalone);
      continue;
    }

    const tail = lines.slice(index + consumed + 1, index + consumed + 6);
    const marketText = directMarket || tail.find(isMarket) || "";
    if (!marketText) continue;
    const marketIndex = directMarketIndex >= 0 ? directMarketIndex : index + consumed + 1 + tail.findIndex(isMarket);
    const oddsLine = tail.filter((line) => line !== marketText).find((line) => /\b\d+\.\d{1,3}\b/.test(line));
    const odds = oddsLine?.match(/\b(\d+\.\d{1,3})\b/)?.[1];
    rows.push({ homeTeam, awayTeam, marketText, odds: odds ? Number(odds) : null });
    index = Math.max(index + consumed, marketIndex);
  }
  return rows.filter((row, index, all) => {
    // Repeated team-only picks may refer to different fixtures or dates. Keep
    // each one visible for review instead of silently discarding image content.
    if (row.selectionTeam && !row.awayTeam) return true;
    return all.findIndex((candidate) => normalized(candidate.homeTeam) === normalized(row.homeTeam) && normalized(candidate.awayTeam) === normalized(row.awayTeam) && normalized(candidate.marketText) === normalized(row.marketText)) === index;
  });
}

const typedMarketSuffix = /((?:(?:home|away)\s+)?(?:1\s*up|2\s*up|win|moneyline|ml|draw no bet|dnb|over\s*\d+(?:\.\d+)?|under\s*\d+(?:\.\d+)?|(?:asian\s+)?handicap\s*[+-]\d+(?:\.\d+)?|to score|over\s*\d+(?:\.\d+)?)|draw|1x|x2|12|btts\s*(?:yes|no)|both teams to score\s*(?:yes|no))$/i;

/** Parse selections deliberately typed by a user, without treating them as
 * model recommendations. Each clause must name both teams and a market. */
export function parseTypedPredictionText(raw: string): ImagePredictionRow[] {
  return raw
    .split(/[;\n]+/)
    .map(value => value.replace(/^\s*(?:create|make|build|turn|convert)?\s*(?:a\s+)?(?:code|slip)?\s*(?:for|from|with)?\s*/i, "").replace(/\s+(?:on|for)\s+(?:sporty\s*bet|bet9ja|betpawa|betway|betking)\s*$/i, "").trim())
    .flatMap((value): ImagePredictionRow[] => {
      const versus = value.match(/^(.{2,60}?)\s+(?:vs\.?|versus|v|against)\s+(.+)$/i);
      if (!versus) return [];
      const suffix = versus[2]!.match(typedMarketSuffix);
      if (!suffix || suffix.index == null) return [];
      const homeTeam = clean(versus[1]!);
      const awayTeam = clean(versus[2]!.slice(0, suffix.index));
      const marketText = clean(suffix[1]!);
      let selectionTeam: string | undefined;
      if (/^home\b/i.test(marketText)) {
        selectionTeam = homeTeam;
      } else if (/^away\b/i.test(marketText)) {
        selectionTeam = awayTeam;
      }
      return homeTeam && awayTeam ? [{ homeTeam, awayTeam, selectionTeam, marketText, odds: null }] : [];
    });
}

function teamScore(left: string, right: string) {
  const a = normalized(left), b = normalized(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return .88;
  const tokens = (value: string) => value.split(" ").filter((word) => word.length > 2).map((word) => word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word);
  const editDistance = (leftWord: string, rightWord: string) => {
    const row = Array.from({ length: rightWord.length + 1 }, (_, index) => index);
    for (let leftIndex = 1; leftIndex <= leftWord.length; leftIndex += 1) {
      let previous = row[0]!;
      row[0] = leftIndex;
      for (let rightIndex = 1; rightIndex <= rightWord.length; rightIndex += 1) {
        const current = row[rightIndex]!;
        row[rightIndex] = Math.min(row[rightIndex]! + 1, row[rightIndex - 1]! + 1, previous + (leftWord[leftIndex - 1] === rightWord[rightIndex - 1] ? 0 : 1));
        previous = current;
      }
    }
    return row[rightWord.length]!;
  };
  const leftWords = tokens(a);
  const rightWords = tokens(b);
  if (!leftWords.length || !rightWords.length) return 0;
  const directional = (source: string[], target: string[]) => source.reduce((total, word) => {
    const best = Math.max(...target.map((candidate) => 1 - editDistance(word, candidate) / Math.max(word.length, candidate.length)));
    return total + Math.max(0, best);
  }, 0) / source.length;
  return Math.max(directional(leftWords, rightWords), directional(rightWords, leftWords));
}

function marketSelection(row: ImagePredictionRow, fixture: Fixture): Omit<BookmakerSelection, "fixtureId" | "homeTeam" | "awayTeam" | "kickoff"> | null {
  const text = normalized(row.marketText);
  const numericText = row.marketText.toLowerCase().replace(/,/g, ".");
  const selectedTeam = row.selectionTeam || row.marketText.replace(/\b(?:ml|moneyline|1up|1 up|2up|2 up)\b/ig, "").trim();
  const selectedAway = selectedTeam ? teamScore(selectedTeam, fixture.awayTeam.name) > teamScore(selectedTeam, fixture.homeTeam.name) : false;
  if (/\b1\s*up\b/.test(numericText)) {
    return { marketKey: selectedAway ? "ONE_UP_AWAY" : "ONE_UP_HOME", marketName: "1UP", selection: selectedAway ? fixture.awayTeam.name : fixture.homeTeam.name, quotedOdds: row.odds };
  }
  if (/\b2\s*up\b/.test(numericText)) {
    return { marketKey: selectedAway ? "TWO_UP_AWAY" : "TWO_UP_HOME", marketName: "2UP", selection: selectedAway ? fixture.awayTeam.name : fixture.homeTeam.name, quotedOdds: row.odds };
  }
  if (/\b(?:ml|moneyline)\b/.test(text)) {
    return { marketKey: selectedAway ? "MATCH_AWAY" : "MATCH_HOME", marketName: "Match result", selection: selectedAway ? fixture.awayTeam.name : fixture.homeTeam.name, quotedOdds: row.odds };
  }
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
    const away = selectedAway || /away|team 2/.test(text) || normalized(row.marketText).includes(normalized(fixture.awayTeam.name));
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
    const away = selectedAway || /away|team 2/.test(text) || text.includes(normalized(fixture.awayTeam.name));
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
    const singleTeam = Boolean(row.selectionTeam && !row.awayTeam);
    const candidates = fixtures
      .map((fixture) => {
        const awayEvidence = `${row.awayTeam} ${row.marketText}`;
        const direct = (teamScore(row.homeTeam, fixture.homeTeam.name) + teamScore(awayEvidence, fixture.awayTeam.name)) / 2;
        const reversed = (teamScore(row.homeTeam, fixture.awayTeam.name) + teamScore(awayEvidence, fixture.homeTeam.name)) / 2;
        return { fixture, score: singleTeam
          ? Math.max(teamScore(row.selectionTeam!, fixture.homeTeam.name), teamScore(row.selectionTeam!, fixture.awayTeam.name))
          : Math.max(direct, reversed) };
      })
      .filter((candidate) => candidate.score >= .7)
      .sort((left, right) => right.score - left.score);
    const candidate = candidates[0];
    if (!candidate) { unmatched.push({ ...row, reason: singleTeam ? "No current fixture matched that team." : "No current fixture matched both team names." }); continue; }
    if (singleTeam && candidates.length > 1 && candidates[1]!.score >= candidate.score - .08) {
      unmatched.push({ ...row, reason: "More than one current fixture matches this team. Add the opponent, date or competition before creating a code." });
      continue;
    }
    const market = marketSelection(row, candidate.fixture);
    if (!market) { unmatched.push({ ...row, reason: "The market text needs review before it can be converted safely." }); continue; }
    matched.push({ row, fixture: candidate.fixture, selection: { fixtureId: candidate.fixture.id, homeTeam: candidate.fixture.homeTeam.name, awayTeam: candidate.fixture.awayTeam.name, kickoff: candidate.fixture.kickoff, ...market } });
  }
  return { matched, unmatched };
}
