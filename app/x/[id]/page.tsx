"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Brand from "../../brand";
import "./x-result.css";

type Missing = { homeTeam?: string; awayTeam?: string; eventName?: string; marketName?: string; market?: string; selection?: string; reason?: string };
type Item = { sourceCode: string; label?: string | null; status: "READY" | "FAILED"; error?: string | null; result?: { code?: string; deepLink?: string; unmatched?: Missing[]; sourceIssues?: Missing[] } };
type Result = { sourceProvider: string; destinationProvider: string; sourceCodes: string[]; items: Item[]; missing: string[]; createdAt: number };

const labels: Record<string, string> = { sportybet: "SportyBet", betpawa: "betPawa", bet9ja: "Bet9ja", betking: "BetKing", betway: "Betway" };

function missingText(item: Missing) {
  const game = item.homeTeam && item.awayTeam ? `${item.homeTeam} vs ${item.awayTeam}` : item.eventName || "Selection";
  const market = item.marketName || item.market;
  return `${game}${market ? ` · ${market}` : ""}${item.selection ? ` · ${item.selection}` : ""}`;
}

export default function XConversionResultPage() {
  const params = useParams<{ id: string }>(); const [result, setResult] = useState<Result | null>(null); const [error, setError] = useState("");
  useEffect(() => { let live = true; fetch(`/api/public/x-results/${encodeURIComponent(params.id)}`, { cache: "no-store" }).then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Result not found."); if (live) setResult(payload); }).catch((reason) => { if (live) setError(reason instanceof Error ? reason.message : "Result not found."); }); return () => { live = false; }; }, [params.id]);

  return <main className="x-result-page">
    <header><Brand /><Link href="/convert">Convert another code</Link></header>
    <section className="x-result-hero"><span>OddsAura conversion report</span><h1>{result ? `${labels[result.sourceProvider] ?? result.sourceProvider} → ${labels[result.destinationProvider] ?? result.destinationProvider}` : "Booking-code result"}</h1><p>Every successful code and every selection that could not be transferred is shown below.</p></section>
    {error ? <section className="x-result-error"><h2>Result unavailable</h2><p>{error}</p></section> : null}
    {!result && !error ? <section className="x-result-loading">Loading conversion result…</section> : null}
    {result ? <section className="x-result-list">{result.items.map((item) => {
      const missing = [...(item.result?.unmatched ?? []), ...(item.result?.sourceIssues ?? [])];
      return <article key={item.sourceCode} className={item.status === "READY" ? "ready" : "failed"}><header><div><span>{item.label || "Source code"}</span><b>{item.sourceCode}</b></div><em>{item.status}</em></header>{item.result?.code ? <div className="x-result-code"><span>Converted code</span><strong>{item.result.code}</strong>{item.result.deepLink ? <a href={item.result.deepLink} target="_blank" rel="noreferrer">Open bookmaker ↗</a> : null}</div> : <p className="x-result-failure">{item.error || "This code could not be converted."}</p>}{missing.length ? <details open><summary>{missing.length} selection{missing.length === 1 ? "" : "s"} not converted</summary>{missing.map((selection, index) => <div key={`${item.sourceCode}-${index}`}><b>{missingText(selection)}</b><small>{selection.reason || "The destination bookmaker did not offer a safe matching selection."}</small></div>)}</details> : item.status === "READY" ? <p className="x-result-complete">All available selections were transferred.</p> : null}</article>;
    })}</section> : null}
    <footer>Always open and verify each bookmaker slip before betting. Odds and markets can change. 18+</footer>
  </main>;
}
