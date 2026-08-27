"use client";

import { useEffect, useMemo, useState } from "react";
import ProductNavigation from "../product-navigation";
import { fallbackSnapshot, loadSnapshot, type PredictedPick, type Snapshot, type Team } from "../data";
import { LEAGUE_FILTERS, leagueMatches, type LeagueFilter } from "../leagues";
import { generateSportyBetCode, providerAdapters, type ProviderId, type SportyBetCodeResponse } from "./providers";
import "./builder.css";
import "./predictions.css";
import "../filter-controls.css";
import "../compact-theme.css";

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

export default function BuilderPage({ activeArea = "slip" }: { activeArea?: "home" | "slip" }) {
  const [snapshot, setSnapshot] = useState<Snapshot>(fallbackSnapshot);
  const [picks, setPicks] = useState<PredictedPick[]>([]);
  const [search, setSearch] = useState("");
  const [tier, setTier] = useState<Tier>("ALL");
  const [league, setLeague] = useState<LeagueFilter>("ALL");
  const [notice, setNotice] = useState("");
  const [sportyCode, setSportyCode] = useState<SportyBetCodeResponse | null>(null);
  const [creatingCode, setCreatingCode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [slipOpen, setSlipOpen] = useState(false);
  const [provider, setProvider] = useState<ProviderId>("sportybet");
  const [copied, setCopied] = useState("");
  const [imagePreview, setImagePreview] = useState("");
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [liveOdds, setLiveOdds] = useState<Record<string, number>>({});
  const [targetOdds, setTargetOdds] = useState("5");
  const [sportyReadyOnly, setSportyReadyOnly] = useState(false);

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
      if (!text.includes(search.trim().toLowerCase()) || (tier !== "ALL" && pick.tier !== tier) || !leagueMatches(pick.league, league) || (sportyReadyOnly && !(pick.providerMarketId && pick.providerSelectionId))) continue;
      const group = groups.get(pick.fixtureId) ?? { fixtureId: pick.fixtureId, league: pick.league, kickoff: pick.kickoff, homeTeam: pick.homeTeam, awayTeam: pick.awayTeam, predictions: [] };
      group.predictions.push(pick);
      groups.set(pick.fixtureId, group);
    }
    return [...groups.values()].sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  }, [predictions, search, tier, league, sportyReadyOnly]);
  const priceFor = (pick: PredictedPick) => liveOdds[pick.fixtureId] ?? pick.quotedOdds ?? null;
  const totalOdds = useMemo(() => picks.every((pick) => liveOdds[pick.fixtureId] ?? pick.quotedOdds) ? picks.reduce((value, pick) => value * (liveOdds[pick.fixtureId] ?? pick.quotedOdds ?? 1), 1) : null, [picks, liveOdds]);

  function choose(pick: PredictedPick) {
    setPicks((current) => current.some((item) => item.id === pick.id) ? current.filter((item) => item.id !== pick.id) : [...current.filter((item) => item.fixtureId !== pick.fixtureId), pick]);
    setNotice("");
    setSportyCode(null);
  }

  function removePick(fixtureId: string) {
    setPicks((rows) => rows.filter((row) => row.fixtureId !== fixtureId));
    setSportyCode(null);
    setLiveOdds((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== fixtureId)));
  }

  function buildToTarget() {
    const target = Math.max(1.2, Math.min(100, Number(targetOdds) || 5));
    const quality = { HIGH: 2, MEDIUM: 1, LOW: 0 };
    const ranked = [...predictions]
      .filter((pick) => pick.quotedOdds && pick.quotedOdds > 1 && pick.confidence >= .48)
      .sort((a, b) => (b.confidence + quality[b.dataQuality ?? "LOW"] * .05) - (a.confidence + quality[a.dataQuality ?? "LOW"] * .05));
    const selected: PredictedPick[] = [];
    let combined = 1;
    let underMarkets = 0;
    for (const pick of ranked) {
      if (combined >= target || selected.length >= 20 || selected.some((item) => item.fixtureId === pick.fixtureId)) continue;
      const isUnder = pick.market.key.includes("UNDER");
      if (isUnder && underMarkets >= Math.max(1, Math.floor((selected.length + 1) * .4))) continue;
      selected.push(pick); combined *= pick.quotedOdds ?? 1;
      if (isUnder) underMarkets += 1;
    }
    setPicks(selected); setSportyCode(null); setLiveOdds({}); setSlipOpen(true);
    setNotice(selected.length ? `${selected.length} stronger picks built near ${target.toFixed(2)} odds.` : "No priced picks are ready for that target.");
  }

  const weakestPick = useMemo(() => [...picks].sort((a, b) => {
    const score = (pick: PredictedPick) => pick.confidence + (pick.dataQuality === "HIGH" ? .08 : pick.dataQuality === "MEDIUM" ? .04 : 0) + (pick.quotedOdds ? .03 : 0);
    return score(a) - score(b);
  })[0] ?? null, [picks]);

  function replaceWeakest() {
    if (!weakestPick) return;
    const used = new Set(picks.map((pick) => pick.fixtureId));
    const replacement = [...predictions]
      .filter((pick) => !used.has(pick.fixtureId) && pick.quotedOdds && pick.confidence > weakestPick.confidence && pick.dataQuality !== "LOW")
      .sort((a, b) => b.confidence - a.confidence)[0];
    if (!replacement) { setNotice("No stronger replacement is available right now."); return; }
    setPicks((current) => current.map((pick) => pick.id === weakestPick.id ? replacement : pick));
    setSportyCode(null); setLiveOdds({}); setNotice("Weakest pick replaced.");
  }

  async function copyText(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1800);
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
    else await copyText(url.toString(), "Link copied");
    if (navigator.share) setNotice("Share opened");
  }

  function jpeg() {
    const canvas = document.createElement("canvas");
    const exported = picks.slice(0, 21);
    canvas.width = 1080; canvas.height = Math.max(1350, 330 + exported.length * 112);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#0d0f12"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#23d96c"; ctx.beginPath(); ctx.arc(90, 92, 28, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffffff"; ctx.font = "700 44px Arial"; ctx.fillText("OddsAura", 135, 108);
    ctx.fillStyle = "#9ba8b9"; ctx.font = "24px Arial"; ctx.fillText("MY PREDICTED MATCH SLIP", 70, 180);
    let y = 250;
    for (const pick of exported) {
      ctx.fillStyle = "#20242b"; ctx.fillRect(60, y - 40, 960, 104);
      ctx.fillStyle = "#ffffff"; ctx.font = "700 25px Arial"; ctx.fillText(`${pick.homeTeam.name} vs ${pick.awayTeam.name}`.slice(0, 58), 85, y);
      ctx.fillStyle = "#aab5c4"; ctx.font = "22px Arial"; ctx.fillText(`${pick.market.name}: ${pick.selection} · ${Math.round(pick.confidence * 100)}% confidence`.slice(0, 72), 85, y + 36);
      ctx.fillStyle = "#23d96c"; ctx.font = "700 25px Arial"; ctx.textAlign = "right"; ctx.fillText(priceFor(pick)?.toFixed(2) ?? "PRICE PENDING", 985, y + 12); ctx.textAlign = "left";
      y += 112;
    }
    const footerY = canvas.height - 90;
    ctx.fillStyle = "#23d96c"; ctx.font = "700 58px Arial"; ctx.fillText(totalOdds?.toFixed(2) ?? "MODEL SLIP", 70, footerY);
    ctx.fillStyle = "#ffffff"; ctx.font = "22px Arial"; ctx.fillText(totalOdds ? "TOTAL ODDS · Prices may change" : "SOME BOOKMAKER PRICES ARE PENDING", 70, footerY + 42);
    canvas.toBlob((blob) => {
      if (!blob) return;
      if (imagePreview) URL.revokeObjectURL(imagePreview);
      setImageBlob(blob);
      setImagePreview(URL.createObjectURL(blob));
    }, "image/jpeg", .92);
  }

  async function shareJpeg() {
    if (!imageBlob) return;
    const file = new File([imageBlob], "oddsaura-slip.jpg", { type: "image/jpeg" });
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({ title: "OddsAura betslip", files: [file] });
      setNotice("Choose Save Image");
    } else {
      const link = document.createElement("a");
      link.download = file.name;
      link.href = imagePreview;
      link.click();
      setNotice("JPEG downloaded");
    }
  }

  async function requestCode() {
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
      const currentLiveOdds = Object.fromEntries(result.resolved.flatMap((item) => item.odds ? [[item.fixtureId, item.odds]] : []));
      setLiveOdds(currentLiveOdds);
      const changed = picks.filter((pick) => currentLiveOdds[pick.fixtureId] && pick.quotedOdds && Math.abs(currentLiveOdds[pick.fixtureId] - pick.quotedOdds) > .001).length;
      setNotice(result.partial
        ? `${result.resolved.length}/${picks.length} matched${changed ? ` · ${changed} prices updated` : ""}`
        : `Verified · ${result.resolved.length} selections${changed ? ` · ${changed} prices updated` : ""}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "SportyBet could not create this code.");
    } finally {
      setCreatingCode(false);
    }
  }

  const activeProvider = providerAdapters.find((item) => item.id === provider) ?? providerAdapters[0];

  return <main className="build-app compact-betting-app">
    <ProductNavigation active={activeArea} slipCount={picks.length} />
    <section className="build-hero compact-hero"><div><span>Football</span><h1>Pick your matches</h1></div><div className="build-live-state"><i /> Predictions updated</div></section>
    <section className="build-layout">
      <div className="build-board">
        <div className="build-toolbar"><div><h2>Matches</h2><span>{loading ? "Loading…" : `${fixtureGroups.length} available`}</span></div><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search team or league" aria-label="Search predicted games" /></div>
        <div className="build-tier-tabs" aria-label="Prediction risk"><button type="button" className={tier === "ALL" ? "active" : ""} onClick={() => setTier("ALL")}>All <b>{tierCounts.ALL}</b></button><button type="button" className={tier === "SAFE" ? "active" : ""} onClick={() => setTier("SAFE")}>Safe <b>{tierCounts.SAFE}</b></button><button type="button" className={tier === "BALANCED" ? "active" : ""} onClick={() => setTier("BALANCED")}>Balanced <b>{tierCounts.BALANCED}</b></button><button type="button" className={tier === "HIGH_RISK" ? "active" : ""} onClick={() => setTier("HIGH_RISK")}>High risk <b>{tierCounts.HIGH_RISK}</b></button></div>
        <div className="build-tools"><label><span>Target odds</span><input inputMode="decimal" value={targetOdds} onChange={(event) => setTargetOdds(event.target.value)} aria-label="Target total odds" /></label><button type="button" onClick={buildToTarget}>Build target</button><label className="build-ready"><input type="checkbox" checked={sportyReadyOnly} onChange={(event) => setSportyReadyOnly(event.target.checked)} /><span>SportyBet IDs ready</span></label></div>
        <div className="build-filter-toggle build-filter-label"><b>Leagues</b><span>{LEAGUE_FILTERS.find((item) => item.id === league)?.label}</span></div>
        <div className="build-league-tabs open" aria-label="League filter">{LEAGUE_FILTERS.map((item) => <button type="button" key={item.id} className={league === item.id ? "active" : ""} onClick={() => setLeague(item.id)}>{item.label}</button>)}</div>
        <div className="build-fixtures">{fixtureGroups.map((group) => <article id={`fixture-${encodeURIComponent(group.fixtureId)}`} key={group.fixtureId} className="build-fixture">
          <div className="build-match build-predicted-match"><div><TeamBadge team={group.homeTeam} /><strong>{group.homeTeam.name}</strong><span>vs</span><TeamBadge team={group.awayTeam} /><strong>{group.awayTeam.name}</strong></div><small>{group.league.name} · {new Date(group.kickoff).toLocaleString()}</small></div>
          <div className="build-markets build-predictions">{group.predictions.map((pick) => { const active = picks.some((item) => item.id === pick.id); const price = priceFor(pick); return <button className={active ? "active" : ""} type="button" key={pick.id} onClick={() => choose(pick)}><span>{pick.market.name}</span><b>{pick.selection}</b><strong>{price?.toFixed(2) ?? pick.fairOdds.toFixed(2)}</strong><small>{liveOdds[pick.fixtureId] ? "SportyBet live" : pick.quotedOdds ? `${pick.oddsProvider ?? "Quoted"}` : "Model price"}</small></button>; })}</div>
        </article>)}{!loading && !fixtureGroups.length && <div className="build-no-data">No model-approved selections match this filter yet. Try All predictions or another team.</div>}</div>
      </div>
      <aside className={`build-slip ${slipOpen ? "open" : ""}`} id="my-slip" aria-label="Betslip">
        <div className="build-slip-title"><div><span>Betslip</span><h2>{picks.length} {picks.length === 1 ? "selection" : "selections"}</h2></div><div>{picks.length > 0 && <button type="button" onClick={() => { setPicks([]); setSportyCode(null); setLiveOdds({}); }}>Clear</button>}<button className="build-slip-close" type="button" onClick={() => setSlipOpen(false)}>×</button></div></div>
        <div className="build-picks">{picks.map((pick) => <div key={pick.fixtureId}><button type="button" aria-label={`Remove ${pick.homeTeam.name} versus ${pick.awayTeam.name}`} onClick={() => removePick(pick.fixtureId)}>×</button><span>{pick.homeTeam.name} vs {pick.awayTeam.name}</span><strong>{pick.market.name}: {pick.selection}</strong><b>{priceFor(pick)?.toFixed(2) ?? "Pending"} <small>{liveOdds[pick.fixtureId] ? "LIVE" : ""}</small></b><a href={`#fixture-${encodeURIComponent(pick.fixtureId)}`} onClick={() => setSlipOpen(false)}>Change</a></div>)}{!picks.length && <p>No selections</p>}</div>
        <div className="build-total"><span>{totalOdds ? "Total odds" : "Bookmaker prices"}</span><strong>{totalOdds?.toFixed(2) ?? "Pending"}</strong></div>
        {weakestPick ? <div className="slip-doctor"><div><span>Slip Doctor</span><b>{weakestPick.homeTeam.shortName || weakestPick.homeTeam.name} vs {weakestPick.awayTeam.shortName || weakestPick.awayTeam.name}</b><small>{weakestPick.dataQuality === "LOW" ? "Limited match history" : `${Math.round(weakestPick.confidence * 100)}% confidence · weakest leg`}</small></div><button type="button" onClick={replaceWeakest}>Replace</button></div> : null}
        <div className="build-provider-list" aria-label="Choose bookmaker">{providerAdapters.filter((item) => item.id !== "draftkings").map((item) => <button type="button" key={item.id} className={provider === item.id ? "active" : ""} onClick={() => { setProvider(item.id); setSportyCode(null); }}>{item.label}<small>{item.status === "live" ? "Live" : "Next"}</small></button>)}</div>
        <button className="build-code" type="button" disabled={!picks.length || creatingCode || activeProvider.status !== "live"} onClick={() => void requestCode()}>{activeProvider.status !== "live" ? `${activeProvider.label} verification pending` : creatingCode ? "Checking live odds…" : "Generate code"} <span>→</span></button>
        {sportyCode && <div className="build-real-code"><span>SportyBet code</span><strong>{sportyCode.code}</strong><div><button type="button" onClick={() => void copyText(sportyCode.code, "Code copied")}>{copied === "Code copied" ? "Copied ✓" : "Copy code"}</button><a href={sportyCode.deepLink} target="_blank" rel="noreferrer">Open SportyBet ↗</a></div></div>}
        {sportyCode?.unmatched.length ? <div className="build-unmatched"><strong>Not included</strong>{sportyCode.unmatched.map((item) => <div key={item.fixtureId}><span>{item.homeTeam} vs {item.awayTeam}</span><small>{item.reason}</small><button type="button" onClick={() => removePick(item.fixtureId)}>Remove</button></div>)}</div> : null}
        <div className="build-share"><button type="button" disabled={!picks.length} onClick={() => void save()}>Save</button><button type="button" disabled={!picks.length} onClick={() => void share()}>Share</button><button type="button" disabled={!picks.length} onClick={jpeg}>Save image</button></div>
        {notice && <p className="build-notice">{notice}</p>}
      </aside>
    </section>
    <button className="build-floating-slip" type="button" onClick={() => setSlipOpen(true)}><span>▤</span><b>{picks.length}</b><strong>{totalOdds?.toFixed(2) ?? "Betslip"}</strong></button>
    {slipOpen && <button className="build-slip-backdrop" type="button" aria-label="Close betslip" onClick={() => setSlipOpen(false)} />}
    {copied && <div className="copy-toast" role="status">✓ {copied}</div>}
    {imagePreview && <div className="image-preview" role="dialog" aria-modal="true" aria-label="Betslip image preview"><div><header><strong>Betslip image</strong><button type="button" onClick={() => { URL.revokeObjectURL(imagePreview); setImagePreview(""); setImageBlob(null); }}>×</button></header><img src={imagePreview} alt="OddsAura betslip ready to save" /><footer><button type="button" onClick={() => void shareJpeg()}>Save to phone</button><a href={imagePreview} download="oddsaura-slip.jpg">Download JPEG</a></footer></div></div>}
  </main>;
}
