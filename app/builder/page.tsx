"use client";

import { useEffect, useMemo, useState } from "react";
import ProductNavigation from "../product-navigation";
import ConverterForm from "../converter/converter-form";
import { fallbackSnapshot, loadSnapshot, refreshSnapshot, type PredictedPick, type Snapshot, type Team } from "../data";
import { LEAGUE_FILTERS, leagueMatches, type LeagueFilter } from "../leagues";
import { generateBookmakerCode, providerAdapters, providerSupportsMarket, type BookmakerCodeResponse, type ProviderId } from "./providers";
import { buildTargetSlip, type BuildMode } from "./target-builder";
import "./builder.css";
import "./predictions.css";
import "../filter-controls.css";
import "../compact-theme.css";
import "../converter/converter.css";
import "../converter/home-converter.css";

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
  const [sportyCode, setSportyCode] = useState<BookmakerCodeResponse | null>(null);
  const [creatingCode, setCreatingCode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [slipOpen, setSlipOpen] = useState(false);
  const [provider, setProvider] = useState<ProviderId>("sportybet");
  const [copied, setCopied] = useState("");
  const [imagePreview, setImagePreview] = useState("");
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [liveOdds, setLiveOdds] = useState<Record<string, number>>({});
  const [targetOdds, setTargetOdds] = useState("2");
  const [buildMode, setBuildMode] = useState<BuildMode>("target");
  const [builtTarget, setBuiltTarget] = useState<{ requested: number; estimated: number; legs: number; confidence: number; winChance: number; exact: boolean; risk: string; estimatedPrices: number } | null>(null);
  const [doctorNotice, setDoctorNotice] = useState("");
  const [visibleFixtures, setVisibleFixtures] = useState(60);
  const [referenceTime] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    const apply = (data: Snapshot, restoreSaved = false) => {
      if (!active) return;
      const predictions = (data.predictedPicks ?? []).filter((pick) => Date.parse(pick.kickoff) > referenceTime);
      setSnapshot({ ...data, predictedPicks: predictions });
      if (restoreSaved) {
        const shared = parseSlip(new URLSearchParams(window.location.search).get("slip"));
        const local = parseSlip(window.localStorage.getItem("oddsaura-predicted-slip"));
        setPicks(hydrate(shared.length ? shared : local, predictions));
        const fixtureId = new URLSearchParams(window.location.search).get("fixture");
        const target = predictions.find((pick) => pick.fixtureId === fixtureId);
        if (target) setSearch(`${target.homeTeam.name} ${target.awayTeam.name}`);
      } else setPicks((current) => current.flatMap((saved) => predictions.find((pick) => pick.id === saved.id) ?? []));
    };
    loadSnapshot("builder").then((data) => apply(data, true)).catch(() => undefined).finally(() => { if (active) setLoading(false); });
    refreshSnapshot("builder").then((data) => apply(data)).catch(() => undefined);
    return () => { active = false; };
  }, [referenceTime]);

  const predictions = useMemo(() => (snapshot.predictedPicks ?? []).filter((pick) => Date.parse(pick.kickoff) > referenceTime), [snapshot.predictedPicks, referenceTime]);
  const providerPredictions = useMemo(() => predictions.filter((pick) => providerSupportsMarket(provider, pick.market.key)), [predictions, provider]);
  const tierCounts = useMemo(() => ({ ALL: providerPredictions.length, SAFE: providerPredictions.filter((pick) => pick.tier === "SAFE").length, BALANCED: providerPredictions.filter((pick) => pick.tier === "BALANCED").length, HIGH_RISK: providerPredictions.filter((pick) => pick.tier === "HIGH_RISK").length }), [providerPredictions]);
  const fixtureGroups = useMemo(() => {
    const groups = new Map<string, { fixtureId: string; league: PredictedPick["league"]; kickoff: string; homeTeam: Team; awayTeam: Team; predictions: PredictedPick[] }>();
    for (const pick of providerPredictions) {
      const text = `${pick.homeTeam.name} ${pick.awayTeam.name} ${pick.league.name} ${pick.market.name} ${pick.selection}`.toLowerCase();
      if (!text.includes(search.trim().toLowerCase()) || (tier !== "ALL" && pick.tier !== tier) || !leagueMatches(pick.league, league)) continue;
      const group = groups.get(pick.fixtureId) ?? { fixtureId: pick.fixtureId, league: pick.league, kickoff: pick.kickoff, homeTeam: pick.homeTeam, awayTeam: pick.awayTeam, predictions: [] };
      group.predictions.push(pick);
      groups.set(pick.fixtureId, group);
    }
    return [...groups.values()].sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  }, [providerPredictions, search, tier, league]);
  const visibleFixtureGroups = useMemo(() => fixtureGroups.slice(0, visibleFixtures), [fixtureGroups, visibleFixtures]);
  const priceFor = (pick: PredictedPick) => liveOdds[pick.fixtureId] ?? pick.quotedOdds ?? pick.fairOdds ?? null;
  const totalOdds = useMemo(() => picks.every((pick) => liveOdds[pick.fixtureId] ?? pick.quotedOdds ?? pick.fairOdds) ? picks.reduce((value, pick) => value * (liveOdds[pick.fixtureId] ?? pick.quotedOdds ?? pick.fairOdds ?? 1), 1) : null, [picks, liveOdds]);
  const livePriceCount = useMemo(() => picks.filter((pick) => Boolean(liveOdds[pick.fixtureId])).length, [picks, liveOdds]);
  const allPricesLive = picks.length > 0 && livePriceCount === picks.length;
  const unsupportedPicks = useMemo(() => picks.filter((pick) => !providerSupportsMarket(provider, pick.market.key)), [picks, provider]);
  const selectionsText = picks.map((pick) => `${pick.homeTeam.name} vs ${pick.awayTeam.name} — ${pick.market.name}: ${pick.selection}`).join("\n");

  function choose(pick: PredictedPick) {
    setPicks((current) => current.some((item) => item.id === pick.id) ? current.filter((item) => item.id !== pick.id) : [...current.filter((item) => item.fixtureId !== pick.fixtureId), pick]);
    setNotice("");
    setSportyCode(null);
    setLiveOdds({});
    setDoctorNotice("");
    setBuiltTarget(null);
  }

  function removePick(fixtureId: string) {
    setPicks((rows) => rows.filter((row) => row.fixtureId !== fixtureId));
    setSportyCode(null);
    setLiveOdds((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== fixtureId)));
    setDoctorNotice("");
    setBuiltTarget(null);
  }

  async function buildToTarget() {
    const result = buildTargetSlip(providerPredictions, Number(targetOdds), referenceTime, provider, buildMode);
    const selected = result?.picks ?? [];
    setPicks(selected); setSportyCode(null); setLiveOdds({}); setSlipOpen(true);
    if (!result) { setBuiltTarget(null); setNotice(buildMode === "recommended" ? `No strict Best Bet reaches that target. OddsAura will not force weak selections.` : `No compatible ${activeProvider.label} selections could build that target.`); return; }
    const targetSummary = { requested: result.target, estimated: result.estimatedOdds, legs: selected.length, confidence: result.averageConfidence, winChance: result.estimatedWinChance, exact: result.exact, risk: result.risk, estimatedPrices: result.estimatedPriceCount };
    setBuiltTarget(targetSummary);
    if (activeProvider.status !== "live") { setNotice(`${selected.length} picks built for ${activeProvider.label} at ${result.estimatedOdds.toFixed(2)} estimated odds. Copy the complete list to rebuild it without losing matches.`); return; }
    const first = await requestCode(selected, result.target);
    if (!first?.result.verified || Math.abs(first.liveTotal - result.target) / result.target <= .03) return;
    const adjustedTarget = Math.max(1.2, Math.min(100, result.target * result.target / Math.max(first.liveTotal, 1.01)));
    const retry = buildTargetSlip(providerPredictions, adjustedTarget, referenceTime, provider, buildMode);
    if (!retry || retry.picks.map((pick) => pick.id).join() === selected.map((pick) => pick.id).join()) return;
    const second = await requestCode(retry.picks, result.target);
    if (second?.result.verified && Math.abs(second.liveTotal - result.target) < Math.abs(first.liveTotal - result.target)) {
      setPicks(retry.picks);
      setBuiltTarget({ ...targetSummary, estimated: retry.estimatedOdds, legs: retry.picks.length, exact: Math.abs(second.liveTotal - result.target) / result.target <= .03, risk: retry.risk, estimatedPrices: retry.estimatedPriceCount });
    } else {
      setPicks(selected); setSportyCode(first.result); setLiveOdds(first.currentLiveOdds);
      setNotice(`Verified ${activeProvider.label} code · live total ${first.liveTotal.toFixed(2)} against ${result.target.toFixed(2)} target.`);
    }
  }

  const weakestPick = useMemo(() => [...picks].sort((a, b) => {
    const score = (pick: PredictedPick) => pick.confidence + (pick.dataQuality === "HIGH" ? .08 : pick.dataQuality === "MEDIUM" ? .04 : 0) + (pick.quotedOdds ? .03 : 0);
    return score(a) - score(b);
  })[0] ?? null, [picks]);

  function replaceWeakest() {
    if (!weakestPick) return;
    const usedByOtherPicks = new Set(picks.filter((pick) => pick.id !== weakestPick.id).map((pick) => pick.fixtureId));
    const targetPrice = priceFor(weakestPick) ?? weakestPick.fairOdds ?? 1;
    const quality = { HIGH: .1, MEDIUM: .05, LOW: 0 };
    const candidates = predictions.filter((pick) => pick.id !== weakestPick.id && !usedByOtherPicks.has(pick.fixtureId));
    const score = (pick: PredictedPick) => {
      const price = priceFor(pick) ?? pick.fairOdds ?? 1;
      const sameFixture = pick.fixtureId === weakestPick.fixtureId ? .16 : 0;
      const sameLeague = pick.league.id === weakestPick.league.id ? .05 : 0;
      const verifiedIds = pick.providerMarketId && pick.providerSelectionId ? .04 : 0;
      const quoted = pick.quotedOdds ? .025 : 0;
      const priceDistance = Math.min(.12, Math.abs(Math.log(Math.max(price, 1.01) / Math.max(targetPrice, 1.01))) * .08);
      return pick.confidence + quality[pick.dataQuality ?? "LOW"] + sameFixture + sameLeague + verifiedIds + quoted - priceDistance;
    };
    const replacement = candidates.sort((a, b) => score(b) - score(a))[0];
    if (!replacement) {
      setDoctorNotice("No suitable replacement available");
      return;
    }
    setPicks((current) => current.map((pick) => pick.id === weakestPick.id ? replacement : pick));
    setSportyCode(null);
    setLiveOdds({});
    setDoctorNotice(`Replaced with ${replacement.market.name}: ${replacement.selection} ✓`);
    setNotice("");
    setBuiltTarget(null);
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
    if (navigator.share) await navigator.share({ title: "My OddsAura predicted slip", text: `${picks.length} modelled picks${totalOdds ? ` · ${totalOdds.toFixed(2)} ${allPricesLive ? "verified live" : "estimated"} odds` : " · some prices pending"}`, url: url.toString() });
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
    ctx.fillStyle = "#ffffff"; ctx.font = "22px Arial"; ctx.fillText(totalOdds ? (allPricesLive ? `${activeProvider.label.toUpperCase()} LIVE ODDS` : "ESTIMATED ODDS · VERIFY WITH BOOKMAKER") : "SOME BOOKMAKER PRICES ARE PENDING", 70, footerY + 42);
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

  async function requestCode(picksToCheck = picks, requestedTarget?: number) {
    setCreatingCode(true);
    setNotice(`Matching every pick against ${activeProvider.label}’s current markets…`);
    setSportyCode(null);
    setLiveOdds({});
    try {
      const result = await generateBookmakerCode(provider, picksToCheck.map((pick) => ({
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
      if (!result.verified) {
        setLiveOdds({});
        setNotice(result.warning || "Code created, but verification is incomplete. Check every pick on the bookmaker.");
        return { result, currentLiveOdds: {}, liveTotal: 1 };
      }
      const currentLiveOdds = Object.fromEntries(result.resolved.flatMap((item) => item.odds ? [[item.fixtureId, item.odds]] : []));
      setLiveOdds(currentLiveOdds);
      const changed = picksToCheck.filter((pick) => currentLiveOdds[pick.fixtureId] && pick.quotedOdds && Math.abs(currentLiveOdds[pick.fixtureId] - pick.quotedOdds) > .001).length;
      const liveTotal = result.resolved.reduce((total, selection) => total * (selection.odds ?? 1), 1);
      setNotice(result.warning || (result.partial
        ? `${result.resolved.length}/${picksToCheck.length} matched${changed ? ` · ${changed} prices updated` : ""}`
        : `Verified ${activeProvider.label} code · live total ${liveTotal.toFixed(2)}${requestedTarget ? ` against ${requestedTarget.toFixed(2)} target` : ""}${changed ? ` · ${changed} prices updated` : ""}`));
      return { result, currentLiveOdds, liveTotal };
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `${activeProvider.label} could not create this code.`);
      return null;
    } finally {
      setCreatingCode(false);
    }
  }

  const activeProvider = providerAdapters.find((item) => item.id === provider) ?? providerAdapters[0];

  return <main className="build-app compact-betting-app">
    <ProductNavigation active={activeArea} slipCount={picks.length} />
    {activeArea === "home" ? <section className="home-code-converter" id="code-converter">
      <header><div><span>Open code converter</span><h1>Convert any booking code</h1></div><p>Choose the original bookmaker and the bookmaker you want. OddsAura will load, match and verify every selection before creating the new code.</p></header>
      <ConverterForm embedded />
    </section> : null}
    <section className="build-hero compact-hero"><div><span>Smart Bet Router</span><h1>Build for your bookmaker</h1></div><div className="build-live-state"><i /> Predictions updated</div></section>
    <section className="build-layout">
      <div className="build-board">
        <div className="build-toolbar"><div><h2>Matches</h2><span>{loading ? "Loading…" : `${fixtureGroups.length} available`}</span></div><input value={search} onChange={(event) => { setSearch(event.target.value); setVisibleFixtures(60); }} placeholder="Search team or league" aria-label="Search predicted games" /></div>
        <div className="build-tier-tabs" aria-label="Prediction risk"><button type="button" className={tier === "ALL" ? "active" : ""} onClick={() => { setTier("ALL"); setVisibleFixtures(60); }}>All <b>{tierCounts.ALL}</b></button><button type="button" className={tier === "SAFE" ? "active" : ""} onClick={() => { setTier("SAFE"); setVisibleFixtures(60); }}>Safe <b>{tierCounts.SAFE}</b></button><button type="button" className={tier === "BALANCED" ? "active" : ""} onClick={() => { setTier("BALANCED"); setVisibleFixtures(60); }}>Balanced <b>{tierCounts.BALANCED}</b></button><button type="button" className={tier === "HIGH_RISK" ? "active" : ""} onClick={() => { setTier("HIGH_RISK"); setVisibleFixtures(60); }}>High risk <b>{tierCounts.HIGH_RISK}</b></button></div>
        <div className="build-mode-tabs" aria-label="Builder mode"><button type="button" className={buildMode === "target" ? "active" : ""} onClick={() => { setBuildMode("target"); setBuiltTarget(null); }}>Build My Odds <small>Reach your requested total</small></button><button type="button" className={buildMode === "recommended" ? "active" : ""} onClick={() => { setBuildMode("recommended"); setBuiltTarget(null); }}>Best Bet <small>Strict evidence only</small></button></div>
        <div className="build-tools"><label><span>Bookmaker</span><select value={provider} onChange={(event) => { const next = event.target.value as ProviderId; const label = providerAdapters.find((item) => item.id === next)?.label; const unsupported = picks.filter((pick) => !providerSupportsMarket(next, pick.market.key)).length; setProvider(next); setSportyCode(null); setLiveOdds({}); setBuiltTarget(null); setNotice(unsupported ? `${unsupported} selected market${unsupported === 1 ? " is" : "s are"} unsupported by ${label}. Your selections were preserved; change them before generating a code.` : `All selected markets are supported by ${label}.`); }}>{providerAdapters.filter((item) => item.id !== "draftkings").map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label><span>Target odds</span><input type="number" inputMode="decimal" min="1.2" max="100" step="0.1" value={targetOdds} onChange={(event) => setTargetOdds(event.target.value)} aria-label="Target total odds" /></label><button type="button" disabled={loading || creatingCode} onClick={() => void buildToTarget()}>{creatingCode ? `Checking ${activeProvider.label}…` : buildMode === "recommended" ? "Find Best Bet" : `Build for ${activeProvider.label}`}</button><div className="build-target-presets" aria-label="Popular target odds">{[2, 5, 10, 20, 50].map((value) => <button type="button" key={value} className={Number(targetOdds) === value ? "active" : ""} onClick={() => setTargetOdds(String(value))}>{value}</button>)}</div></div>
        <div className="build-filter-toggle build-filter-label"><b>Leagues</b><span>{LEAGUE_FILTERS.find((item) => item.id === league)?.label}</span></div>
        <div className="build-league-tabs open" aria-label="League filter">{LEAGUE_FILTERS.map((item) => <button type="button" key={item.id} className={league === item.id ? "active" : ""} onClick={() => { setLeague(item.id); setVisibleFixtures(60); }}>{item.label}</button>)}</div>
        <div className="build-fixtures">{visibleFixtureGroups.map((group) => <article id={`fixture-${encodeURIComponent(group.fixtureId)}`} key={group.fixtureId} className="build-fixture">
          <div className="build-match build-predicted-match"><div><TeamBadge team={group.homeTeam} /><strong>{group.homeTeam.name}</strong><span>vs</span><TeamBadge team={group.awayTeam} /><strong>{group.awayTeam.name}</strong></div><small>{group.league.name} · {new Date(group.kickoff).toLocaleString()}</small></div>
          <div className="build-markets build-predictions">{group.predictions.map((pick) => { const active = picks.some((item) => item.id === pick.id); const price = priceFor(pick); return <button className={active ? "active" : ""} type="button" key={pick.id} onClick={() => choose(pick)}><span>{pick.market.name}</span><b>{pick.selection}</b><strong>{pick.quotedOdds == null && !liveOdds[pick.fixtureId] ? "EST. " : ""}{price?.toFixed(2) ?? pick.fairOdds.toFixed(2)}</strong><small>{liveOdds[pick.fixtureId] ? `${activeProvider.label} live` : pick.quotedOdds ? "Last quoted · verify" : "Model estimate · verify"}</small></button>; })}</div>
        </article>)}{visibleFixtureGroups.length < fixtureGroups.length ? <button className="build-load-more" type="button" onClick={() => setVisibleFixtures((count) => count + 60)}>Show 60 more matches</button> : null}{!loading && !fixtureGroups.length && <div className="build-no-data">No model-approved selections match this filter yet. Try All predictions or another team.</div>}</div>
      </div>
      <aside className={`build-slip ${slipOpen ? "open" : ""}`} id="my-slip" aria-label="Betslip">
        <div className="build-slip-title"><div><span>Betslip</span><h2>{picks.length} {picks.length === 1 ? "selection" : "selections"}</h2></div><div>{picks.length > 0 && <button type="button" onClick={() => { setPicks([]); setSportyCode(null); setLiveOdds({}); }}>Clear</button>}<button className="build-slip-close" type="button" onClick={() => setSlipOpen(false)}>×</button></div></div>
        <div className="build-picks">{picks.map((pick) => <div key={pick.fixtureId}><button type="button" aria-label={`Remove ${pick.homeTeam.name} versus ${pick.awayTeam.name}`} onClick={() => removePick(pick.fixtureId)}>×</button><span>{pick.homeTeam.name} vs {pick.awayTeam.name}</span><strong>{pick.market.name}: {pick.selection}</strong><b>{priceFor(pick)?.toFixed(2) ?? "Pending"} <small>{liveOdds[pick.fixtureId] ? "LIVE" : ""}</small></b><a href={`#fixture-${encodeURIComponent(pick.fixtureId)}`} onClick={() => setSlipOpen(false)}>Change</a></div>)}{!picks.length && <p>No selections</p>}</div>
        <div className="build-total"><span>{totalOdds ? allPricesLive ? `${activeProvider.label} live total` : livePriceCount ? `Mixed total · ${livePriceCount}/${picks.length} live` : builtTarget ? `${builtTarget.exact ? "Target" : "Closest"} ${builtTarget.requested.toFixed(2)} · ${builtTarget.legs} legs · ${builtTarget.risk.toLowerCase()} risk${builtTarget.estimatedPrices ? ` · ${builtTarget.estimatedPrices} estimated` : ""}` : "Estimated total · verify before betting" : "Bookmaker prices"}</span><strong>{totalOdds?.toFixed(2) ?? "Pending"}</strong></div>
        {weakestPick ? <div className="slip-doctor"><div><span>Slip Doctor</span><b>{weakestPick.homeTeam.shortName || weakestPick.homeTeam.name} vs {weakestPick.awayTeam.shortName || weakestPick.awayTeam.name}</b><small>{doctorNotice || (weakestPick.dataQuality === "LOW" ? "Limited match history" : `${Math.round(weakestPick.confidence * 100)}% confidence · weakest leg`)}</small></div><button type="button" onClick={replaceWeakest}>Replace</button></div> : null}
        <div className="build-provider-list" aria-label="Choose bookmaker">{providerAdapters.filter((item) => item.id !== "draftkings").map((item) => <button type="button" key={item.id} className={provider === item.id ? "active" : ""} onClick={() => { const unsupported = picks.filter((pick) => !providerSupportsMarket(item.id, pick.market.key)).length; setProvider(item.id); setSportyCode(null); setLiveOdds({}); setNotice(unsupported ? `${unsupported} selected market${unsupported === 1 ? " is" : "s are"} unsupported by ${item.label}. Nothing was removed.` : ""); }}>{item.label}<small>{item.status === "live" ? "Live" : "Assisted load"}</small></button>)}<a href="/dashboard#code-converter">Convert a code ↗</a></div>
        {unsupportedPicks.length ? <p className="build-notice">{unsupportedPicks.length} selection{unsupportedPicks.length === 1 ? "" : "s"} cannot be translated safely for {activeProvider.label}. Change the marked market before generating a code; OddsAura will not remove it silently.</p> : null}
        {activeProvider.status !== "live" ? <><div className="build-one-xbet"><button type="button" disabled={!picks.length} onClick={() => void copyText(selectionsText, "Selections copied")}>Copy selection list</button><a className="build-code" href={activeProvider.deepLink} target="_blank" rel="noreferrer">Open {activeProvider.label} — rebuild manually <span>↗</span></a></div><p className="build-notice">This bookmaker does not expose a verified code-creation connection yet.</p></> : <button className="build-code" type="button" disabled={!picks.length || creatingCode || unsupportedPicks.length > 0} onClick={() => void requestCode()}>{creatingCode ? "Checking live odds…" : sportyCode ? "Recheck code and odds" : "Generate code"} <span>→</span></button>}
        {sportyCode && <div className="build-real-code"><span>{activeProvider.label} code</span><strong>{sportyCode.code}</strong><div><button type="button" onClick={() => void copyText(sportyCode.code, "Code copied")}>{copied === "Code copied" ? "Copied ✓" : "Copy code"}</button><a href={sportyCode.deepLink} target="_blank" rel="noreferrer">Open {activeProvider.label} ↗</a></div></div>}
        {sportyCode?.unmatched.length ? <div className="build-unmatched"><strong>Code not accepted</strong>{sportyCode.unmatched.map((item) => <div key={item.fixtureId}><span>{item.homeTeam} vs {item.awayTeam}</span><small>{item.reason}</small></div>)}</div> : null}
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
