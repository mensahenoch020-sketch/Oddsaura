"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fallbackSnapshot, loadSnapshot, type Fixture, type FixtureOdd, type Snapshot } from "../data";
import { inspectProviderSlip, providerAdapters, type ProviderId } from "./providers";
import "./builder.css";

type Pick = { fixture: Fixture; odd: FixtureOdd };
type SavedPick = { fixtureId: string; marketId: string; selectionId: string };

function serialize(picks: Pick[]) {
  const compact: SavedPick[] = picks.map(({ fixture, odd }) => ({ fixtureId: fixture.id, marketId: odd.marketId, selectionId: odd.selectionId }));
  return btoa(JSON.stringify(compact)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function parseSlip(value: string | null): SavedPick[] {
  if (!value) return [];
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function hydrate(saved: SavedPick[], fixtures: Fixture[]) {
  return saved.flatMap((item) => {
    const fixture = fixtures.find((row) => row.id === item.fixtureId);
    const odd = fixture?.odds?.find((row) => row.marketId === item.marketId && row.selectionId === item.selectionId);
    return fixture && odd ? [{ fixture, odd }] : [];
  });
}

export default function BuilderPage() {
  const [snapshot, setSnapshot] = useState<Snapshot>(fallbackSnapshot);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState<ProviderId>("sportybet");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSnapshot().then((data) => {
      setSnapshot(data);
      const shared = parseSlip(new URLSearchParams(window.location.search).get("slip"));
      const local = parseSlip(window.localStorage.getItem("oddsaura-slip"));
      setPicks(hydrate(shared.length ? shared : local, data.fixtures ?? []));
      const fixtureId = new URLSearchParams(window.location.search).get("fixture");
      const target = data.fixtures?.find((fixture) => fixture.id === fixtureId);
      if (target) setSearch(`${target.homeTeam.name} ${target.awayTeam.name}`);
    }).catch(() => undefined).finally(() => setLoading(false));
  }, []);

  const fixtures = useMemo(() => (snapshot.fixtures ?? []).filter((fixture) => {
    const text = `${fixture.homeTeam.name} ${fixture.awayTeam.name} ${fixture.league.name}`.toLowerCase();
    return fixture.odds?.length && text.includes(search.toLowerCase());
  }), [snapshot.fixtures, search]);
  const totalOdds = useMemo(() => picks.reduce((value, pick) => value * pick.odd.odds, 1), [picks]);

  function choose(fixture: Fixture, odd: FixtureOdd) {
    setPicks((current) => [...current.filter((pick) => pick.fixture.id !== fixture.id), { fixture, odd }]);
    setNotice("");
  }

  function save() {
    window.localStorage.setItem("oddsaura-slip", serialize(picks));
    setNotice("Saved on this device. Account sync comes with sign up.");
  }

  async function share() {
    const url = new URL(window.location.href);
    url.searchParams.set("slip", serialize(picks));
    window.history.replaceState({}, "", url);
    if (navigator.share) await navigator.share({ title: "My OddsAura slip", text: `${picks.length} picks · ${totalOdds.toFixed(2)} total odds`, url: url.toString() });
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
    ctx.fillStyle = "#9ba8b9"; ctx.font = "24px Arial"; ctx.fillText("MY MATCH SLIP", 70, 180);
    let y = 250;
    for (const pick of picks.slice(0, 9)) {
      ctx.fillStyle = "#17243a"; ctx.fillRect(60, y - 40, 960, 104);
      ctx.fillStyle = "#ffffff"; ctx.font = "700 25px Arial"; ctx.fillText(`${pick.fixture.homeTeam.name} vs ${pick.fixture.awayTeam.name}`.slice(0, 58), 85, y);
      ctx.fillStyle = "#aab5c4"; ctx.font = "22px Arial"; ctx.fillText(`${pick.odd.market}: ${pick.odd.selection}`.slice(0, 68), 85, y + 36);
      ctx.fillStyle = "#c7fa45"; ctx.font = "700 25px Arial"; ctx.textAlign = "right"; ctx.fillText(pick.odd.odds.toFixed(2), 985, y + 12); ctx.textAlign = "left";
      y += 122;
    }
    ctx.fillStyle = "#c7fa45"; ctx.font = "700 58px Arial"; ctx.fillText(totalOdds.toFixed(2), 70, 1260);
    ctx.fillStyle = "#ffffff"; ctx.font = "22px Arial"; ctx.fillText("TOTAL ODDS · Prices may change", 70, 1302);
    const link = document.createElement("a"); link.download = "oddsaura-slip.jpg"; link.href = canvas.toDataURL("image/jpeg", .92); link.click();
    setNotice("JPEG created.");
  }

  function requestCode() {
    setNotice(inspectProviderSlip(provider, picks.map((pick) => pick.odd)));
  }

  const providerAdapter = providerAdapters.find((item) => item.id === provider) ?? providerAdapters[0];

  return <main className="build-app">
    <header className="build-header"><Link href="/" className="build-brand"><span>↗</span>Odds<i>Aura</i></Link><div><span>{snapshot.metrics.pricedMarkets} verified prices</span><Link href="/matches">All matches</Link></div></header>
    <section className="build-hero"><div><span>Personal ticket builder</span><h1>Pick the matches.<br /><i>We’ll handle the format.</i></h1></div><p>Select one market per match. Your slip is provider-neutral, so the same selections can later be mapped to SportyBet, Bet9ja, BetPawa and other supported bookmakers.</p></section>
    <section className="build-layout">
      <div className="build-board">
        <div className="build-toolbar"><div><h2>Available matches</h2><span>{loading ? "Updating prices…" : `${fixtures.length} priced fixtures`}</span></div><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search team or league" aria-label="Search matches" /></div>
        <div className="build-fixtures">{fixtures.map((fixture) => <article key={fixture.id} className="build-fixture">
          <div className="build-match"><span>{fixture.league.name} · {new Date(fixture.kickoff).toLocaleString()}</span><h3>{fixture.homeTeam.name} <i>vs</i> {fixture.awayTeam.name}</h3></div>
          <div className="build-markets">{fixture.odds.map((odd) => { const active = picks.some((pick) => pick.fixture.id === fixture.id && pick.odd.marketId === odd.marketId && pick.odd.selectionId === odd.selectionId); return <button className={active ? "active" : ""} type="button" key={`${odd.marketId}-${odd.selectionId}`} onClick={() => choose(fixture, odd)}><span>{odd.market}</span><b>{odd.selection}</b><strong>{odd.odds.toFixed(2)}</strong></button>; })}</div>
        </article>)}{!loading && !fixtures.length && <div className="build-no-data">No current fixture matches that search, or verified prices have not arrived yet.</div>}</div>
      </div>
      <aside className="build-slip">
        <div className="build-slip-title"><div><span>Your selections</span><h2>{picks.length} {picks.length === 1 ? "pick" : "picks"}</h2></div>{picks.length > 0 && <button type="button" onClick={() => setPicks([])}>Clear</button>}</div>
        <div className="build-picks">{picks.map((pick) => <div key={pick.fixture.id}><button type="button" aria-label={`Remove ${pick.fixture.homeTeam.name} versus ${pick.fixture.awayTeam.name}`} onClick={() => setPicks((rows) => rows.filter((row) => row.fixture.id !== pick.fixture.id))}>×</button><span>{pick.fixture.homeTeam.name} vs {pick.fixture.awayTeam.name}</span><strong>{pick.odd.market}: {pick.odd.selection}</strong><b>{pick.odd.odds.toFixed(2)}</b></div>)}{!picks.length && <p>Tap a market price to add your first match.</p>}</div>
        <div className="build-total"><span>Total odds</span><strong>{totalOdds.toFixed(2)}</strong></div>
        <label className="build-provider">Convert for<select value={provider} onChange={(event) => setProvider(event.target.value as ProviderId)}>{providerAdapters.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
        <button className="build-code" type="button" disabled={!picks.length} onClick={requestCode}>Prepare {providerAdapter.label} {providerAdapter.capability === "booking-code" ? "code" : "links"} <span>→</span></button>
        <div className="build-share"><button type="button" disabled={!picks.length} onClick={save}>Save</button><button type="button" disabled={!picks.length} onClick={() => void share()}>Share link</button><button type="button" disabled={!picks.length} onClick={jpeg}>JPEG</button></div>
        {notice && <p className="build-notice">{notice}</p>}
        <small>Prices shown are source prices, not guarantees. A real provider code will only appear after every selection is verified against that provider.</small>
      </aside>
    </section>
  </main>;
}
