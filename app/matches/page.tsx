"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Brand from "../brand";
import { fallbackSnapshot, loadSnapshot, type Fixture, type Snapshot, type Team } from "../data";
import { LEAGUE_FILTERS, leagueMatches, type LeagueFilter } from "../leagues";
import "./matches.css";
import "./matches-more.css";

/* Dynamic football feeds supply arbitrary badge hosts, so a native image with a text fallback is intentional. */
/* eslint-disable @next/next/no-img-element */

type View = "today" | "live" | "upcoming";

const dayKey = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

function TeamMark({ team }: { team: Team }) {
  const [failed, setFailed] = useState(false);
  return <span className="matches-team-mark" aria-hidden="true">
    {!failed && team.logo ? <img src={team.logo} alt="" loading="lazy" onError={() => setFailed(true)} /> : initials(team.shortName || team.name)}
  </span>;
}

function dateLabel(key: string) {
  const today = dayKey(new Date());
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  if (key === today) return "Today";
  if (key === dayKey(tomorrowDate)) return "Tomorrow";
  const [year, month, date] = key.split("-").map(Number);
  return new Date(year, month, date).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

function uniqueFixtures(fixtures: Fixture[]) {
  return [...new Map(fixtures.map((fixture) => [fixture.id, fixture])).values()];
}

export default function MatchesPage() {
  const [snapshot, setSnapshot] = useState<Snapshot>(fallbackSnapshot);
  const [view, setView] = useState<View>("today");
  const [search, setSearch] = useState("");
  const [league, setLeague] = useState<LeagueFilter>("ALL");
  const [limit, setLimit] = useState(120);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSnapshot().then(setSnapshot).catch(() => undefined).finally(() => setLoading(false));
  }, []);

  const allFixtures = useMemo(() => uniqueFixtures([...(snapshot.liveFixtures ?? []), ...(snapshot.fixtures ?? [])]), [snapshot.fixtures, snapshot.liveFixtures]);
  const predictionsByFixture = useMemo(() => {
    const result = new Map<string, NonNullable<Snapshot["predictedPicks"]>>();
    for (const pick of snapshot.predictedPicks ?? []) result.set(pick.fixtureId, [...(result.get(pick.fixtureId) ?? []), pick]);
    return result;
  }, [snapshot.predictedPicks]);
  const counts = useMemo(() => ({
    live: allFixtures.filter((fixture) => fixture.status === "LIVE").length,
    today: allFixtures.filter((fixture) => dayKey(fixture.kickoff) === dayKey(new Date())).length,
    upcoming: allFixtures.filter((fixture) => fixture.status === "SCHEDULED" && dayKey(fixture.kickoff) !== dayKey(new Date())).length,
  }), [allFixtures]);

  const visible = useMemo(() => allFixtures.filter((fixture) => {
    const text = `${fixture.homeTeam.name} ${fixture.awayTeam.name} ${fixture.league.name} ${fixture.league.country ?? ""}`.toLowerCase();
    if (!text.includes(search.trim().toLowerCase())) return false;
    if (!leagueMatches(fixture.league, league)) return false;
    if (view === "live") return fixture.status === "LIVE";
    if (view === "today") return dayKey(fixture.kickoff) === dayKey(new Date());
    return fixture.status === "SCHEDULED" && dayKey(fixture.kickoff) !== dayKey(new Date());
  }).sort((a, b) => a.kickoff.localeCompare(b.kickoff)), [allFixtures, search, view, league]);

  const groups = useMemo(() => {
    const result = new Map<string, Fixture[]>();
    for (const fixture of visible.slice(0, limit)) {
      const key = dayKey(fixture.kickoff);
      result.set(key, [...(result.get(key) ?? []), fixture]);
    }
    return [...result.entries()];
  }, [limit, visible]);

  return <main className="matches-app">
    <header className="matches-header">
      <Brand className="matches-brand" href="/dashboard" />
      <nav aria-label="Main navigation"><Link href="/builder">Build a slip</Link><Link href="/results">Results</Link><Link href="/dashboard">Predictions</Link><Link href="/account">Account</Link></nav>
    </header>

    <section className="matches-hero">
      <div><span className="matches-kicker">Football centre</span><h1>Find a match.<br /><i>See what matters.</i></h1></div>
      <p>Live scores, today’s fixtures and the next seven days in one simple view. Team badges come directly from the active football feed.</p>
    </section>

    <section className="matches-controls" aria-label="Match filters">
      <div className="matches-tabs" role="tablist" aria-label="Fixture period">
        <button type="button" role="tab" aria-selected={view === "live"} className={view === "live" ? "active" : ""} onClick={() => setView("live")}><span className="live-dot" />Live <b>{counts.live}</b></button>
        <button type="button" role="tab" aria-selected={view === "today"} className={view === "today" ? "active" : ""} onClick={() => setView("today")}>Today <b>{counts.today}</b></button>
        <button type="button" role="tab" aria-selected={view === "upcoming"} className={view === "upcoming" ? "active" : ""} onClick={() => setView("upcoming")}>Upcoming <b>{counts.upcoming}</b></button>
      </div>
      <label className="matches-search"><span>Search</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Team or league" /></label>
    </section>
    <div className="matches-league-tabs" aria-label="League filter">{LEAGUE_FILTERS.map((item) => <button type="button" key={item.id} className={league === item.id ? "active" : ""} onClick={() => { setLeague(item.id); setLimit(120); }}>{item.label}</button>)}</div>

    <div className="matches-summary"><span>{loading ? "Refreshing match data…" : `Showing ${Math.min(limit, visible.length)} of ${visible.length} ${visible.length === 1 ? "match" : "matches"}`}</span><small>{snapshot.message}</small></div>

    <section className="matches-groups" aria-live="polite">
      {groups.map(([key, fixtures]) => <section className="matches-day" key={key}>
        <header><h2>{dateLabel(key)}</h2><span>{fixtures.length} {fixtures.length === 1 ? "fixture" : "fixtures"}</span></header>
        <div className="matches-grid">{fixtures.map((fixture) => { const modelPicks = predictionsByFixture.get(fixture.id) ?? []; return <article className="matches-card" key={fixture.id}>
          <div className="matches-card-top"><span>{fixture.league.name}{fixture.league.country ? ` · ${fixture.league.country}` : ""}</span>{fixture.status === "LIVE" ? <b className="matches-live">Live</b> : <time dateTime={fixture.kickoff}>{new Date(fixture.kickoff).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>}</div>
          <div className="matches-teams">
            <div><TeamMark team={fixture.homeTeam} /><strong>{fixture.homeTeam.name}</strong>{fixture.status === "LIVE" && <b>{fixture.homeScore ?? "–"}</b>}</div>
            <div><TeamMark team={fixture.awayTeam} /><strong>{fixture.awayTeam.name}</strong>{fixture.status === "LIVE" && <b>{fixture.awayScore ?? "–"}</b>}</div>
          </div>
          {modelPicks.length ? <div className="matches-prices">{modelPicks.slice(0, 3).map((pick) => <span key={pick.id}><small>{pick.selection}</small><b>{pick.quotedOdds?.toFixed(2) ?? `Fair ${pick.fairOdds.toFixed(2)}`}</b></span>)}</div> : <p className="matches-waiting">A prediction will appear after the next model refresh.</p>}
          <div className="matches-card-foot"><span>{modelPicks.length} modelled {modelPicks.length === 1 ? "pick" : "picks"}</span>{modelPicks.length ? <Link href={`/builder?fixture=${encodeURIComponent(fixture.id)}`}>Choose prediction <b>→</b></Link> : <span>Not selectable yet</span>}</div>
        </article>; })}</div>
      </section>)}
      {visible.length > limit && <button className="matches-more" type="button" onClick={() => setLimit((value) => value + 120)}>Load 120 more matches</button>}
      {!loading && !visible.length && <div className="matches-empty"><strong>{view === "live" ? "No match is live right now." : "No matches found in this view."}</strong><p>{view === "live" ? "Today and Upcoming remain available while the collector checks again automatically." : "Try another team, league or match period."}</p>{view === "live" && <button type="button" onClick={() => setView("today")}>See today’s matches</button>}</div>}
    </section>

    <footer className="matches-footer"><span>OddsAura</span><p>18+ · Match data may be delayed. Predictions are information, not guarantees.</p></footer>
  </main>;
}
