"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fallbackSnapshot, loadSnapshot, type Snapshot } from "../data";
import "./admin.css";
import "./admin-accessible.css";
import MarketReport, { type ExpandedPerformance } from "./market-report";

type ModelPerformance = ExpandedPerformance & { generatedAt: string | null; matches: number; oneXTwoAccuracy: number | null; over25Accuracy: number | null; brierScore: number | null; logLoss: number | null; methodology: string; leagues: Array<{ id: string; name: string; matches: number; accuracy: number }> };
type AdminOverview = {
  stats: { users: number; savedSlips: number; generatedCodes: number };
  users: Array<{ email: string; name: string; role: "USER" | "ADMIN"; createdAt: number }>;
  controls: Array<{ ticketId: string; visible: boolean; titleOverride: string | null; updatedAt: number }>;
  services: { passwordResetEmail: boolean };
};
const emptyPerformance: ModelPerformance = { generatedAt: null, matches: 0, oneXTwoAccuracy: null, over25Accuracy: null, brierScore: null, logLoss: null, methodology: "Walk-forward backtest pending historical refresh.", leagues: [] };
const modelPerformanceUrl = process.env.NEXT_PUBLIC_MODEL_PERFORMANCE_URL ?? "https://raw.githubusercontent.com/mensahenoch020-sketch/Oddsaura/main/data/public/model-performance.json";

export default function AdminPage() {
  const [snapshot, setSnapshot] = useState<Snapshot>(fallbackSnapshot);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [performance, setPerformance] = useState<ModelPerformance>(emptyPerformance);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [draftTitles, setDraftTitles] = useState<Record<string, string>>({});

  async function refresh() {
    setBusy(true); setMessage("");
    try {
      const [nextSnapshot, adminResponse] = await Promise.all([loadSnapshot("admin"), fetch("/api/admin/overview", { cache: "no-store" })]);
      setSnapshot(nextSnapshot);
      if (adminResponse.ok) setOverview(await adminResponse.json());
    }
    catch { setMessage("The live GitHub snapshot could not be reached. The last bundled snapshot is still shown."); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    let active = true;
    loadSnapshot("admin").then((data) => { if (active) setSnapshot(data); }).catch(() => { if (active) setMessage("The live GitHub snapshot could not be reached. The last bundled snapshot is still shown."); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    for (const url of ["/data/model-performance.json", modelPerformanceUrl]) {
      fetch(`${url}?v=${Math.floor(Date.now() / 300_000)}`, { cache: "no-store" })
        .then((response) => response.ok ? response.json() : Promise.reject())
        .then((report: ModelPerformance) => {
          if (active && typeof report.matches === "number") setPerformance((current) =>
            !current.generatedAt || Date.parse(report.generatedAt ?? "") >= Date.parse(current.generatedAt) ? report : current);
        }).catch(() => undefined);
    }
    return () => { active = false; };
  }, []);
  useEffect(() => { fetch("/api/admin/overview", { cache: "no-store" }).then((response) => response.ok ? response.json() : Promise.reject()).then(setOverview).catch(() => setMessage("Admin account data could not be loaded.")); }, []);

  async function saveTicket(ticketId: string, visible: boolean) {
    const response = await fetch(`/api/admin/tickets/${encodeURIComponent(ticketId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ visible, titleOverride: draftTitles[ticketId] ?? overview?.controls.find((item) => item.ticketId === ticketId)?.titleOverride ?? "" }) });
    if (!response.ok) { setMessage("Ticket control could not be saved."); return; }
    setMessage(visible ? "Ticket published." : "Ticket hidden from Daily Odds.");
    await refresh();
  }

  async function setRole(email: string, role: "USER" | "ADMIN") {
    const response = await fetch(`/api/admin/users/${encodeURIComponent(email)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(result.error || "User role could not be updated."); return; }
    setMessage(`${email} is now ${role.toLowerCase()}.`);
    await refresh();
  }

  return <main className="adm-app">
    <aside className="adm-sidebar"><Link href="/dashboard" className="adm-brand">Odds<span>Aura</span></Link><nav><a href="#overview">Pipeline</a><a href="#operations">Operations</a><a href="#tickets">Daily tickets</a><a href="#users">Users</a><a href="#markets">Markets</a></nav><a className="adm-repo" href="https://github.com/mensahenoch020-sketch/Oddsaura/actions" target="_blank" rel="noreferrer">Automation runs ↗</a></aside>
    <section className="adm-content">
      <nav className="adm-mobile-menu" aria-label="Admin sections"><Link href="/dashboard">Home</Link><a href="#overview">Overview</a><a href="#tickets">Tickets</a><a href="#users">Users</a><a href="#markets">Markets and tests</a><a href="https://github.com/mensahenoch020-sketch/Oddsaura/actions" target="_blank" rel="noreferrer">Automation runs ↗</a></nav>
      <header><div><span className="adm-kicker">Zero-key operations</span><h1>Automation monitor</h1></div><div className="adm-actions"><button className="adm-primary" disabled={busy} onClick={refresh}>{busy ? "Checking…" : "Refresh snapshot"}</button></div></header>
      {message && <div className="adm-message">{message}</div>}
      <section id="overview" className="adm-pipeline-status"><div><span className={`adm-dot adm-dot-${snapshot.status}`} /> <strong>{snapshot.status.toUpperCase()}</strong><p>{snapshot.message}</p></div><small>{snapshot.generatedAt ? `Last run ${new Date(snapshot.generatedAt).toLocaleString()}` : "First scheduled run pending"}</small></section>
      <section className="adm-metrics">{Object.entries(snapshot.metrics).map(([label, value]) => <article key={label}><span>{label.replace(/([A-Z])/g, " $1")}</span><strong>{value}</strong></article>)}</section>
      <section id="operations" className="adm-operations"><div className="adm-section-head"><h2>Site operations</h2><span>Private admin data</span></div><div><article><span>Users</span><strong>{overview?.stats.users ?? "—"}</strong></article><article><span>Saved slips</span><strong>{overview?.stats.savedSlips ?? "—"}</strong></article><article><span>Generated codes</span><strong>{overview?.stats.generatedCodes ?? "—"}</strong></article><article><span>Password email</span><strong className={overview?.services.passwordResetEmail ? "ready" : "needs-setup"}>{overview?.services.passwordResetEmail ? "Ready" : "Needs setup"}</strong></article></div></section>
      <section className="adm-performance"><div className="adm-section-head"><h2>Historical prediction tests</h2><span>{performance.matches ? `${performance.matches} walk-forward matches` : "Backtest pending"}</span></div><p>{performance.methodology}</p><div><article><span>1X2 accuracy</span><strong>{performance.oneXTwoAccuracy == null ? "—" : `${Math.round(performance.oneXTwoAccuracy * 100)}%`}</strong></article><article><span>Over 2.5 accuracy</span><strong>{performance.over25Accuracy == null ? "—" : `${Math.round(performance.over25Accuracy * 100)}%`}</strong></article><article><span>Brier score</span><strong>{performance.brierScore == null ? "—" : performance.brierScore.toFixed(3)}</strong></article><article><span>Log loss</span><strong>{performance.logLoss == null ? "—" : performance.logLoss.toFixed(3)}</strong></article></div></section>
      <section className="adm-performance"><div className="adm-section-head"><h2>Forward prediction proof</h2><span>Recorded before kickoff</span></div><p>This paper ledger records priced selections before matches start, then settles them from final scores. It is proof of future performance—not a guarantee of profit.</p><div><article><span>Recorded</span><strong>{snapshot.metrics.paperTrials?.recorded ?? 0}</strong></article><article><span>Settled</span><strong>{snapshot.metrics.paperTrials?.settled ?? 0}</strong></article><article><span>Won</span><strong>{snapshot.metrics.paperTrials?.won ?? 0}</strong></article><article><span>Hit rate</span><strong>{snapshot.metrics.paperTrials?.hitRate == null ? "—" : `${Math.round(snapshot.metrics.paperTrials.hitRate * 100)}%`}</strong></article><article><span>Flat-stake ROI</span><strong>{snapshot.metrics.paperTrials?.flatStakeRoi == null ? "—" : `${(snapshot.metrics.paperTrials.flatStakeRoi * 100).toFixed(1)}%`}</strong></article></div></section>
      <section className="adm-sources"><div className="adm-section-head"><h2>Sources</h2></div>{snapshot.sources.map((source) => <article key={source.id}><div><strong>{source.label}</strong><span>{source.status}</span></div><p>{source.records} records · {source.lastSuccessAt ? new Date(source.lastSuccessAt).toLocaleString() : "Waiting"}</p>{source.warnings?.length ? <small>{source.warnings.slice(0, 2).join(" · ")}</small> : null}</article>)}</section>
      <section id="tickets"><div className="adm-section-head"><h2>Daily ticket controls</h2><span>{snapshot.tickets.length} generated</span></div><div className="adm-ticket-list">{snapshot.tickets.map((ticket) => { const control = overview?.controls.find((item) => item.ticketId === ticket.id); const visible = control?.visible !== false; return <article className="adm-ticket" key={ticket.id}><div className="adm-ticket-top"><div><span>{ticket.category.replace("_", " ")} · {visible ? "VISIBLE" : "HIDDEN"}</span><h3>{control?.titleOverride || ticket.title}</h3></div><strong>{ticket.totalOdds.toFixed(2)}</strong></div><div className="adm-ticket-control"><input value={draftTitles[ticket.id] ?? control?.titleOverride ?? ""} onChange={(event) => setDraftTitles((current) => ({ ...current, [ticket.id]: event.target.value }))} placeholder={ticket.title} aria-label={`Display title for ${ticket.title}`} /><button type="button" onClick={() => void saveTicket(ticket.id, visible)}>{control?.titleOverride ? "Update title" : "Save title"}</button><button className={visible ? "danger" : "publish"} type="button" onClick={() => void saveTicket(ticket.id, !visible)}>{visible ? "Hide" : "Publish"}</button></div><div className="adm-ticket-selections">{ticket.selections.map((item) => <p key={item.id}><span>{item.homeTeam.name} vs {item.awayTeam.name}</span><strong>{item.market.name}: {item.selection}</strong></p>)}</div><div className="adm-ticket-bottom"><span>Confidence {Math.round(ticket.confidence * 100)}%</span><span>{ticket.bookingCodes.length ? ticket.bookingCodes.map((code) => `${code.provider}: ${code.code}`).join(" · ") : "Code generation available in the slip"}</span></div></article>; })}{!snapshot.tickets.length && <div className="adm-empty">No generated daily tickets.</div>}</div></section>
      <section id="users" className="adm-users"><div className="adm-section-head"><h2>User access</h2><span>{overview?.users.length ?? 0} recent</span></div>{overview?.users.map((user) => <article key={user.email}><div><strong>{user.name}</strong><span>{user.email}</span></div><button type="button" onClick={() => void setRole(user.email, user.role === "ADMIN" ? "USER" : "ADMIN")}>{user.role === "ADMIN" ? "Remove admin" : "Make admin"}</button></article>)}</section>
      <MarketReport performance={performance} />
    </section>
  </main>;
}
