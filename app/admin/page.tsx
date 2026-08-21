"use client";

import { useEffect, useState } from "react";
import { fallbackSnapshot, loadSnapshot, type Snapshot } from "../data";
import "./admin.css";

export default function AdminPage() {
  const [snapshot, setSnapshot] = useState<Snapshot>(fallbackSnapshot);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");

  async function refresh() {
    setBusy(true); setMessage("");
    try { setSnapshot(await loadSnapshot()); }
    catch { setMessage("The live GitHub snapshot could not be reached. The last bundled snapshot is still shown."); }
    finally { setBusy(false); }
  }

  useEffect(() => { void refresh(); }, []);

  return <main className="adm-app">
    <aside className="adm-sidebar"><a href="/" className="adm-brand">Odds<span>Aura</span></a><nav><a href="#overview">Pipeline</a><a href="#tickets">Published tickets</a><a href="#markets">Market coverage</a></nav><a className="adm-repo" href="https://github.com/mensahenoch020-sketch/Oddsaura/actions" target="_blank" rel="noreferrer">Automation runs ↗</a></aside>
    <section className="adm-content">
      <header><div><span className="adm-kicker">Zero-key operations</span><h1>Automation monitor</h1></div><div className="adm-actions"><button className="adm-primary" disabled={busy} onClick={refresh}>{busy ? "Checking…" : "Refresh snapshot"}</button></div></header>
      {message && <div className="adm-message">{message}</div>}
      <section id="overview" className="adm-pipeline-status"><div><span className={`adm-dot adm-dot-${snapshot.status}`} /> <strong>{snapshot.status.toUpperCase()}</strong><p>{snapshot.message}</p></div><small>{snapshot.generatedAt ? `Last run ${new Date(snapshot.generatedAt).toLocaleString()}` : "First scheduled run pending"}</small></section>
      <section className="adm-metrics">{Object.entries(snapshot.metrics).map(([label, value]) => <article key={label}><span>{label.replace(/([A-Z])/g, " $1")}</span><strong>{value}</strong></article>)}</section>
      <section className="adm-sources"><div className="adm-section-head"><h2>Sources</h2></div>{snapshot.sources.map((source) => <article key={source.id}><div><strong>{source.label}</strong><span>{source.status}</span></div><p>{source.records} records · {source.lastSuccessAt ? new Date(source.lastSuccessAt).toLocaleString() : "Waiting"}</p>{source.warnings?.length ? <small>{source.warnings.slice(0, 2).join(" · ")}</small> : null}</article>)}</section>
      <section id="tickets"><div className="adm-section-head"><h2>Auto-published tickets</h2><span>{snapshot.tickets.length} live</span></div><div className="adm-ticket-list">{snapshot.tickets.map((ticket) => <article className="adm-ticket" key={ticket.id}><div className="adm-ticket-top"><div><span>{ticket.category.replace("_", " ")} · {ticket.status}</span><h3>{ticket.title}</h3></div><strong>{ticket.totalOdds.toFixed(2)}</strong></div><div className="adm-ticket-selections">{ticket.selections.map((item) => <p key={item.id}><span>{item.homeTeam.name} vs {item.awayTeam.name}</span><strong>{item.market.name}: {item.selection}</strong></p>)}</div><div className="adm-ticket-bottom"><span>Confidence {Math.round(ticket.confidence * 100)}%</span><span>{ticket.bookingCodes.length ? ticket.bookingCodes.map((code) => `${code.provider}: ${code.code}`).join(" · ") : "Booking code pending integration"}</span></div></article>)}{!snapshot.tickets.length && <div className="adm-empty">Nothing has passed the publishing gates yet. This is expected before the first successful priced-data run.</div>}</div></section>
      <section id="markets" className="adm-market-list"><div className="adm-section-head"><h2>Market coverage</h2><span>{snapshot.marketCatalog.length} families detected</span></div><div>{snapshot.marketCatalog.map((market) => <span key={market}>{market}</span>)}</div></section>
    </section>
  </main>;
}
