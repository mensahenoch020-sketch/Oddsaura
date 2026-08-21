"use client";

import { FormEvent, useEffect, useState } from "react";
import "./admin.css";

type Overview = { fixtures: number; predictions: number; draftTickets: number; publishedTickets: number; users: number };
type Ticket = { id: string; title: string; category: string; status: string; totalOdds: number; confidence: number; bookingCodes: Array<{ provider: string; code: string }>; selections: Array<{ id: string; prediction: { selection: string; fixture: { homeTeam: { name: string }; awayTeam: { name: string } } } }> };
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setToken(localStorage.getItem("oddsaura_admin_token") ?? ""); }, []);
  useEffect(() => { if (token) void refresh(token); }, [token]);

  async function request(path: string, options: RequestInit = {}, authToken = token) {
    const response = await fetch(`${apiUrl}${path}`, { ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}`, ...(options.headers ?? {}) } });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Request failed");
    return response.status === 204 ? null : response.json();
  }

  async function refresh(authToken = token) {
    try {
      const [overviewData, ticketData] = await Promise.all([request("/api/admin/overview", {}, authToken), request("/api/admin/tickets", {}, authToken)]);
      setOverview(overviewData); setTickets(ticketData.tickets); setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load admin dashboard"); }
  }

  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch(`${apiUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Login failed");
      localStorage.setItem("oddsaura_admin_token", data.token); setToken(data.token);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Login failed"); } finally { setBusy(false); }
  }

  async function action(path: string, options: RequestInit = { method: "POST" }) {
    setBusy(true); setMessage("");
    try { await request(path, options); await refresh(); setMessage("Done"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Action failed"); }
    finally { setBusy(false); }
  }

  function logout() { localStorage.removeItem("oddsaura_admin_token"); setToken(""); setTickets([]); setOverview(null); }

  if (!token) return <main className="adm-login"><form onSubmit={login}><a href="/" className="adm-brand">Odds<span>Aura</span></a><span className="adm-kicker">Administrator</span><h1>Review and publish today’s tickets.</h1><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} /></label>{message && <p className="adm-error">{message}</p>}<button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button></form></main>;

  return <main className="adm-app">
    <aside className="adm-sidebar"><a href="/" className="adm-brand">Odds<span>Aura</span></a><nav><a href="#overview">Overview</a><a href="#tickets">Tickets</a></nav><button onClick={logout}>Sign out</button></aside>
    <section className="adm-content">
      <header><div><span className="adm-kicker">Operations</span><h1>Daily ticket control</h1></div><div className="adm-actions"><button disabled={busy} onClick={() => action("/api/admin/sync")}>Sync football data</button><button disabled={busy} onClick={() => action("/api/admin/predictions/run")}>Run predictions</button><button className="adm-primary" disabled={busy} onClick={() => action("/api/admin/tickets/generate")}>Generate tickets</button></div></header>
      {message && <div className="adm-message">{message}</div>}
      <section id="overview" className="adm-metrics">{overview && Object.entries(overview).map(([label, value]) => <article key={label}><span>{label.replace(/([A-Z])/g, " $1")}</span><strong>{value}</strong></article>)}</section>
      <section id="tickets"><div className="adm-section-head"><h2>Tickets</h2><button onClick={() => refresh()} disabled={busy}>Refresh</button></div><div className="adm-ticket-list">{tickets.map((ticket) => <article className="adm-ticket" key={ticket.id}><div className="adm-ticket-top"><div><span>{ticket.category.replace("_", " ")} · {ticket.status}</span><h3>{ticket.title}</h3></div><strong>{ticket.totalOdds.toFixed(2)}</strong></div><div className="adm-ticket-selections">{ticket.selections.map((item) => <p key={item.id}><span>{item.prediction.fixture.homeTeam.name} vs {item.prediction.fixture.awayTeam.name}</span><strong>{item.prediction.selection}</strong></p>)}</div><div className="adm-ticket-bottom"><span>Confidence {Math.round(ticket.confidence * 100)}%</span><span>{ticket.bookingCodes.length ? ticket.bookingCodes.map((code) => `${code.provider}: ${code.code}`).join(" · ") : "No booking code"}</span><div>{ticket.status === "PUBLISHED" ? <button onClick={() => action(`/api/admin/tickets/${ticket.id}/unpublish`)}>Unpublish</button> : <button className="adm-primary" onClick={() => action(`/api/admin/tickets/${ticket.id}/publish`)}>Publish</button>}<button className="adm-danger" onClick={() => action(`/api/admin/tickets/${ticket.id}`, { method: "DELETE" })}>Remove</button></div></div></article>)}{!tickets.length && <div className="adm-empty">No tickets yet. Sync data, run predictions, then generate tickets.</div>}</div></section>
    </section>
  </main>;
}
