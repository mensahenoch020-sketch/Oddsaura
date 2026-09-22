"use client";

import { FormEvent, useMemo, useState } from "react";

type Provider = "sportybet" | "betpawa" | "bet9ja" | "betking" | "betway";
type ConversionIssue = { eventName?: string; marketName?: string; outcomeName?: string; reason?: string };
type Unmatched = { fixtureId?: string; homeTeam: string; awayTeam: string; reason: string };
type SourceSelection = { fixtureId: string; homeTeam: string; awayTeam: string; kickoff: string; marketName: string; selection: string; line?: number | null };
type ConversionStage = "INPUT" | "IMPORT" | "TRANSLATE" | "MATCH" | "CREATE" | "VERIFY";
type ResolvedSelection = { odds?: number | null };
type Result = { verified?: boolean; verificationStatus?: "VERIFIED" | "UNVERIFIED" | "MISMATCH"; warning?: string; code: string; deepLink: string; decoded: number; partial?: boolean; resolved?: ResolvedSelection[]; unmatched?: Unmatched[]; sourceIssues?: ConversionIssue[]; importedFrom?: string; conversionStage?: ConversionStage };
const providers: Array<{ id: Provider; label: string; link: string }> = [
  { id: "sportybet", label: "SportyBet", link: "https://www.sportybet.com/ng/" },
  { id: "betpawa", label: "betPawa", link: "https://www.betpawa.ng/" },
  { id: "bet9ja", label: "Bet9ja", link: "https://sports.bet9ja.com/mobile/bookabet" },
  { id: "betking", label: "BetKing", link: "https://m.betking.com/en-ng/sports" },
  { id: "betway", label: "Betway", link: "https://www.betway.com.ng/book-a-bet" },
];

export default function ConverterForm({ embedded = false, publicMode = false, xHandle = "" }: { embedded?: boolean; publicMode?: boolean; xHandle?: string }) {
  const [source, setSource] = useState<Provider>("sportybet");
  const [destination, setDestination] = useState<Provider>("betpawa");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [issues, setIssues] = useState<ConversionIssue[]>([]);
  const [transferSelections, setTransferSelections] = useState<SourceSelection[]>([]);
  const [copied, setCopied] = useState(false);
  const sourceMeta = useMemo(() => providers.find((item) => item.id === source)!, [source]);
  const destinationMeta = useMemo(() => providers.find((item) => item.id === destination)!, [destination]);
  const convertedCount = result?.resolved?.length ?? Math.max(0, (result?.decoded ?? 0) - (result?.unmatched?.length ?? 0));
  const originalCount = (result?.decoded ?? 0) + (result?.sourceIssues?.length ?? 0);
  const convertedOdds = result?.resolved?.reduce((total, item) => Number.isFinite(item.odds) ? total * Number(item.odds) : total, 1) ?? 1;

  function resetFeedback() { setResult(null); setMessage(""); setIssues([]); setTransferSelections([]); setCopied(false); }
  function swap() { setSource(destination); setDestination(source); resetFeedback(); }

  async function runConversion() {
    setBusy(true); resetFeedback();
    try {
      const response = await fetch(publicMode ? "/api/public/convert" : "/api/providers/convert", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceProvider: source, destinationProvider: destination, code: code.trim(), allowPartial: true, website: "" }) });
      const text = await response.text();
      let payload: Result & { error?: string; details?: { stage?: ConversionStage; skippedSelections?: ConversionIssue[]; sourceSelections?: SourceSelection[]; unmatched?: Unmatched[]; fixtureId?: string } };
      try { payload = JSON.parse(text) as typeof payload; }
      catch { throw new Error("The bookmaker connection returned an unreadable response. Please retry shortly."); }
      if (!response.ok || !payload.code) {
        setIssues(payload.details?.skippedSelections ?? []);
        setTransferSelections(payload.details?.sourceSelections ?? []);
        throw new Error(payload.error || "This code could not be converted.");
      }
      setResult(payload); setIssues(payload.sourceIssues ?? []);
      const included = payload.resolved?.length ?? Math.max(0, payload.decoded - (payload.unmatched?.length ?? 0));
      const total = payload.decoded + (payload.sourceIssues?.length ?? 0);
      setMessage(payload.partial
        ? `Partial code created: ${included} of ${total} selections converted. Review the selections not included below.${payload.warning ? ` ${payload.warning}` : ""}`
        : payload.warning || (payload.verified ? "Every selection was converted and the new code was reload-verified." : "Code created—verification incomplete. Check every selection on the bookmaker."));
    } catch (error) { setMessage(error instanceof Error ? error.message : "This code could not be converted."); }
    finally { setBusy(false); }
  }

  function convert(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void runConversion(); }
  async function copyCode() { if (result?.code) { await navigator.clipboard.writeText(result.code); setCopied(true); } }
  async function copyTransfer() {
    const value = transferSelections.map((item, index) => `${index + 1}. ${item.homeTeam} vs ${item.awayTeam}\n${item.marketName}: ${item.selection}${item.line == null ? "" : ` (${item.line})`}\n${new Date(item.kickoff).toLocaleString()}`).join("\n\n");
    await navigator.clipboard.writeText(value); setCopied(true);
  }
  function shareOnX() {
    if (!result) return;
    const handle = xHandle.trim().replace(/^@/, "");
    const tag = handle ? ` @${handle}` : "";
    const included = result.resolved?.length ?? convertedCount;
    const total = originalCount || included;
    const unavailable = Math.max(0, total - included);
    const odds = convertedOdds > 1 ? ` · ${convertedOdds.toFixed(2)} odds` : "";
    const text = [`Converted ${sourceMeta.label} ➡️ ${destinationMeta.label}${tag}`, `${included}/${total} selections matched${odds}`, `Code: ${result.code}`, unavailable ? `${unavailable} selection${unavailable === 1 ? "" : "s"} unavailable on ${destinationMeta.label}` : "Verified by OddsAura ✅"].join("\n");
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  return <>
    <section className={`converter-workspace${embedded ? " converter-workspace-embedded" : ""}`}>
      <form onSubmit={convert}>
        <div className="converter-route">
          <label><span>From</span><select disabled={busy} value={source} onChange={(event) => { setSource(event.target.value as Provider); resetFeedback(); }}>{providers.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
          <button type="button" disabled={busy} className="converter-swap" onClick={swap} aria-label="Swap source and destination">⇄</button>
          <label><span>To</span><select disabled={busy} value={destination} onChange={(event) => { setDestination(event.target.value as Provider); resetFeedback(); }}>{providers.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
        </div>
        <label className="converter-code"><span>{sourceMeta.label} code</span><input disabled={busy} value={code} onChange={(event) => { setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16)); resetFeedback(); }} placeholder="Enter booking code" minLength={4} maxLength={16} required autoCapitalize="characters" /></label>
        <button className="converter-submit" disabled={busy || source === destination}>{source === destination ? "Choose a different bookmaker" : busy ? "Loading and matching…" : `Convert to ${destinationMeta.label}`}</button>
        {message ? <p className={`converter-message${result?.partial ? " partial" : result?.verified ? " success" : ""}`} role="status">{message}</p> : null}
        {result ? <section className={`converter-result converter-result-inline${result.partial ? " partial" : ""}`} aria-live="polite"><div><span>{result.partial ? `Partial ${destinationMeta.label} code` : `Your ${destinationMeta.label} code`}</span><strong>{result.code}</strong><small>{result.partial ? `${convertedCount} of ${originalCount} selections converted` : result.verified ? `${result.resolved?.length ?? result.decoded} selections verified` : result.verificationStatus === "MISMATCH" ? "Selection mismatch—do not use unchecked" : "Created—verification incomplete"}</small></div><div><button type="button" onClick={() => void copyCode()}>{copied ? "Copied ✓" : "Copy code"}</button><a href={result.deepLink} target="_blank" rel="noreferrer">Open {destinationMeta.label} ↗</a>{publicMode ? <button type="button" className="converter-share-x" onClick={shareOnX}>Share on X</button> : null}</div>{result.unmatched?.length ? <details open><summary>{result.unmatched.length} destination selections not included</summary>{result.unmatched.map((item, index) => <p key={`${item.fixtureId}-${index}`}><b>{item.homeTeam} vs {item.awayTeam}</b><span>{item.reason}</span></p>)}</details> : null}</section> : null}
        {issues.length ? <div className="converter-issues"><strong>{issues.length} source selection{issues.length === 1 ? "" : "s"} could not be read from the original code</strong>{issues.slice(0, 12).map((issue, index) => <p key={`${issue.eventName}-${index}`}><b>{issue.eventName}</b><span>{issue.marketName}: {issue.outcomeName} · {issue.reason}</span></p>)}</div> : null}
        {destination === "bet9ja" && transferSelections.length ? <section className="converter-transfer"><header><div><span>Available selections</span><strong>{transferSelections.length} selections are ready to copy</strong><small>Bet9ja did not create the code, so OddsAura kept the readable selections for you.</small></div><div><button type="button" onClick={() => void copyTransfer()}>{copied ? "Copied ✓" : "Copy selections"}</button><a href={destinationMeta.link} target="_blank" rel="noreferrer">Open Bet9ja ↗</a></div></header>{transferSelections.map((item, index) => <div key={`${item.fixtureId}-${index}`}><b>{index + 1}. {item.homeTeam} vs {item.awayTeam}</b><span>{item.marketName}: {item.selection}</span><small>{new Date(item.kickoff).toLocaleString()}</small></div>)}</section> : null}
      </form>
    </section>
  </>;
}
