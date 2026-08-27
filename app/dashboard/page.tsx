"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fallbackSnapshot, loadSnapshot, type Snapshot } from "../data";
import TicketSportyCode from "../ticket-sporty-code";
import ProductNavigation from "../product-navigation";
import "../product.css";
import "../product-nav.css";

export default function DashboardPage() {
  const [snapshot, setSnapshot] = useState<Snapshot>(fallbackSnapshot);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    loadSnapshot().then(setSnapshot).catch(() => undefined);
  }, []);

  const updated = useMemo(() => snapshot.generatedAt ? new Date(snapshot.generatedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "First run pending", [snapshot.generatedAt]);
  const topPicks = useMemo(() => {
    const best = new Map<string, NonNullable<Snapshot["predictedPicks"]>[number]>();
    for (const pick of snapshot.predictedPicks ?? []) {
      const current = best.get(pick.fixtureId);
      if (!current || pick.confidence > current.confidence) best.set(pick.fixtureId, pick);
    }
    return [...best.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 6);
  }, [snapshot.predictedPicks]);

  async function copyCode(code: string) {
    await navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(""), 1800);
  }

  return <main className="oa-app oa-home">
    <ProductNavigation active="home" />

    <section className="oa-home-heading">
      <div><span className="oa-kicker">Football predictions</span><h1>Today&apos;s football</h1><p>Choose a ready ticket or build your own slip from our calculated predictions.</p></div>
      <Link href="/matches">View all matches <span>→</span></Link>
    </section>

    <nav className="oa-period-nav" aria-label="Football period"><Link href="/matches">Live <b>{snapshot.metrics.live}</b></Link><Link className="active" href="/matches">Today</Link><Link href="/matches">Tomorrow</Link><Link href="/matches">Upcoming</Link></nav>

    <section className="oa-compact-status" aria-label="Data summary"><span><b>{snapshot.metrics.fixtures}</b> upcoming matches</span><span><b>{snapshot.metrics.selectablePredictions ?? snapshot.metrics.predictions}</b> selectable predictions</span><small>Updated {updated}</small></section>

    <section className="oa-home-section" id="quick-tickets">
      <div className="oa-home-section-title"><div><span className="oa-kicker">Quick tickets</span><h2>Choose your risk level</h2></div><Link href="/builder">Build my own →</Link></div>
      {!snapshot.tickets.length && <div className="oa-empty"><strong>Quick tickets are being refreshed.</strong><span>{snapshot.message}</span></div>}
      <div className="oa-ticket-grid">
        {snapshot.tickets.map((ticket) => <article id={ticket.category.toLowerCase().replaceAll("_", "-")} className="oa-ticket" key={ticket.id}>
          <div className="oa-ticket-head"><div><span>{ticket.category.replaceAll("_", " ")}</span><h2>{ticket.title}</h2><small>{ticket.selections.length} selections</small></div><strong>{ticket.totalOdds.toFixed(2)}<small>Total odds</small></strong></div>
          <div className="oa-selections">{ticket.selections.map((item) => <div className="oa-selection" key={item.id}><div><span>{item.league.name} · {new Date(item.kickoff).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span><h3>{item.homeTeam.name} vs {item.awayTeam.name}</h3><p>{item.market.name}: <b>{item.selection}</b></p></div><div className="oa-numbers"><strong>{item.odds.toFixed(2)}</strong><span>{Math.round(item.confidence * 100)}%</span></div></div>)}</div>
          <div className="oa-ticket-foot"><div><span>Average confidence</span><strong>{Math.round(ticket.confidence * 100)}%</strong></div>{ticket.priceStatus === "MODEL_ESTIMATE" ? <span className="oa-awaiting">SportyBet confirms the live prices when the code is created.</span> : null}{ticket.bookingCodes.length ? <div className="oa-codes">{ticket.bookingCodes.map((booking) => <button type="button" key={`${ticket.id}-${booking.provider}`} onClick={() => copyCode(booking.code)}><span>{booking.provider}</span><strong>{copied === booking.code ? "Copied" : booking.code}</strong></button>)}</div> : <TicketSportyCode ticket={ticket} />}</div>
        </article>)}
      </div>
    </section>

    <section className="oa-home-section oa-strong-section">
      <div className="oa-home-section-title"><div><span className="oa-kicker">Strongest signals</span><h2>Top calculated predictions</h2></div><Link href="/builder">See all predictions →</Link></div>
      <div className="oa-strong-grid">{topPicks.map((pick) => <article key={pick.id}><header><span>{pick.league.name}</span><time>{new Date(pick.kickoff).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}</time></header><h3>{pick.homeTeam.name}<i> vs </i>{pick.awayTeam.name}</h3><div><span>{pick.market.name}<b>{pick.selection}</b></span><strong>{pick.quotedOdds?.toFixed(2) ?? `Fair ${pick.fairOdds.toFixed(2)}`}</strong></div><footer><span className={`oa-quality oa-quality-${pick.dataQuality?.toLowerCase() ?? "low"}`}>{pick.dataQuality === "LOW" ? "Limited data" : `${Math.round(pick.confidence * 100)}% confidence`}</span><Link href={`/builder?fixture=${encodeURIComponent(pick.fixtureId)}`}>Add to slip +</Link></footer></article>)}</div>
    </section>

    <footer className="oa-footer"><span>OddsAura</span><p>18+ · Predictions are information, not guarantees. Please bet responsibly.</p></footer>
  </main>;
}
