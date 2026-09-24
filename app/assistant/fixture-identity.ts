import type { Fixture } from "../data";

const teamAliases: Record<string, string> = {
  "man-city": "manchester-city",
  "man-utd": "manchester-united",
  "man-united": "manchester-united",
  wolves: "wolverhampton-wanderers",
  wolverhampton: "wolverhampton-wanderers",
  spurs: "tottenham-hotspur",
  tottenham: "tottenham-hotspur",
  newcastle: "newcastle-united",
  "west-ham": "west-ham-united",
  brighton: "brighton-and-hove-albion",
};

function canonicalTeam(team: Fixture["homeTeam"]) {
  const [rawName, ...rawScope] = String(team.id || team.name).split("::");
  const identity = rawName!
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(fc|afc|cf|sc|football club)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return [teamAliases[identity] ?? identity, ...rawScope.map((part) => part.toLowerCase())].join("::");
}

/** A source-neutral identity for duplicate copies of the same historical fixture. */
export function canonicalFixtureIdentity(fixture: Fixture, competition: string) {
  const time = Date.parse(fixture.kickoff);
  const day = Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : fixture.kickoff.slice(0, 10);
  return `${competition}|${day}|${canonicalTeam(fixture.homeTeam)}|${canonicalTeam(fixture.awayTeam)}`;
}
