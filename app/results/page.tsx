"use client";

import { useEffect, useMemo, useState } from "react";
import ProductNavigation from "../product-navigation";
import { fallbackSnapshot, loadSnapshot, refreshSnapshot, type Fixture, type Snapshot, type Ticket } from "../data";
import "./results.css";
import "./results-shell.css";
import "./results-personal.css";

const money = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });
type Period = "TODAY" | "7D" | "30D" | "ALL";
type StatusFilter = "SETTLED" | "ALL" | "WON" | "LOST" | "PENDING";
type Settlement = "PENDING" | "WON" | "LOST" | "VOID" | "UNVERIFIED";
type RequestedPick = { fixtureId: string; homeTeam: string; awayTeam: string; kickoff?: string; marketKey: string; marketName: string; selection: string; line?: number | null };
type PersonalCode = { id: string; provider: string; code: string; createdAt: number; selections: { requested?: RequestedPick[] } };
type ModelPerformance = { matches: number; oneXTwoAccuracy: number; over25Accuracy: number; brierScore: number; generatedAt: string };

function startOfDay(timestamp: number) {
  const value = new Date(timestamp);
  value.setHours(0, 0, 0, 0);
  return value.getTime();
}

const normalTeam = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(?:utd|united)\b/g, " united ").replace(/\b(fc|cf|sc|afc|club|football|de|the)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

function teamMatch(left: string, right: string) {
  const a = new Set(normalTeam(left).split(" ").filter(Boolean)); const b = new Set(normalTeam(right).split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  const x = [...a].join(" "), y = [...b].join(" ");
  return Math.max([...a].filter((word) => b.has(word)).length / new Set([...a, ...b]).size, x === y ? 1 : x.includes(y) || y.includes(x) ? .92 : 0);
}

function resultFixture(pick: RequestedPick, fixtures: Fixture[] = []) {
  const exact = fixtures.find((fixture) => fixture.id === pick.fixtureId);
  if (exact) return exact;
  const kickoff = pick.kickoff ? Date.parse(pick.kickoff) : null;
  return fixtures.map((fixture) => {
    const names = (teamMatch(pick.homeTeam, fixture.homeTeam.name) + teamMatch(pick.awayTeam, fixture.awayTeam.name)) / 2;
    const delta = kickoff ? Math.abs(kickoff - Date.parse(fixture.kickoff)) : null;
    return { fixture, names, delta, score: names * .88 + (delta == null ? .5 : Math.max(0, 1 - delta / 43_200_000)) * .12 };
  }).filter((row) => row.names >= .72 && (row.delta == null || row.delta <= 43_200_000)).sort((a, b) => b.score - a.score)[0]?.fixture;
}

function marketLine(selection: RequestedPick) {
  if (selection.line != null && Number.isFinite(Number(selection.line))) return Number(selection.line);
  const match = selection.marketKey.match(/_(\d+)_(\d+)$/); return match ? Number(`${match[1]}.${match[2]}`) : NaN;
}

function settlePersonal(selection: RequestedPick, fixture?: Fixture): Settlement {
  if (fixture && ["CANCELLED", "POSTPONED"].includes(fixture.status)) return "VOID";
  if (!fixture || fixture.status !== "FINISHED" || fixture.homeScore == null || fixture.awayScore == null) return "PENDING";
  const home = Number(fixture.homeScore); const away = Number(fixture.awayScore); const total = home + away; const line = marketLine(selection); const key = selection.marketKey;
  if (key.startsWith("HCP_3WAY_") && Number.isFinite(line)) {
    const adjusted = home + line - away;
    return (key === "HCP_3WAY_HOME" ? adjusted > 0 : key === "HCP_3WAY_AWAY" ? adjusted < 0 : key === "HCP_3WAY_DRAW" ? adjusted === 0 : false) ? "WON" : "LOST";
  }
  if (key === "MATCH_HOME") return home > away ? "WON" : "LOST";
  if (key === "MATCH_DRAW") return home === away ? "WON" : "LOST";
  if (key === "MATCH_AWAY") return away > home ? "WON" : "LOST";
  if (key === "DC_1X") return home >= away ? "WON" : "LOST";
  if (key === "DC_X2") return away >= home ? "WON" : "LOST";
  if (key === "DC_12") return home !== away ? "WON" : "LOST";
  if (key === "DNB_HOME") return home === away ? "VOID" : home > away ? "WON" : "LOST";
  if (key === "DNB_AWAY") return home === away ? "VOID" : away > home ? "WON" : "LOST";
  if (key === "BTTS_YES") return home > 0 && away > 0 ? "WON" : "LOST";
  if (key === "BTTS_NO") return home === 0 || away === 0 ? "WON" : "LOST";
  if (key === "HOME_CLEAN") return away === 0 ? "WON" : "LOST";
  if (key === "AWAY_CLEAN") return home === 0 ? "WON" : "LOST";
  if (key === "HOME_WIN_NIL") return home > away && away === 0 ? "WON" : "LOST";
  if (key === "AWAY_WIN_NIL") return away > home && home === 0 ? "WON" : "LOST";
  if (key === "HOME_AND_O15") return home > away && total > 1.5 ? "WON" : "LOST";
  if (key === "AWAY_AND_O15") return away > home && total > 1.5 ? "WON" : "LOST";
  if (key === "ODD_GOALS") return total % 2 === 1 ? "WON" : "LOST";
  if (key === "EVEN_GOALS") return total % 2 === 0 ? "WON" : "LOST";
  const correctScore = key.match(/^CS_(\d+)_(\d+)$/);
  if (correctScore) return home === Number(correctScore[1]) && away === Number(correctScore[2]) ? "WON" : "LOST";
  const compare = (value: number, direction: "OVER" | "UNDER"): Settlement => value === line ? "VOID" : direction === "OVER" ? value > line ? "WON" : "LOST" : value < line ? "WON" : "LOST";
  if (key.startsWith("HOME_OVER_")) return compare(home, "OVER");
  if (key.startsWith("HOME_UNDER_")) return compare(home, "UNDER");
  if (key.startsWith("AWAY_OVER_")) return compare(away, "OVER");
  if (key.startsWith("AWAY_UNDER_")) return compare(away, "UNDER");
  if (key.startsWith("OVER_")) return compare(total, "OVER");
  if (key.startsWith("UNDER_")) return compare(total, "UNDER");
  return "UNVERIFIED";
}

const finalScore = (fixture?: Fixture) => fixture?.status === "FINISHED" && fixture.homeScore != null && fixture.awayScore != null ? `${fixture.homeScore}–${fixture.awayScore}` : null;

function settleTicketNow(ticket: Ticket, fixtures: Fixture[]): Ticket {
  const selections = ticket.selections.map((selection) => {
    const fixture = resultFixture({ fixtureId: selection.fixtureId, homeTeam: selection.homeTeam.name, awayTeam: selection.awayTeam.name, kickoff: selection.kickoff, marketKey: selection.market.key, marketName: selection.market.name, selection: selection.selection, line: selection.market.line }, fixtures);
    const current = settlePersonal({ fixtureId: selection.fixtureId, homeTeam: selection.homeTeam.name, awayTeam: selection.awayTeam.name, kickoff: selection.kickoff, marketKey: selection.market.key, marketName: selection.market.name, selection: selection.selection, line: selection.market.line }, fixture);
    const result = current === "PENDING" && selection.result && selection.result !== "PENDING" ? selection.result : current;
    return { ...selection, result };
  });
  const lostLegs = selections.filter((selection) => selection.result === "LOST").length;
  const pending = selections.filter((selection) => selection.result === "PENDING").length;
  const unverified = selections.filter((selection) => selection.result === "UNVERIFIED").length;
  const voidLegs = selections.filter((selection) => selection.result === "VOID").length;
  const status = lostLegs ? "LOST" : pending ? "PENDING" : unverified ? "CHECK_BOOKMAKER" : voidLegs === selections.length ? "VOID" : "WON";
  return { ...ticket, selections, status, wonLegs: selections.filter((selection) => selection.result === "WON").length, lostLegs, voidLegs };
}

export default function ResultsPage() {
  const [snapshot, setSnapshot] = useState<Snapshot>(fallbackSnapshot);
  const [stake, setStake] = useState(1000);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("30D");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("SETTLED");
  const [referenceTime] = useState(() => Date.now());
  const [personalCodes, setPersonalCodes] = useState<PersonalCode[]>([]);
  const [model, setModel] = useState<ModelPerformance | null>(null);
  const [visibleTickets, setVisibleTickets] = useState(20);

  useEffect(() => {
    let active = true;
    const apply = (data: Snapshot) => { if (!active) return; setSnapshot((current) => Date.parse(data.generatedAt ?? "") >= Date.parse(current.generatedAt ?? "") || !current.generatedAt ? data : current); setModel(data.modelPerformance ?? null); setLoading(false); };
    const refreshResults = () => refreshSnapshot("results").then(apply).catch(() => undefined);
    const refreshCodes = () => fetch("/api/codes", { cache: "no-store" }).then((response) => response.ok ? response.json() : { codes: [] }).then((payload) => { if (active) setPersonalCodes(payload.codes ?? []); }).catch(() => undefined);
    loadSnapshot("results").then(apply).catch(() => undefined).finally(() => { if (active) setLoading(false); });
    void refreshResults(); void refreshCodes();
    const timer = window.setInterval(() => { void refreshResults(); void refreshCodes(); }, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const history = useMemo(() => (snapshot.ticketHistory ?? snapshot.tickets).map((ticket) => settleTicketNow(ticket, snapshot.recentResults ?? [])), [snapshot.ticketHistory, snapshot.tickets, snapshot.recentResults]);
  const periodTickets = useMemo(() => {
    if (period === "ALL") return history;
    const cutoff = period === "TODAY" ? startOfDay(referenceTime) : referenceTime - (period === "7D" ? 7 : 30) * 86_400_000;
    return history.filter((ticket) => new Date(ticket.publishedAt ?? snapshot.generatedAt ?? 0).getTime() >= cutoff);
  }, [history, period, referenceTime, snapshot.generatedAt]);
  const summary = useMemo(() => ({
    won: periodTickets.filter((ticket) => ticket.status === "WON").length,
    lost: periodTickets.filter((ticket) => ticket.status === "LOST").length,
    pending: periodTickets.filter((ticket) => ticket.status === "PENDING" || ticket.status === "PUBLISHED").length,
  }), [periodTickets]);
  const tickets = useMemo(() => periodTickets.filter((ticket) => statusFilter === "ALL" ? true : statusFilter === "SETTLED" ? ["WON", "LOST", "VOID", "CHECK_BOOKMAKER"].includes(ticket.status) : statusFilter === "PENDING" ? ["PENDING", "PUBLISHED"].includes(ticket.status) : ticket.status === statusFilter), [periodTickets, statusFilter]);
  const displayedTickets = useMemo(() => tickets.slice(0, visibleTickets), [tickets, visibleTickets]);
  const performance = useMemo(() => {
    const settled = periodTickets.filter((ticket) => ticket.strategyVersion === "reverse-market-v1" && (ticket.status === "WON" || ticket.status === "LOST"));
    const wins = settled.filter((ticket) => ticket.status === "WON");
    const priced = settled.filter((ticket) => ticket.priceStatus === "QUOTED");
    const pricedWins = priced.filter((ticket) => ticket.status === "WON");
    const staked = priced.length * stake;
    const returned = pricedWins.reduce((total, ticket) => total + stake * ticket.totalOdds, 0);
    return {
      settled: settled.length,
      hitRate: settled.length ? (wins.length / settled.length) * 100 : 0,
      roi: staked ? ((returned - staked) / staked) * 100 : null,
    };
  }, [periodTickets, stake]);

  function showStatus(value: StatusFilter) {
    setStatusFilter(value);
    setVisibleTickets(20);
    window.requestAnimationFrame(() => document.getElementById("ticket-results")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return <main className="results-app">
    <ProductNavigation active="results" />
    <section className="results-hero"><div><span>{snapshot.generatedAt ? `Auto-updated ${new Date(snapshot.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Ticket tracker"}</span><h1>Results without<br /><i>the guesswork.</i></h1></div><p>OddsAura checks for fresh scores every minute and marks every supported pick Won, Lost, Void or Pending. Bookmaker settlement remains final.</p></section>
    <nav className="results-periods" aria-label="Results period">{([['TODAY', 'Today'], ['7D', '7 days'], ['30D', '30 days'], ['ALL', 'Archive']] as const).map(([value, label]) => <button type="button" key={value} className={period === value ? "active" : ""} onClick={() => { setPeriod(value); setVisibleTickets(20); }}>{label}</button>)}</nav>
    <section className="results-summary"><button type="button" className={statusFilter === "WON" ? "active" : ""} onClick={() => showStatus("WON")}><span>Won</span><strong>{summary.won}</strong></button><button type="button" className={statusFilter === "LOST" ? "active" : ""} onClick={() => showStatus("LOST")}><span>Lost</span><strong>{summary.lost}</strong></button><button type="button" className={statusFilter === "PENDING" ? "active" : ""} onClick={() => showStatus("PENDING")}><span>Pending</span><strong>{summary.pending}</strong></button><label><span>Stake calculator</span><div>₦<input type="number" min="0" step="100" value={stake} onChange={(event) => setStake(Math.max(0, Number(event.target.value) || 0))} /></div></label></section>
    <nav className="results-statuses" aria-label="Ticket status">{([['SETTLED', 'Settled'], ['WON', 'Won'], ['LOST', 'Lost'], ['PENDING', 'Pending'], ['ALL', 'All']] as const).map(([value, label]) => <button type="button" key={value} className={statusFilter === value ? "active" : ""} onClick={() => showStatus(value)}>{label}</button>)}</nav>
    <section className="results-performance" aria-label="Current strategy performance"><article><span>New strategy settled</span><strong>{performance.settled}</strong></article><article><span>New strategy hit rate</span><strong>{performance.settled ? `${performance.hitRate.toFixed(1)}%` : "—"}</strong></article><article><span>New strategy ROI</span><strong className={performance.roi != null && performance.roi < 0 ? "negative" : ""}>{performance.roi == null ? "—" : `${performance.roi >= 0 ? "+" : ""}${performance.roi.toFixed(1)}%`}</strong></article></section>
    {model ? <section className="model-scorecard" aria-label="Model scorecard"><header><span>Historical model test</span><b>{model.matches} completed matches</b></header><div><article><span>Correct 1X2 picks</span><strong>{(model.oneXTwoAccuracy * 100).toFixed(1)}%</strong></article><article><span>Correct O/U 2.5 picks</span><strong>{(model.over25Accuracy * 100).toFixed(1)}%</strong></article><article><span>Probability error</span><strong>{model.brierScore.toFixed(3)}</strong></article></div><p>These test individual match predictions, not accumulator win rate. For probability error, lower is better and zero is perfect.</p></section> : null}
    {personalCodes.length ? <section className="personal-results"><div className="results-title"><div><span>My codes</span><h2>Personal slip results</h2></div><small>{personalCodes.length} recent codes</small></div><div className="personal-code-grid">{personalCodes.map((item) => { const requested = item.selections.requested ?? []; const rows = requested.map((pick) => { const fixture = resultFixture(pick, snapshot.recentResults); return { pick, fixture, result: settlePersonal(pick, fixture) }; }); const status = rows.some((row) => row.result === "LOST") ? "LOST" : rows.some((row) => row.result === "PENDING") ? "PENDING" : rows.some((row) => row.result === "UNVERIFIED") ? "CHECK" : "WON"; return <article key={item.id}><header><div><span>{item.provider}</span><strong>{item.code}</strong></div><b className={status.toLowerCase()}>{status}</b></header><small>{new Date(item.createdAt).toLocaleString()} · {requested.length} picks</small><div>{rows.map(({ pick, fixture, result }) => <p key={`${item.id}-${pick.fixtureId}-${pick.marketKey}`}><span><b>{pick.homeTeam} vs {pick.awayTeam}</b><small>{pick.marketName}: {pick.selection}{finalScore(fixture) ? ` · FT ${finalScore(fixture)}` : ""}</small></span><b>{result === "WON" ? "✓ WON" : result === "LOST" ? "× LOST" : result === "VOID" ? "V VOID" : result === "UNVERIFIED" ? "CHECK" : "PENDING"}</b></p>)}</div></article>; })}</div></section> : null}
    <section className="results-board" id="ticket-results">
      <div className="results-title"><div><span>Published tickets</span><h2>{statusFilter === "SETTLED" ? "Settled ticket history" : `${statusFilter.charAt(0)}${statusFilter.slice(1).toLowerCase()} tickets`}</h2></div><small>{loading ? "Loading results…" : `${tickets.length} tracked ${tickets.length === 1 ? "ticket" : "tickets"}`}</small></div>
      <div className="results-grid">{displayedTickets.map((ticket) => {
        const status = ticket.status === "PUBLISHED" ? "PENDING" : ticket.status;
        const returnValue = status === "LOST" ? 0 : status === "VOID" ? stake : stake * ticket.totalOdds;
        return <article className={`results-ticket results-${status.toLowerCase()}`} key={ticket.id}>
          <header><div><span>{new Date(ticket.publishedAt ?? snapshot.generatedAt ?? "1970-01-01T00:00:00Z").toLocaleDateString()}</span><h3>{ticket.title}</h3></div><b>{status.replaceAll("_", " ")}</b></header>
          <div className="results-numbers"><span>{ticket.selections.length} legs</span><strong>{ticket.totalOdds.toFixed(2)}</strong><span>{status === "WON" || status === "LOST" || status === "VOID" ? "Return" : "Potential return"} <b>{money.format(returnValue)}</b></span></div>
          <div className="results-legs">{ticket.selections.map((selection) => { const fixture = resultFixture({ fixtureId: selection.fixtureId, homeTeam: selection.homeTeam.name, awayTeam: selection.awayTeam.name, kickoff: selection.kickoff, marketKey: selection.market.key, marketName: selection.market.name, selection: selection.selection, line: selection.market.line }, snapshot.recentResults); return <div key={selection.id} className={`leg-${String(selection.result ?? "PENDING").toLowerCase()}`}><span>{selection.homeTeam.name} vs {selection.awayTeam.name}</span><small>{selection.market.name}: {selection.selection}{finalScore(fixture) ? ` · FT ${finalScore(fixture)}` : ""}</small><b>{selection.result === "WON" ? "✓ WON" : selection.result === "LOST" ? "× LOST" : selection.result === "VOID" ? "V VOID" : selection.result === "UNVERIFIED" ? "CHECK" : "PENDING"}</b></div>; })}</div>
          {ticket.strategyVersion === "reverse-market-v1" ? <small className="results-note">Reverse-market strategy · bookmaker probability first · paper tracked</small> : ticket.priceStatus === "MODEL_ESTIMATE" ? <small className="results-note">This archived ticket used reference model prices, so it is excluded from current-strategy ROI.</small> : <small className="results-note">Legacy OddsAura strategy · retained in the archive but excluded from current-strategy performance.</small>}
        </article>;
      })}</div>
      {displayedTickets.length < tickets.length ? <button className="results-load-more" type="button" onClick={() => setVisibleTickets((count) => count + 20)}>Show 20 more tickets</button> : null}
      {!loading && !tickets.length ? <div className="results-empty">No {statusFilter.toLowerCase()} tickets in this period. Choose All or check the Archive for older results.</div> : null}
    </section>
    <footer><span>OddsAura</span><p>18+ · Tracker calculations are informational. Bookmaker settlement is final.</p></footer>
  </main>;
}
