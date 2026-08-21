"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fallbackSnapshot, loadSnapshot, type PredictedPick, type Snapshot, type Team } from "../data";
import { generateSportyBetCode, inspectProviderSlip, providerAdapters, type ProviderId, type SportyBetCodeResponse } from "./providers";
import "./builder.css";
import "./predictions.css";

/* Badge hosts are supplied dynamically by the football feed. */
/* eslint-disable @next/next/no-img-element */

type SavedPick = { predictionId: string };
type Tier = "ALL" | PredictedPick["tier"];

function serialize(picks: PredictedPick[]) {
  return btoa(JSON.stringify(picks.map((pick) => ({ predictionId: pick.id })) satisfies SavedPick[])).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function parseSlip(value: string | null): SavedPick[] {
  if (!value) return [];
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded));
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item?.predictionId === "string") : [];
  } catch { return []; }
}

function hydrate(saved: SavedPick[], predictions: PredictedPick[]) {
  return saved.flatMap((item) => predictions.find((pick) => pick.id === item.predictionId) ?? []);
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

function TeamBadge({ team }: { team: Team }) {
  const [failed, setFailed] = useState(false);
  return <span className="build-team-badge" aria-hidden="true">{!failed && team.logo ? <img src={team.logo} alt="" loading="lazy" onError={() => setFailed(true)} /> : initials(team.shortName || team.name)}</span>;
}

export default function BuilderPage() {
  const [snapshot, setSnapshot] = useState<Snapshot>(fallbackSnapshot);
  const [picks, setPicks] = useState<PredictedPick[]>([]);
  const [search, setSearch] = useState("");
  const [tier, setTier] = useState<Tier>("ALL");
  const [provider, setProvider] = useState<ProviderId>("sportybet");
  const [notice, setNotice] = useState("");
  const [sportyCode, setSportyCode] = useState<SportyBetCodeResponse | null>(null);
  const [creatingCode, setCreatingCode] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSnapshot().then((data) => {
      setSnapshot(data);
      const predictions = data.predictedPicks ?? [];
      const shared = parseSlip(new URLSearchParams(window.location.search).get("slip"));
      const local = parseSlip(window.localStorage.getItem("oddsaura-predicted-slip"));
      setPicks(hydrate(shared.length ? shared : local, predictions));
      const fixtureId = new URLSearchParams(window.location.search).get("fixture");
      const target = predictions.find((pick) => pick.fixtureId === fixtureId);
      if (target) setSearch(`${target.homeTeam.name} ${target.awayTeam.name}`);
    }).catch(() => undefined).finally(() => setLoading(false));
  }, []);

  const predictions = useMemo(() => snapshot.predictedPicks ?? [], [snapshot.predictedPicks]);
  const tierCounts = useMemo(() => ({ ALL: predictions.length, SAFE: predictions.filter((pick) => pick.tier === "SAFE").length, BALANCED: predictions.filter((pick) => pick.tier === "BALANCED").length, HIGH_RISK: predictions.filter((pick) => pick.tier === "HIGH_RISK").length }), [predictions]);
  const fixtureGroups = useMemo(() => {
    const groups = new Map<string, { fixtureId: string; league: PredictedPick["league"]; kickoff: string; homeTeam: Team; awayTeam: Team; predictions: PredictedPick[] }>();
    for (const pick of predictions) {
      const text = `${pick.homeTeam.name} ${pick.awayTeam.name} ${pick.league.name} ${pick.market.name} ${pick.selection}`.toLowerCase();
      if (!text.includes(search.trim().toLowerCase()) || (tier !== "ALL" && pick.tier !== tier)) continue;
      const group = groups.get(pick.fixtureId) ?? { fixtureId: pick.fixtureId, league: pick.league, kickoff: pick.kickoff, homeTeam: pick.homeTeam, awayTeam: pick.awayTeam, predictions: [] };
      group.predictions.push(pick);
      groups.set(pick.fixtureId, group);
    }
    return [...groups.values()].sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  }, [predictions, search, tier]);
  const totalOdds = useMemo(() => picks.every((pick) => pick.quotedOdds) ? picks.reduce((value, pick) => value * (pick.quotedOdds ?? 1), 1) : null, [picks]);

  function choose(pick: PredictedPick) {
    setPicks((current) => [...current.filter((item) => item.fixtureId !== pick.fixtureId), pick]);
    setNotice("");
    setSportyCode(null);
  }

  async function save() {
    window.localStorage.setItem("oddsaura-predicted-slip", serialize(picks));
    try {
      const response = await fetch("/api/slips", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: `My ${picks.length}-pick slip`, picks: picks.map((pick) => ({ predictionId: pick.id })) }) });
      if (response.ok) setNotice("Saved to your OddsAura account and this device.");
      else if (response.status === 401) setNotice("Saved on this device. Sign in to keep it across devices.");
      else setNotice("Saved on this device. Account storage is temporarily unavailable.");
    } catch { setNotice("Saved on this device. Account storage is temporarily unavailable."); }
  }

  async function share() {
    const url = new URL(window.location.href);
    url.searchParams.set("slip", serialize(picks));
    window.history.replaceState({}, "", url);
    if (navigator.share) await navigator.share({ title: "My OddsAura predicted slip", text: `${picks.length} modelled picks${totalOdds ? ` · ${totalOdds.toFixed(2)} total odds` : " · some prices pending"}`, url: url.toString() });
    else await navigator.clipboard.writeText(url.toString());
    setNotice(navigator.share ? "Share sheet opened." : "Share link copied.");
  }

  function jpeg() {
    const canvas = document.createElement("canvas");
    canvas.width = 1080; canvas.height = 1350;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#0b1426"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#c7fa45"; ctx.beginPath(); ctx.arc(90, 92, 28, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffffff"; ctx.font = "700 44px Arial"; ctx.fillText("OddsAura", 135, 108);
    ctx.fillStyle = "#9ba8b9"; ctx.font = "24px Arial"; ctx.fillText("MY PREDICTED MATCH SLIP", 70, 180);
    let y = 250;
    for (const pick of picks.slice(0, 9)) {
      ctx.fillStyle = "#17243a"; ctx.fillRect(60, y - 40, 960, 104);
      ctx.fillStyle = "#ffffff"; ctx.font = "700 25px Arial"; ctx.fillText(`${pick.homeTeam.name} vs ${pick.awayTeam.name}`.slice(0, 58), 85, y);
      ctx.fillStyle = "#aab5c4"; ctx.font = "22px Arial"; ctx.fillText(`${pick.market.name}: ${pick.selection} · ${Math.round(pick.confidence * 100)}% confidence`.slice(0, 72), 85, y + 36);
      ctx.fillStyle = "#c7fa45"; ctx.font = "700 25px Arial"; ctx.textAlign = "right"; ctx.fillText(pick.quotedOdds?.toFixed(2) ?? "PRICE PENDING", 985, y + 12); ctx.textAlign = "left";
      y += 122;
    }
    ctx.fillStyle = "#c7fa45"; ctx.font = "700 58px Arial"; ctx.fillText(totalOdds?.toFixed(2) ?? "MODEL SLIP", 70, 1260);
    ctx.fillStyle = "#ffffff"; ctx.font = "22px Arial"; ctx.fillText(totalOdds ? "TOTAL ODDS · Prices may change" : "SOME BOOKMAKER PRICES ARE PENDING", 70, 1302);
    const link = document.createElement("a"); link.download = "oddsaura-predicted-slip.jpg"; link.href = canvas.toDataURL("image/jpeg", .92); link.click();
    setNotice("Prediction slip saved as a JPEG.");
  }

  async function requestCode() {
    if (provider !== "sportybet") {
      setNotice(inspectProviderSlip(provider, picks.map((pick) => ({ provider: pick.oddsProvider ?? undefined, deepLink: pick.providerDeepLink }))));
      return;
    }
    setCreatingCode(true);
    setNotice("Matching every pick against SportyBet’s current markets…");
    setSportyCode(null);
    try {
      const result = await generateSportyBetCode(picks.map((pick) => ({
        fixtureId: pick.fixtureId,
        homeTeam: pick.homeTeam.name,
        awayTeam: pick.awayTeam.name,
        kickoff: pick.kickoff,
        marketKey: pick.market.key,
        marketName: pick.market.name,
        selection: pick.selection,
        line: pick.market.line,
        providerEventId: pick.fixtureId.startsWith("sr:match:") ? pick.fixtureId : null,
        providerMarketId: pick.fixtureId.startsWith("sr:match:") ? pick.providerMarketId : null,
        providerOutcomeId: pick.fixtureId.startsWith("sr:match:") ? pick.providerSelectionId : null,
      })));
      setSportyCode(result);
      setNotice(`Verified by SportyBet · ${result.resolved.length} selections matched.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "SportyBet could not create this code.");
    } finally {
      setCreatingCode(false);
    }
  }

  const providerAdapter = providerAdapters.find((item) => item.id === provider) ?? providerAdapters[0];

  return <main className="build-app">
    <header className="build-header"><Link href="/" className="build-brand"><span>↗</span>Odds<i>Aura</i></Link><div><span>{predictions.length} selectable predictions</span><Link href="/login">Account</Link><Link href="/matches">Matches</Link></div></header>
    <section className="build-hero"><div><span>Predicted ticket builder</span><h1>Choose our picks.<br /><i>Build your own ticket.</i></h1></div><p>Every option below has already passed through OddsAura’s probability model. Pick one prediction per match, then save it, share it, export a JPEG or prepare it for SportyBet mapping.</p></section>
    <section className="build-layout">
      <div className="build-board">
        <div className="build-toolbar"><div><h2>Predicted games</h2><span>{loading ? "Scoring today’s matches…" : `${fixtureGroups.length} matches with selectable predictions`}</span></div><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search team, league or market" aria-label="Search predicted games" /></div>
        <div className="build-tier-tabs" aria-label="Prediction risk"><button type="button" className={tier === "ALL" ? "active" : ""} onClick={() => setTier("ALL")}>All <b>{tierCounts.ALL}</b></button><button type="button" className={tier === "SAFE" ? "active" : ""} onClick={() => setTier("SAFE")}>Safe <b>{tierCounts.SAFE}</b></button><button type="button" className={tier === "BALANCED" ? "active" : ""} onClick={() => setTier("BALANCED")}>Balanced <b>{tierCounts.BALANCED}</b></button><button type="button" className={tier === "HIGH_RISK" ? "active" : ""} onClick={() => setTier("HIGH_RISK")}>High risk <b>{tierCounts.HIGH_RISK}</b></button></div>
        <div className="build-fixtures">{fixtureGroups.map((group) => <article key={group.fixtureId} className="build-fixture">
          <div className="build-match build-predicted-match"><div><TeamBadge team={group.homeTeam} /><strong>{group.homeTeam.name}</strong><span>vs</span><TeamBadge team={group.awayTeam} /><strong>{group.awayTeam.name}</strong></div><small>{group.league.name} · {new Date(group.kickoff).toLocaleString()}</small></div>
          <div className="build-markets build-predictions">{group.predictions.map((pick) => { const active = picks.some((item) => item.id === pick.id); return <button className={active ? "active" : ""} type="button" key={pick.id} onClick={() => choose(pick)}><span>{pick.tier.replace("_", " ")} · {pick.market.name}</span><b>{pick.selection}</b><strong>{pick.quotedOdds?.toFixed(2) ?? `Fair ${pick.fairOdds.toFixed(2)}`}</strong><small>{pick.dataQuality === "LOW" ? "Limited data" : `${Math.round(pick.confidence * 100)}% confidence`}</small><em>{pick.reasoning}</em></button>; })}</div>
        </article>)}{!loading && !fixtureGroups.length && <div className="build-no-data">No model-approved selections match this filter yet. Try All predictions or another team.</div>}</div>
      </div>
      <aside className="build-slip">
        <div className="build-slip-title"><div><span>Your predicted selections</span><h2>{picks.length} {picks.length === 1 ? "pick" : "picks"}</h2></div>{picks.length > 0 && <button type="button" onClick={() => setPicks([])}>Clear</button>}</div>
        <div className="build-picks">{picks.map((pick) => <div key={pick.fixtureId}><button type="button" aria-label={`Remove ${pick.homeTeam.name} versus ${pick.awayTeam.name}`} onClick={() => setPicks((rows) => rows.filter((row) => row.fixtureId !== pick.fixtureId))}>×</button><span>{pick.homeTeam.name} vs {pick.awayTeam.name}</span><strong>{pick.market.name}: {pick.selection}</strong><b>{pick.quotedOdds?.toFixed(2) ?? "Price pending"} · {pick.dataQuality === "LOW" ? "Limited data" : `${Math.round(pick.confidence * 100)}%`}</b></div>)}{!picks.length && <p>Choose one of OddsAura’s predicted selections to start your ticket.</p>}</div>
        <div className="build-total"><span>{totalOdds ? "Total odds" : "Bookmaker prices"}</span><strong>{totalOdds?.toFixed(2) ?? "Pending"}</strong></div>
        <label className="build-provider">Convert for<select value={provider} onChange={(event) => setProvider(event.target.value as ProviderId)}>{providerAdapters.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
        <button className="build-code" type="button" disabled={!picks.length || creatingCode} onClick={() => void requestCode()}>{creatingCode ? "Creating real SportyBet code…" : `${provider === "sportybet" ? "Create" : "Prepare"} ${providerAdapter.label} ${providerAdapter.capability === "booking-code" ? "code" : "links"}`} <span>→</span></button>
        {sportyCode && <div className="build-real-code"><span>SportyBet booking code</span><strong>{sportyCode.code}</strong><div><button type="button" onClick={() => void navigator.clipboard.writeText(sportyCode.code)}>Copy code</button><a href={sportyCode.deepLink} target="_blank" rel="noreferrer">Load on SportyBet ↗</a></div></div>}
        <div className="build-share"><button type="button" disabled={!picks.length} onClick={() => void save()}>Save</button><button type="button" disabled={!picks.length} onClick={() => void share()}>Share link</button><button type="button" disabled={!picks.length} onClick={jpeg}>JPEG</button></div>
        {notice && <p className="build-notice">{notice}</p>}
        <small>Only model-scored predictions appear here. SportyBet codes are returned only after every selection is matched and the new code is loaded back from SportyBet for verification.</small>
      </aside>
    </section>
  </main>;
}
