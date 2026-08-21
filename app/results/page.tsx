"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Brand from "../brand";
import { fallbackSnapshot, loadSnapshot, type Snapshot } from "../data";
import "./results.css";

const money = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

export default function ResultsPage() {
  const [snapshot, setSnapshot] = useState<Snapshot>(fallbackSnapshot);
  const [stake, setStake] = useState(1000);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadSnapshot().then(setSnapshot).catch(() => undefined).finally(() => setLoading(false)); }, []);
  const tickets = useMemo(() => snapshot.ticketHistory ?? snapshot.tickets, [snapshot.ticketHistory, snapshot.tickets]);
  const summary = useMemo(() => ({
    won: tickets.filter((ticket) => ticket.status === "WON").length,
    lost: tickets.filter((ticket) => ticket.status === "LOST").length,
    pending: tickets.filter((ticket) => ticket.status === "PENDING" || ticket.status === "PUBLISHED").length,
  }), [tickets]);

  return <main className="results-app">
    <header className="results-header"><Brand href="/dashboard" className="results-brand" /><nav><Link href="/builder">Build a slip</Link><Link href="/matches">Matches</Link><Link href="/account">Account</Link></nav></header>
    <section className="results-hero"><div><span>Ticket tracker</span><h1>Results without<br /><i>the guesswork.</i></h1></div><p>OddsAura settles supported markets from final scores. Always confirm early-payout markets, voids and official settlement inside your bookmaker account.</p></section>
    <section className="results-summary"><article><span>Won</span><strong>{summary.won}</strong></article><article><span>Lost</span><strong>{summary.lost}</strong></article><article><span>Pending</span><strong>{summary.pending}</strong></article><label><span>Stake calculator</span><div>₦<input type="number" min="0" step="100" value={stake} onChange={(event) => setStake(Math.max(0, Number(event.target.value) || 0))} /></div></label></section>
    <section className="results-board">
      <div className="results-title"><div><span>Published tickets</span><h2>Daily ticket history</h2></div><small>{loading ? "Loading results…" : `${tickets.length} tracked ${tickets.length === 1 ? "ticket" : "tickets"}`}</small></div>
      <div className="results-grid">{tickets.map((ticket) => {
        const status = ticket.status === "PUBLISHED" ? "PENDING" : ticket.status;
        const returnValue = status === "LOST" ? 0 : stake * ticket.totalOdds;
        return <article className={`results-ticket results-${status.toLowerCase()}`} key={ticket.id}>
          <header><div><span>{new Date(ticket.publishedAt ?? snapshot.generatedAt ?? "1970-01-01T00:00:00Z").toLocaleDateString()}</span><h3>{ticket.title}</h3></div><b>{status.replaceAll("_", " ")}</b></header>
          <div className="results-numbers"><span>{ticket.selections.length} legs</span><strong>{ticket.totalOdds.toFixed(2)}</strong><span>{status === "WON" ? "Return" : status === "LOST" ? "Return" : "Potential return"} <b>{money.format(returnValue)}</b></span></div>
          <div className="results-legs">{ticket.selections.map((selection) => <div key={selection.id}><span>{selection.homeTeam.name} vs {selection.awayTeam.name}</span><small>{selection.market.name}: {selection.selection}</small><b>{selection.result === "WON" ? "✓" : selection.result === "LOST" ? "×" : selection.result === "VOID" ? "V" : "–"}</b></div>)}</div>
          {ticket.priceStatus === "MODEL_ESTIMATE" ? <small className="results-note">Total odds were estimated before the live SportyBet code was created.</small> : null}
        </article>;
      })}</div>
      {!loading && !tickets.length ? <div className="results-empty">No published ticket history yet. The tracker will update after the next prediction run.</div> : null}
    </section>
    <footer><span>OddsAura</span><p>18+ · Tracker calculations are informational. Bookmaker settlement is final.</p></footer>
  </main>;
}
