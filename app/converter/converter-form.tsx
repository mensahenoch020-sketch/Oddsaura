"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Provider = "sportybet" | "betpawa" | "bet9ja" | "betking" | "betway";
type ConversionIssue = { eventName?: string; marketName?: string; outcomeName?: string; reason?: string };
type Unmatched = { fixtureId?: string; homeTeam: string; awayTeam: string; reason: string };
type SourceSelection = { fixtureId: string; homeTeam: string; awayTeam: string; kickoff: string; marketName: string; selection: string; line?: number | null };
type ConversionStage = "INPUT" | "IMPORT" | "TRANSLATE" | "MATCH" | "CREATE" | "VERIFY";
type Result = { verified?: boolean; verificationStatus?: "VERIFIED" | "UNVERIFIED" | "MISMATCH"; warning?: string; code: string; deepLink: string; decoded: number; partial?: boolean; resolved?: unknown[]; unmatched?: Unmatched[]; sourceIssues?: ConversionIssue[]; importedFrom?: string; conversionStage?: ConversionStage };
type ProviderHealth = { provider: Provider; status: "AVAILABLE" | "DEGRADED" | "UNTESTED" | "ASSISTED"; stage: "IMPORT" | "CREATE" | null; checkedAt: string | null; message: string };
const stageLabels: Record<ConversionStage, string> = { INPUT: "Request check", IMPORT: "Source import", TRANSLATE: "Market translation", MATCH: "Destination matching", CREATE: "Code creation", VERIFY: "Code verification" };

async function loadProviderHealth() {
  const response = await fetch("/api/providers/health", { cache: "no-store" }).catch(() => null);
  if (!response?.ok) return [] as ProviderHealth[];
  const payload = await response.json() as { providers?: ProviderHealth[] };
  return payload.providers ?? [];
}

const providers: Array<{ id: Provider; label: string; input: string; output: string; note: string; link: string }> = [
  { id: "sportybet", label: "SportyBet", input: "Public code import", output: "Automatic", note: "Loads and recreates verified selections.", link: "https://www.sportybet.com/ng/" },
  { id: "betpawa", label: "betPawa", input: "Public code import", output: "Automatic", note: "Loads booking numbers and creates a new code.", link: "https://www.betpawa.ng/" },
  { id: "bet9ja", label: "Bet9ja", input: "Import may be blocked", output: "Manual transfer", note: "Bet9ja currently rejects some third-party code imports and code-creation requests.", link: "https://sports.bet9ja.com/mobile/bookabet" },
  { id: "betking", label: "BetKing", input: "Public code import", output: "Automatic", note: "Loads and verifies the rebuilt coupon.", link: "https://m.betking.com/en-ng/sports" },
  { id: "betway", label: "Betway", input: "Public code import", output: "Automatic", note: "Loads, creates and reload-verifies Betway BookABet codes.", link: "https://www.betway.com.ng/book-a-bet" },
];

export default function ConverterForm({ embedded = false }: { embedded?: boolean }) {
  const [source, setSource] = useState<Provider>("sportybet");
  const [destination, setDestination] = useState<Provider>("betpawa");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [issues, setIssues] = useState<ConversionIssue[]>([]);
  const [transferSelections, setTransferSelections] = useState<SourceSelection[]>([]);
  const [copied, setCopied] = useState(false);
  const [failureStage, setFailureStage] = useState<ConversionStage | null>(null);
  const [health, setHealth] = useState<ProviderHealth[]>([]);
  const sourceMeta = useMemo(() => providers.find((item) => item.id === source)!, [source]);
  const destinationMeta = useMemo(() => providers.find((item) => item.id === destination)!, [destination]);
  const convertedCount = result?.resolved?.length ?? Math.max(0, (result?.decoded ?? 0) - (result?.unmatched?.length ?? 0));
  const originalCount = (result?.decoded ?? 0) + (result?.sourceIssues?.length ?? 0);

  useEffect(() => {
    let active = true;
    loadProviderHealth().then((rows) => { if (active) setHealth(rows); });
    return () => { active = false; };
  }, []);

  async function refreshHealth() { setHealth(await loadProviderHealth()); }

  function resetFeedback() { setResult(null); setMessage(""); setIssues([]); setTransferSelections([]); setCopied(false); setFailureStage(null); }
  function swap() { setSource(destination); setDestination(source); resetFeedback(); }

  async function runConversion() {
    setBusy(true); resetFeedback();
    try {
      const response = await fetch("/api/providers/convert", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceProvider: source, destinationProvider: destination, code: code.trim(), allowPartial: true }) });
      const text = await response.text();
      let payload: Result & { error?: string; details?: { stage?: ConversionStage; skippedSelections?: ConversionIssue[]; sourceSelections?: SourceSelection[]; unmatched?: Unmatched[]; fixtureId?: string } };
      try { payload = JSON.parse(text) as typeof payload; }
      catch { throw new Error("The bookmaker connection returned an unreadable response. Please retry shortly."); }
      if (!response.ok || !payload.code) {
        setFailureStage(payload.details?.stage ?? null);
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
    finally { setBusy(false); void refreshHealth(); }
  }

  function convert(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void runConversion(); }
  async function copyCode() { if (result?.code) { await navigator.clipboard.writeText(result.code); setCopied(true); } }
  async function copyTransfer() {
    const value = transferSelections.map((item, index) => `${index + 1}. ${item.homeTeam} vs ${item.awayTeam}\n${item.marketName}: ${item.selection}${item.line == null ? "" : ` (${item.line})`}\n${new Date(item.kickoff).toLocaleString()}`).join("\n\n");
    await navigator.clipboard.writeText(value); setCopied(true);
  }

  return <>
    <section className={`converter-workspace${embedded ? " converter-workspace-embedded" : ""}`}>
      <form onSubmit={convert}>
        <div className="converter-route">
          <label><span>From</span><select disabled={busy} value={source} onChange={(event) => { setSource(event.target.value as Provider); resetFeedback(); }}>{providers.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select><small>{sourceMeta.input}</small></label>
          <button type="button" disabled={busy} className="converter-swap" onClick={swap} aria-label="Swap source and destination">⇄</button>
          <label><span>To</span><select disabled={busy} value={destination} onChange={(event) => { setDestination(event.target.value as Provider); resetFeedback(); }}>{providers.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select><small>{destinationMeta.output}</small></label>
        </div>
        <label className="converter-code"><span>{sourceMeta.label} code</span><input disabled={busy} value={code} onChange={(event) => { setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16)); resetFeedback(); }} placeholder="Enter booking code" minLength={4} maxLength={16} required autoCapitalize="characters" /></label>
        <button className="converter-submit" disabled={busy || source === destination}>{source === destination ? "Choose a different bookmaker" : busy ? "Loading and matching…" : `Convert to ${destinationMeta.label}`}</button>
        {message ? <p className={`converter-message${result?.partial ? " partial" : result?.verified ? " success" : ""}`} role="status">{failureStage ? <strong>{stageLabels[failureStage]} · </strong> : null}{message}</p> : null}
        {result ? <section className={`converter-result converter-result-inline${result.partial ? " partial" : ""}`} aria-live="polite"><div><span>{result.partial ? `Partial ${destinationMeta.label} code` : `Your ${destinationMeta.label} code`}</span><strong>{result.code}</strong><small>{result.partial ? `${convertedCount} of ${originalCount} selections converted` : result.verified ? `${result.resolved?.length ?? result.decoded} selections verified` : result.verificationStatus === "MISMATCH" ? "Selection mismatch—do not use unchecked" : "Created—verification incomplete"}</small></div><div><button type="button" onClick={() => void copyCode()}>{copied ? "Copied ✓" : "Copy code"}</button><a href={result.deepLink} target="_blank" rel="noreferrer">Open {destinationMeta.label} ↗</a></div>{result.unmatched?.length ? <details open><summary>{result.unmatched.length} destination selections not included</summary>{result.unmatched.map((item, index) => <p key={`${item.fixtureId}-${index}`}><b>{item.homeTeam} vs {item.awayTeam}</b><span>{item.reason}</span></p>)}</details> : null}</section> : null}
        {issues.length ? <div className="converter-issues"><strong>{issues.length} source selection{issues.length === 1 ? "" : "s"} could not be read from the original code</strong>{issues.slice(0, 12).map((issue, index) => <p key={`${issue.eventName}-${index}`}><b>{issue.eventName}</b><span>{issue.marketName}: {issue.outcomeName} · {issue.reason}</span></p>)}</div> : null}
        {destination === "bet9ja" && transferSelections.length ? <section className="converter-transfer"><header><div><span>Manual Bet9ja transfer</span><strong>{transferSelections.length} readable selections listed</strong><small>Bet9ja does not allow this page to fill another browser tab automatically. Copy the list and select each match on Bet9ja.</small></div><div><button type="button" onClick={() => void copyTransfer()}>{copied ? "Copied ✓" : "Copy listed selections"}</button><a href={destinationMeta.link} target="_blank" rel="noreferrer">Open Bet9ja ↗</a></div></header>{transferSelections.map((item, index) => <div key={`${item.fixtureId}-${index}`}><b>{index + 1}. {item.homeTeam} vs {item.awayTeam}</b><span>{item.marketName}: {item.selection}</span><small>{new Date(item.kickoff).toLocaleString()}</small></div>)}</section> : null}
      </form>
      {!embedded ? <aside><span>How it works</span><ol><li>Loads the source bookmaker code.</li><li>Translates markets and finds the same matches.</li><li>Uses the destination&apos;s current odds.</li><li>Creates and reload-verifies the new code.</li></ol><p>When some selections are unavailable, OddsAura creates a clearly labelled partial code from the selections it matched and lists everything it left out.</p></aside> : null}
    </section>
    {!embedded ? <section className="converter-support"><header><span>Connection capability</span><h2>Bookmaker adapters</h2><p>Status reflects the most recent real import or code-creation attempt on this server. Untested does not mean unavailable.</p></header><div>{providers.map((item) => { const observed = health.find((row) => row.provider === item.id); const status = observed?.status ?? (item.id === "bet9ja" ? "ASSISTED" : "UNTESTED"); return <article key={item.id}><div><strong>{item.label}</strong><span className={status === "AVAILABLE" ? "live" : "limited"}>{status === "AVAILABLE" ? "Available" : status === "DEGRADED" ? "Latest attempt failed" : status === "ASSISTED" ? "Assisted" : "Not tested yet"}</span></div><p>{observed?.message ?? item.note}</p>{observed?.checkedAt ? <small>Checked {new Date(observed.checkedAt).toLocaleString()}</small> : null}<a href={item.link} target="_blank" rel="noreferrer">Open bookmaker ↗</a></article>; })}</div></section> : null}
  </>;
}
