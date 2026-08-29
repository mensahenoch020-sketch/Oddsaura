"use client";

import { useEffect, useMemo, useState } from "react";
import ProductNavigation from "../product-navigation";
import { fallbackSnapshot, loadSnapshot, type PredictedPick, type Snapshot, type Ticket } from "../data";
import { generateSportyBetCode } from "../builder/providers";
import "./daily.css";

type CodeState = { code: string; deepLink: string; matched: number; total: number; liveTotalOdds: number };
type TicketControl = { ticketId: string; visible: boolean; titleOverride: string | null };

const ticketOrder: Record<string, number> = { SAFE_2: 1, VALUE_5: 2, BALANCED_10: 3, HIGH_RISK: 4, LONGSHOT_21: 5 };

function serialize(ids: string[]) {
  return btoa(JSON.stringify(ids.map((predictionId) => ({ predictionId })))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function ticketPredictionIds(ticket: Ticket, picks: PredictedPick[]) {
  return ticket.selections.flatMap((selection) => {
    const match = picks.find((pick) => pick.id === selection.id) ?? picks.find((pick) => pick.fixtureId === selection.fixtureId && pick.market.key === selection.market.key && pick.selection === selection.selection);
    return match ? [match.id] : [];
  });
}

export default function DailyOddsPage() {
  const [snapshot, setSnapshot] = useState<Snapshot>(fallbackSnapshot);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [codes, setCodes] = useState<Record<string, CodeState>>({});
  const [notice, setNotice] = useState("");
  const [controls, setControls] = useState<TicketControl[]>([]);

  useEffect(() => {
    Promise.all([
      loadSnapshot("daily").then(setSnapshot).catch(() => setNotice("Daily odds are refreshing. Try again shortly.")),
      fetch("/api/ticket-controls", { cache: "no-store" }).then((response) => response.ok ? response.json() : { controls: [] }).then((data) => setControls(data.controls ?? [])).catch(() => undefined),
    ]).finally(() => setLoading(false));
  }, []);
  const tickets = useMemo(() => {
    const byId = new Map(controls.map((control) => [control.ticketId, control]));
    return snapshot.tickets.filter((ticket) => byId.get(ticket.id)?.visible !== false).map((ticket) => ({ ...ticket, title: byId.get(ticket.id)?.titleOverride || ticket.title })).sort((a, b) => (ticketOrder[a.category] ?? 99) - (ticketOrder[b.category] ?? 99));
  }, [snapshot.tickets, controls]);

  function addTicket(ticket: Ticket) {
    const ids = ticketPredictionIds(ticket, snapshot.predictedPicks ?? []);
    if (!ids.length) { setNotice("This ticket is being refreshed."); return; }
    const encoded = serialize(ids);
    window.localStorage.setItem("oddsaura-predicted-slip", encoded);
    window.location.assign(`/builder?slip=${encodeURIComponent(encoded)}#my-slip`);
  }

  async function createCode(ticket: Ticket) {
    setCreating(ticket.id); setNotice("");
    try {
      const result = await generateSportyBetCode(ticket.selections.map((selection) => ({
        fixtureId: selection.fixtureId,
        homeTeam: selection.homeTeam.name,
        awayTeam: selection.awayTeam.name,
        kickoff: selection.kickoff,
        marketKey: selection.market.key,
        marketName: selection.market.name,
        selection: selection.selection,
        line: selection.market.line,
        providerEventId: selection.fixtureId.startsWith("sr:match:") ? selection.fixtureId : null,
      })));
      const liveTotalOdds = result.resolved.reduce((value, selection) => value * (selection.odds ?? 1), 1);
      setCodes((current) => ({ ...current, [ticket.id]: { code: result.code, deepLink: result.deepLink, matched: result.resolved.length, total: ticket.selections.length, liveTotalOdds } }));
      setNotice(result.partial ? `${result.resolved.length}/${ticket.selections.length} selections included.` : "SportyBet code verified.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Code generation failed."); }
    finally { setCreating(null); }
  }

  async function copy(code: string) {
    await navigator.clipboard.writeText(code); setNotice("Code copied ✓");
  }

  return <main className="daily-app">
    <ProductNavigation active="daily" />
    <section className="daily-head"><div><span>Today</span><h1>Daily Odds</h1></div><a href="/builder">Build your own</a></section>
    {notice ? <p className="daily-notice" role="status">{notice}</p> : null}
    <section className="daily-grid">
      {tickets.map((ticket) => { const shown = open === ticket.id; const code = codes[ticket.id]; return <article key={ticket.id} className="daily-ticket">
        <header><div><span>{ticket.category === "LONGSHOT_21" ? "Longshot" : ticket.title.replace("Daily ", "")}</span><h2>{code ? code.liveTotalOdds.toFixed(2) : ticket.totalOdds.toFixed(2)} <span>{code ? "SportyBet live" : "target odds"}</span></h2></div><b className={`daily-status ${ticket.status.toLowerCase()}`}>{ticket.status === "PUBLISHED" ? "Open" : ticket.status}</b></header>
        <div className="daily-meta"><span>{ticket.selections.length} picks</span><span>{Math.round(ticket.confidence * 100)}% confidence</span><span>{code ? `${code.matched}/${code.total} live prices` : "Prices are estimates until code check"}</span></div>
        <button className="daily-view" type="button" onClick={() => setOpen(shown ? null : ticket.id)}>{shown ? "Hide picks" : "View picks"}<span>{shown ? "−" : "+"}</span></button>
        {shown ? <div className="daily-legs">{ticket.selections.map((selection) => <div key={selection.id}><span>{selection.homeTeam.name} vs {selection.awayTeam.name}</span><b>{selection.selection}</b><strong>est. {selection.odds.toFixed(2)}</strong></div>)}</div> : null}
        {code ? <div className="daily-code"><span>SportyBet</span><strong>{code.code}</strong><small>{code.matched}/{code.total} included</small><div><button type="button" onClick={() => void copy(code.code)}>Copy</button><a href={code.deepLink} target="_blank" rel="noreferrer">Open</a></div></div> : null}
        <footer><button type="button" onClick={() => addTicket(ticket)}>Add ticket</button><button className="primary" type="button" disabled={creating === ticket.id} onClick={() => void createCode(ticket)}>{creating === ticket.id ? "Checking…" : "Get code"}</button></footer>
      </article>; })}
      {!loading && !tickets.length ? <div className="daily-empty">Today’s tickets are being prepared.</div> : null}
    </section>
  </main>;
}
