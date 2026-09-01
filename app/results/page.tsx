"use client";

import { useEffect, useMemo, useState } from "react";
import ProductNavigation from "../product-navigation";
import { fallbackSnapshot, loadSnapshot, type Fixture, type Snapshot } from "../data";
import "./results.css";
import "./results-shell.css";
import "./results-personal.css";

const money = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });
type Period = "TODAY" | "7D" | "30D" | "ALL";
type RequestedPick = { fixtureId: string; homeTeam: string; awayTeam: string; kickoff?: string; marketKey: string; marketName: string; selection: string; line?: number | null };
type PersonalCode = { id: string; provider: string; code: string; createdAt: number; selections: { requested?: RequestedPick[] } };
type ModelPerformance = { matches: number; oneXTwoAccuracy: number; over25Accuracy: number; brierScore: number; generatedAt: string };

function startOfDay(timestamp: number) {
  const value = new Date(timestamp);
  value.setHours(0, 0, 0, 0);
  return value.getTime();
}

const normalTeam = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(fc|cf|sc|afc|club|football|de|the)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

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

function settlePersonal(selection: RequestedPick, fixture?: Fixture) {
  if (!fixture || fixture.status !== "FINISHED" || fixture.homeScore == null || fixture.awayScore == null) return "PENDING";
  const home = Number(fixture.homeScore); const away = Number(fixture.awayScore); const total = home + away; const line = marketLine(selection); const key = selection.marketKey;
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
  if (key.startsWith("HOME_OVER_")) return home > line ? "WON" : "LOST";
  if (key.startsWith("HOME_UNDER_")) return home < line ? "WON" : "LOST";
  if (key.startsWith("AWAY_OVER_")) return away > line ? "WON" : "LOST";
  if (key.startsWith("AWAY_UNDER_")) return away < line ? "WON" : "LOST";
  if (key.startsWith("OVER_")) return total > line ? "WON" : "LOST";
  if (key.startsWith("UNDER_")) return total < line ? "WON" : "LOST";
  return "CHECK";
}

export default function ResultsPage() {
  const [snapshot, setSnapshot] = useState<Snapshot>(fallbackSnapshot);
  const [stake, setStake] = useState(1000);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("7D");
  const [referenceTime] = useState(() => Date.now());
  const [personalCodes, setPersonalCodes] = useState<PersonalCode[]>([]);
  const [model, setModel] = useState<ModelPerformance | null>(null);

  useEffect(() => {
    loadSnapshot("results").then(setSnapshot).catch(() => undefined).finally(() => setLoading(false));
    fetch("/api/codes").then((response) => response.ok ? response.json() : { codes: [] }).then((payload) => setPersonalCodes(payload.codes ?? [])).catch(() => undefined);
    fetch("https://raw.githubusercontent.com/mensahenoch020-sketch/Oddsaura/main/data/public/model-performance.json", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then(setModel).catch(() => undefined);
  }, []);
  const history = useMemo(() => snapshot.ticketHistory ?? snapshot.tickets, [snapshot.ticketHistory, snapshot.tickets]);
  const tickets = useMemo(() => {
    if (period === "ALL") return history;
    const cutoff = period === "TODAY" ? startOfDay(referenceTime) : referenceTime - (period === "7D" ? 7 : 30) * 86_400_000;
    return history.filter((ticket) => new Date(ticket.publishedAt ?? snapshot.generatedAt ?? 0).getTime() >= cutoff);
  }, [history, period, referenceTime, snapshot.generatedAt]);
  const summary = useMemo(() => ({
    won: tickets.filter((ticket) => ticket.status === "WON").length,
    lost: tickets.filter((ticket) => ticket.status === "LOST").length,
    pending: tickets.filter((ticket) => ticket.status === "PENDING" || ticket.status === "PUBLISHED").length,
  }), [tickets]);
  const performance = useMemo(() => {
    const settled = tickets.filter((ticket) => ticket.status === "WON" || ticket.status === "LOST");
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
  }, [tickets, stake]);

  return <main className="results-app">
    <ProductNavigation active="results" />
    <section className="results-hero"><div><span>Ticket tracker</span><h1>Results without<br /><i>the guesswork.</i></h1></div><p>OddsAura settles supported markets from final scores. Always confirm early-payout markets, voids and official settlement inside your bookmaker account.</p></section>
    <nav className="results-periods" aria-label="Results period">{([['TODAY', 'Today'], ['7D', '7 days'], ['30D', '30 days'], ['ALL', 'Archive']] as const).map(([value, label]) => <button type="button" key={value} className={period === value ? "active" : ""} onClick={() => setPeriod(value)}>{label}</button>)}</nav>
    <section className="results-summary"><article><span>Won</span><strong>{summary.won}</strong></article><article><span>Lost</span><strong>{summary.lost}</strong></article><article><span>Pending</span><strong>{summary.pending}</strong></article><label><span>Stake calculator</span><div>₦<input type="number" min="0" step="100" value={stake} onChange={(event) => setStake(Math.max(0, Number(event.target.value) || 0))} /></div></label></section>
    <section className="results-performance" aria-label="Performance summary"><article><span>Settled</span><strong>{performance.settled}</strong></article><article><span>Hit rate</span><strong>{performance.settled ? `${performance.hitRate.toFixed(1)}%` : "—"}</strong></article><article><span>Verified ticket ROI</span><strong className={performance.roi != null && performance.roi < 0 ? "negative" : ""}>{performance.roi == null ? "—" : `${performance.roi >= 0 ? "+" : ""}${performance.roi.toFixed(1)}%`}</strong></article></section>
    {model ? <section className="model-scorecard" aria-label="Model scorecard"><header><span>Walk-forward scorecard</span><b>{model.matches} historical matches</b></header><div><article><span>1X2</span><strong>{(model.oneXTwoAccuracy * 100).toFixed(1)}%</strong></article><article><span>Over 2.5</span><strong>{(model.over25Accuracy * 100).toFixed(1)}%</strong></article><article><span>Brier score</span><strong>{model.brierScore.toFixed(3)}</strong></article></div></section> : null}
    {personalCodes.length ? <section className="personal-results"><div className="results-title"><div><span>My codes</span><h2>Personal slip results</h2></div><small>{personalCodes.length} recent codes</small></div><div className="personal-code-grid">{personalCodes.map((item) => { const requested = item.selections.requested ?? []; const rows = requested.map((pick) => ({ pick, result: settlePersonal(pick, resultFixture(pick, snapshot.recentResults)) })); const status = rows.some((row) => row.result === "LOST") ? "LOST" : rows.some((row) => row.result === "PENDING") ? "PENDING" : rows.some((row) => row.result === "CHECK") ? "CHECK" : "WON"; return <article key={item.id}><header><div><span>{item.provider}</span><strong>{item.code}</strong></div><b className={status.toLowerCase()}>{status}</b></header><small>{new Date(item.createdAt).toLocaleString()} · {requested.length} picks</small><div>{rows.map(({ pick, result }) => <p key={`${item.id}-${pick.fixtureId}-${pick.marketKey}`}><span><b>{pick.homeTeam} vs {pick.awayTeam}</b><small>{pick.marketName}: {pick.selection}</small></span><b>{result === "WON" ? "✓" : result === "LOST" ? "×" : result === "VOID" ? "V" : "–"}</b></p>)}</div></article>; })}</div></section> : null}
    <section className="results-board">
      <div className="results-title"><div><span>Published tickets</span><h2>Daily ticket history</h2></div><small>{loading ? "Loading results…" : `${tickets.length} tracked ${tickets.length === 1 ? "ticket" : "tickets"}`}</small></div>
      <div className="results-grid">{tickets.map((ticket) => {
        const status = ticket.status === "PUBLISHED" ? "PENDING" : ticket.status;
        const returnValue = status === "LOST" ? 0 : stake * ticket.totalOdds;
        return <article className={`results-ticket results-${status.toLowerCase()}`} key={ticket.id}>
          <header><div><span>{new Date(ticket.publishedAt ?? snapshot.generatedAt ?? "1970-01-01T00:00:00Z").toLocaleDateString()}</span><h3>{ticket.title}</h3></div><b>{status.replaceAll("_", " ")}</b></header>
          <div className="results-numbers"><span>{ticket.selections.length} legs</span><strong>{ticket.totalOdds.toFixed(2)}</strong><span>{status === "WON" ? "Return" : status === "LOST" ? "Return" : "Potential return"} <b>{money.format(returnValue)}</b></span></div>
          <div className="results-legs">{ticket.selections.map((selection) => <div key={selection.id}><span>{selection.homeTeam.name} vs {selection.awayTeam.name}</span><small>{selection.market.name}: {selection.selection}</small><b>{selection.result === "WON" ? "✓" : selection.result === "LOST" ? "×" : selection.result === "VOID" ? "V" : "–"}</b></div>)}</div>
          {ticket.priceStatus === "MODEL_ESTIMATE" ? <small className="results-note">This archived ticket used reference model prices, so it is excluded from ROI.</small> : null}
        </article>;
      })}</div>
      {!loading && !tickets.length ? <div className="results-empty">No tickets in this period. Check the Archive for older results.</div> : null}
    </section>
    <footer><span>OddsAura</span><p>18+ · Tracker calculations are informational. Bookmaker settlement is final.</p></footer>
  </main>;
}
