"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fallbackSnapshot, loadSnapshot, type Fixture, type Snapshot, type Team } from "../data";
import "./matches.css";

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSnapshot().then(setSnapshot).catch(() => undefined).finally(() => setLoading(false));
  }, []);

  const allFixtures = useMemo(() => uniqueFixtures([...(snapshot.liveFixtures ?? []), ...(snapshot.fixtures ?? [])]), [snapshot.fixtures, snapshot.liveFixtures]);
  const counts = useMemo(() => ({
    live: allFixtures.filter((fixture) => fixture.status === "LIVE").length,
    today: allFixtures.filter((fixture) => dayKey(fixture.kickoff) === dayKey(new Date())).length,
    upcoming: allFixtures.filter((fixture) => fixture.status === "SCHEDULED" && dayKey(fixture.kickoff) !== dayKey(new Date())).length,
  }), [allFixtures]);

  const visible = useMemo(() => allFixtures.filter((fixture) => {
    const text = `${fixture.homeTeam.name} ${fixture.awayTeam.name} ${fixture.league.name} ${fixture.league.country ?? ""}`.toLowerCase();
    if (!text.includes(search.trim().toLowerCase())) return false;
    if (view === "live") return fixture.status === "LIVE";
    if (view === "today") return dayKey(fixture.kickoff) === dayKey(new Date());
    return fixture.status === "SCHEDULED" && dayKey(fixture.kickoff) !== dayKey(new Date());
  }).sort((a, b) => a.kickoff.localeCompare(b.kickoff)), [allFixtures, search, view]);

  const groups = useMemo(() => {
    const result = new Map<string, Fixture[]>();
    for (const fixture of visible) {
      const key = dayKey(fixture.kickoff);
      result.set(key, [...(result.get(key) ?? []), fixture]);
    }
    return [...result.entries()];
  }, [visible]);

  return <main className="matches-app">
    <header className="matches-header">
      <Link className="matches-brand" href="/" aria-label="OddsAura home"><span>↗</span>Odds<i>Aura</i></Link>
      <nav aria-label="Main navigation"><Link href="/builder">Build a slip</Link><Link href="/">Predictions</Link></nav>
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

    <div className="matches-summary"><span>{loading ? "Refreshing match data…" : `${visible.length} ${visible.length === 1 ? "match" : "matches"}`}</span><small>{snapshot.message}</small></div>

    <section className="matches-groups" aria-live="polite">
      {groups.map(([key, fixtures]) => <section className="matches-day" key={key}>
        <header><h2>{dateLabel(key)}</h2><span>{fixtures.length} {fixtures.length === 1 ? "fixture" : "fixtures"}</span></header>
        <div className="matches-grid">{fixtures.map((fixture) => <article className="matches-card" key={fixture.id}>
          <div className="matches-card-top"><span>{fixture.league.name}{fixture.league.country ? ` · ${fixture.league.country}` : ""}</span>{fixture.status === "LIVE" ? <b className="matches-live">Live</b> : <time dateTime={fixture.kickoff}>{new Date(fixture.kickoff).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>}</div>
          <div className="matches-teams">
            <div><TeamMark team={fixture.homeTeam} /><strong>{fixture.homeTeam.name}</strong>{fixture.status === "LIVE" && <b>{fixture.homeScore ?? "–"}</b>}</div>
            <div><TeamMark team={fixture.awayTeam} /><strong>{fixture.awayTeam.name}</strong>{fixture.status === "LIVE" && <b>{fixture.awayScore ?? "–"}</b>}</div>
          </div>
          {fixture.odds?.length ? <div className="matches-prices">{fixture.odds.slice(0, 3).map((odd) => <span key={`${odd.marketId}-${odd.selectionId}`}><small>{odd.selection}</small><b>{odd.odds.toFixed(2)}</b></span>)}</div> : <p className="matches-waiting">Markets are still being checked.</p>}
          <div className="matches-card-foot"><span>{fixture.odds?.length ?? 0} verified prices</span>{fixture.odds?.length ? <Link href={`/builder?fixture=${encodeURIComponent(fixture.id)}`}>Add a pick <b>→</b></Link> : <span>Not selectable yet</span>}</div>
        </article>)}</div>
      </section>)}
      {!loading && !visible.length && <div className="matches-empty"><strong>{view === "live" ? "No match is live right now." : "No matches found in this view."}</strong><p>{view === "live" ? "Today and Upcoming remain available while the collector checks again automatically." : "Try another team, league or match period."}</p>{view === "live" && <button type="button" onClick={() => setView("today")}>See today’s matches</button>}</div>}
    </section>

    <footer className="matches-footer"><span>OddsAura</span><p>18+ · Match data may be delayed. Predictions are information, not guarantees.</p></footer>
  </main>;
}
