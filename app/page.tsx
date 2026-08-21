"use client";

import { useEffect, useMemo, useState } from "react";
import { fallbackSnapshot, loadSnapshot, type Snapshot } from "./data";
import "./product.css";

const statusLabel = (status: string) => status === "healthy" ? "Data feed healthy" : status === "partial" ? "Partial source coverage" : status === "waiting" ? "Collector ready" : "Showing last snapshot";

export default function Home() {
  const [snapshot, setSnapshot] = useState<Snapshot>(fallbackSnapshot);
  const [refreshing, setRefreshing] = useState(true);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    loadSnapshot().then(setSnapshot).catch(() => undefined).finally(() => setRefreshing(false));
  }, []);

  const updated = useMemo(() => snapshot.generatedAt ? new Date(snapshot.generatedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "First run pending", [snapshot.generatedAt]);

  async function copyCode(code: string) {
    await navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(""), 1800);
  }

  return <main className="oa-app">
    <header className="oa-header">
      <a className="oa-brand" href="/" aria-label="OddsAura home"><span className="oa-mark">↗</span><span>Odds<i>Aura</i></span></a>
      <div className={`oa-status oa-status-${snapshot.status}`}><span /> {refreshing ? "Checking GitHub data…" : statusLabel(snapshot.status)}</div>
      <a className="oa-admin-link" href="/admin">System</a>
    </header>

    <section className="oa-intro">
      <div><span className="oa-kicker">Zero-key probability board</span><h1>Football picks,<br /><i>scored automatically.</i></h1></div>
      <div className="oa-intro-copy"><p>Public football JSON, recent form and available market prices are collected on schedule. No paid API key is required.</p><small>Last data run: {updated}</small></div>
    </section>

    <section className="oa-data-strip" aria-label="Data pipeline summary">
      <article><span>Upcoming</span><strong>{snapshot.metrics.fixtures}</strong></article>
      <article><span>Live now</span><strong>{snapshot.metrics.live}</strong></article>
      <article><span>Markets priced</span><strong>{snapshot.metrics.pricedMarkets}</strong></article>
      <article><span>Model scores</span><strong>{snapshot.metrics.predictions}</strong></article>
    </section>

    <nav className="oa-filters" aria-label="Ticket categories"><a href="#safe">Safe 2–3 Odds</a><a href="#balanced">Balanced 5–10 Odds</a><a href="#high-risk">High Risk</a><a href="#markets">All markets</a></nav>

    {(snapshot.watchlist?.length ?? 0) > 0 && <section className="oa-watchlist" aria-label="Model watchlist">
      <div className="oa-section-title"><div><span className="oa-kicker">Model watchlist</span><h2>Strong signals awaiting verified prices.</h2></div><p>Fair odds are calculated by OddsAura’s model. They are not bookmaker odds and cannot create a betting ticket until a public price is matched.</p></div>
      <div className="oa-watch-grid">{snapshot.watchlist?.map((item) => <article key={item.id}><span>{item.league.name} · {new Date(item.kickoff).toLocaleString()}</span><h3>{item.homeTeam.name} vs {item.awayTeam.name}</h3><p>{item.market.name}: <strong>{item.selection}</strong></p><div><span>Confidence <b>{Math.round(item.confidence * 100)}%</b></span><span>{item.quotedOdds ? `Quoted ${item.quotedOdds.toFixed(2)}` : `Model fair ${item.fairOdds.toFixed(2)}`}</span></div></article>)}</div>
    </section>}

    {!snapshot.tickets.length && <div className="oa-empty"><strong>{snapshot.status === "waiting" ? "The automated collector is ready." : "No ticket passed every rule yet."}</strong><span>{snapshot.message}</span><small>OddsAura will publish automatically when current prices and enough recent form are available.</small></div>}

    <section className="oa-ticket-grid">
      {snapshot.tickets.map((ticket) => <article id={ticket.category.toLowerCase().replace("_", "-")} className="oa-ticket" key={ticket.id}>
        <div className="oa-ticket-head"><div><span>{ticket.category.replace("_", " ")} · AUTO-PUBLISHED</span><h2>{ticket.title}</h2></div><strong>{ticket.totalOdds.toFixed(2)}<small>Total odds</small></strong></div>
        <div className="oa-selections">{ticket.selections.map((item) => <div className="oa-selection" key={item.id}><div><span>{item.league.name} · {new Date(item.kickoff).toLocaleString()}</span><h3>{item.homeTeam.name} vs {item.awayTeam.name}</h3><p>{item.market.name}: {item.selection}</p></div><div className="oa-numbers"><strong>{item.odds.toFixed(2)}</strong><span>{Math.round(item.confidence * 100)}%</span></div></div>)}</div>
        <div className="oa-ticket-foot"><div><span>Average confidence</span><strong>{Math.round(ticket.confidence * 100)}%</strong></div>{ticket.bookingCodes.length ? <div className="oa-codes">{ticket.bookingCodes.map((booking) => <button type="button" key={`${ticket.id}-${booking.provider}`} onClick={() => copyCode(booking.code)}><span>{booking.provider}</span><strong>{copied === booking.code ? "Copied" : booking.code}</strong></button>)}</div> : <span className="oa-awaiting">Selections published · bookmaker code automation is the next integration</span>}</div>
      </article>)}
    </section>

    <section className="oa-market-section" id="markets">
      <div><span className="oa-kicker">Flexible market engine</span><h2>Built beyond basic match picks.</h2><p>The snapshot format accepts new bookmaker markets without another database migration. Markets without enough supporting statistics stay visible to the collector but are not blindly recommended.</p></div>
      <div className="oa-market-cloud">{snapshot.marketCatalog.map((market) => <span key={market}>{market}</span>)}</div>
    </section>

    <footer className="oa-footer"><span>OddsAura</span><p>18+ · Predictions are information, not guarantees. Please bet responsibly.</p></footer>
  </main>;
}
