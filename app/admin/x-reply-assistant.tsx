"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import "./x-reply-assistant.css";

type Provider = "sportybet" | "betpawa" | "bet9ja" | "betking" | "betway";
type ReplyStatus = "READY" | "FAILED" | "POSTED" | "ARCHIVED";
type MissingSelection = { homeTeam?: string; awayTeam?: string; eventName?: string; marketName?: string; market?: string; reason?: string };
type ConversionResult = { code?: string; error?: string; resolved?: unknown[]; unmatched?: MissingSelection[]; sourceIssues?: MissingSelection[] };
type BatchItem = { sourceCode: string; label?: string | null; status: "READY" | "FAILED"; result: ConversionResult; error?: string | null };
type ReplyRequest = { id: string; tweetUrl: string | null; requestText: string; sourceProvider: Provider; destinationProvider: Provider; sourceCode: string; sourceCodes?: Array<{ code: string; label?: string | null }>; responseText: string | null; status: ReplyStatus; resultUrl?: string; conversion?: { batch?: BatchItem[]; successCount?: number; failureCount?: number } | null; createdAt: number; updatedAt: number };
type ResolvedPost = { requestText: string; mediaDetected?: boolean; ocrUsed?: boolean; detected?: { sourceProvider?: Provider | null; destinationProvider?: Provider | null; codes?: Array<{ code: string; label?: string | null }> }; error?: string };

const providers: Array<{ id: Provider; label: string }> = [
  { id: "sportybet", label: "SportyBet" },
  { id: "betpawa", label: "betPawa" },
  { id: "bet9ja", label: "Bet9ja" },
  { id: "betking", label: "BetKing" },
  { id: "betway", label: "Betway" },
];

const ignoredCodes = new Set(["BET9JA", "BETWAY", "BETKING", "BETPAWA", "SPORTY", "SPORTYBET", "ODDSAURA", "CONVERT"]);

function manualCodes(value: string) {
  const output: Array<{ code: string; label: string | null }> = []; const seen = new Set<string>();
  for (const line of value.split(/\r?\n/)) {
    const tokens = line.toUpperCase().match(/\b(?=[A-Z0-9]{4,20}\b)(?=[A-Z0-9]*\d)[A-Z0-9]+\b/g) ?? [];
    for (const code of tokens) {
      if (ignoredCodes.has(code) || seen.has(code)) continue;
      seen.add(code); const odds = line.slice(0, Math.max(0, line.toUpperCase().indexOf(code))).match(/(\d+(?:\.\d+)?)\s*(?:odds?|x)\b/i)?.[1];
      output.push({ code, label: odds ? `${odds} odds` : null });
    }
  }
  return output;
}

function codeLines(codes: Array<{ code: string; label?: string | null }> = []) {
  return codes.map((item) => `${item.label ? `${item.label} - ` : ""}${item.code}`).join("\n");
}

function replyUrl(tweetUrl: string | null, responseText: string) {
  const postId = tweetUrl?.match(/(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d+)/i)?.[1];
  const query = new URLSearchParams({ text: responseText });
  if (postId) query.set("in_reply_to", postId);
  return `https://twitter.com/intent/tweet?${query.toString()}`;
}

function missingLabel(item: MissingSelection) {
  const game = item.homeTeam && item.awayTeam ? `${item.homeTeam} vs ${item.awayTeam}` : item.eventName;
  const market = item.marketName || item.market;
  return game ? `${game}${market ? ` · ${market}` : ""}` : item.reason || "Selection unavailable";
}

export default function XReplyAssistant() {
  const [requestText, setRequestText] = useState(""); const [tweetUrl, setTweetUrl] = useState(""); const [codesText, setCodesText] = useState("");
  const [sourceProvider, setSourceProvider] = useState<Provider>("betway"); const [destinationProvider, setDestinationProvider] = useState<Provider>("sportybet");
  const [requests, setRequests] = useState<ReplyRequest[]>([]); const [active, setActive] = useState<ReplyRequest | null>(null); const [replyText, setReplyText] = useState("");
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false); const [reading, setReading] = useState(false);
  const readyCount = useMemo(() => requests.filter((item) => item.status === "READY").length, [requests]);
  const batch = active?.conversion?.batch ?? [];

  async function loadQueue() { const response = await fetch("/api/admin/x-replies", { cache: "no-store" }); if (!response.ok) return; const payload = await response.json() as { requests?: ReplyRequest[] }; setRequests(payload.requests ?? []); }

  function applyDetected(post: ResolvedPost) {
    setRequestText(post.requestText || "");
    if (post.detected?.sourceProvider) setSourceProvider(post.detected.sourceProvider);
    if (post.detected?.destinationProvider) setDestinationProvider(post.detected.destinationProvider);
    setCodesText(codeLines(post.detected?.codes));
    if (post.detected?.codes?.length) setMessage(`${post.detected.codes.length} booking code${post.detected.codes.length === 1 ? "" : "s"} detected${post.ocrUsed ? " from the attached image" : ""}. Check the route, then convert all.`);
    else setMessage(post.mediaDetected ? "The attached image was found, but its codes could not be read clearly. Paste the code lines in the fallback box." : "No booking code was detected. Paste the code lines in the fallback box.");
  }

  async function readLink(value = tweetUrl) {
    if (!value) { setMessage("Paste the X post link first."); return; }
    setReading(true); setMessage("");
    try {
      const response = await fetch("/api/admin/x-replies/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tweetUrl: value }) });
      const payload = await response.json() as ResolvedPost;
      if (!response.ok) throw new Error(payload.error || "This X post could not be read.");
      applyDetected(payload);
    } catch (error) { setMessage(error instanceof Error ? error.message : "This X post could not be read."); } finally { setReading(false); }
  }

  async function createConversion(options: { sharedUrl?: string; autoDetect?: boolean } = {}) {
    const sharedUrl = options.sharedUrl ?? tweetUrl; const detectedCodes = manualCodes(codesText);
    setBusy(true); setMessage(""); setActive(null); setReplyText("");
    try {
      const response = await fetch("/api/admin/x-replies", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestText: options.sharedUrl ? "" : requestText, tweetUrl: sharedUrl, sourceProvider, destinationProvider, sourceCodes: options.sharedUrl ? [] : detectedCodes, autoDetect: options.autoDetect ?? false }) });
      const payload = await response.json() as { request?: ReplyRequest; error?: string; detected?: ResolvedPost["detected"] };
      if (!response.ok || !payload.request) throw new Error(payload.error || "This request could not be converted.");
      setActive(payload.request); setRequestText(payload.request.requestText); setTweetUrl(payload.request.tweetUrl ?? sharedUrl); setCodesText(codeLines(payload.request.sourceCodes ?? manualCodes(payload.request.sourceCode.replaceAll(",", "\n")))); setSourceProvider(payload.request.sourceProvider); setDestinationProvider(payload.request.destinationProvider); setReplyText(payload.request.responseText ?? "");
      const successes = payload.request.conversion?.successCount ?? 0; const failures = payload.request.conversion?.failureCount ?? 0;
      setMessage(successes ? `${successes} code${successes === 1 ? "" : "s"} converted${failures ? `; ${failures} failed` : ""}. Review the reply, then open X.` : "No code converted. Review the bookmaker errors below.");
      await loadQueue();
      return payload.request;
    } catch (error) { setMessage(error instanceof Error ? error.message : "This request could not be converted."); return null; } finally { setBusy(false); }
  }

  useEffect(() => {
    let activeRequest = true;
    fetch("/api/admin/x-replies", { cache: "no-store" }).then((response) => response.ok ? response.json() : Promise.reject()).then((payload: { requests?: ReplyRequest[] }) => { if (activeRequest) setRequests(payload.requests ?? []); }).catch(() => undefined);
    const params = new URLSearchParams(window.location.search); const sharedText = params.get("text") || ""; const sharedUrl = params.get("x_url") || params.get("url") || sharedText.match(/https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^\s]+/i)?.[0] || null;
    const sharedTimer = sharedUrl && /(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+/i.test(sharedUrl) ? window.setTimeout(() => { void createConversion({ sharedUrl, autoDetect: true }).finally(() => window.history.replaceState({}, "", "/admin#x-replies")); }, 0) : null;
    return () => { activeRequest = false; if (sharedTimer != null) window.clearTimeout(sharedTimer); };
    // The shared-link conversion must run once when the admin page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function convert(event: FormEvent<HTMLFormElement>) { event.preventDefault(); await createConversion({ autoDetect: !requestText.trim() }); }

  function openRequest(item: ReplyRequest) {
    setActive(item); setRequestText(item.requestText); setTweetUrl(item.tweetUrl ?? ""); setSourceProvider(item.sourceProvider); setDestinationProvider(item.destinationProvider); setCodesText(codeLines(item.sourceCodes ?? manualCodes(item.sourceCode.replaceAll(",", "\n")))); setReplyText(item.responseText ?? ""); setMessage("");
  }

  async function updateStatus(status: ReplyStatus) { if (!active) return; const response = await fetch(`/api/admin/x-replies/${encodeURIComponent(active.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status, responseText: replyText }) }); if (!response.ok) { setMessage("The reply status could not be saved."); return; } setActive({ ...active, status, responseText: replyText }); setMessage(status === "POSTED" ? "Reply marked as posted." : "Reply archived."); await loadQueue(); }
  async function copyReply() { if (!replyText) return; await navigator.clipboard.writeText(replyText); setMessage("Reply copied."); }

  return <section id="x-replies" className="xra-shell">
    <div className="adm-section-head"><div><h2>X Reply Assistant</h2><p>Paste one X link. OddsAura reads the request, converts every detected code and prepares one short reply.</p></div><span>{readyCount} ready</span></div>
    <form onSubmit={convert} className="xra-link-form">
      <label><span>X post link</span><div><input type="url" value={tweetUrl} onChange={(event) => setTweetUrl(event.target.value)} placeholder="https://x.com/user/status/…" required={!requestText && !codesText} /><button type="button" onClick={() => void readLink()} disabled={reading || busy}>{reading ? "Reading…" : "Read link"}</button></div></label>
      <small>Public text and image posts are read automatically. If an image is unclear, use the fallback box below.</small>
    </form>
    <div className="xra-grid">
      <form onSubmit={convert} className="xra-form">
        <details open={!codesText}><summary>Fallback or corrections</summary><label><span>Post text <small>optional</small></span><textarea rows={3} value={requestText} onChange={(event) => setRequestText(event.target.value)} placeholder="@OddsAura convert these Betway codes to SportyBet" maxLength={4000} /></label></details>
        <label><span>Detected booking codes</span><textarea rows={5} value={codesText} onChange={(event) => setCodesText(event.target.value.toUpperCase())} placeholder={"10 odds - BW73A28FF6\n10 odds - BW73A3186A\n20 odds - BW73A4E735"} /></label>
        <div className="xra-route"><label><span>From</span><select value={sourceProvider} onChange={(event) => setSourceProvider(event.target.value as Provider)}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></label><b>→</b><label><span>To</span><select value={destinationProvider} onChange={(event) => setDestinationProvider(event.target.value as Provider)}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></label></div>
        <div className="xra-actions"><button className="primary" disabled={busy || reading || sourceProvider === destinationProvider}>{busy ? "Converting all…" : "Convert all and draft reply"}</button></div>
      </form>
      <section className="xra-result"><header><span>Reply draft</span>{active ? <b className={`status-${active.status.toLowerCase()}`}>{active.status}</b> : null}</header>
        {batch.length ? <div className="xra-batch">{batch.map((item) => <article key={item.sourceCode}><div><b>{item.label || item.sourceCode}</b><span className={`status-${item.status.toLowerCase()}`}>{item.status}</span></div>{item.result.code ? <strong>{item.result.code}</strong> : <p>{item.error || item.result.error || "Could not convert this code."}</p>}{[...(item.result.unmatched ?? []), ...(item.result.sourceIssues ?? [])].map((missing, index) => <small key={`${item.sourceCode}-${index}`}>Not converted: {missingLabel(missing)}</small>)}</article>)}</div> : null}
        <textarea rows={8} value={replyText} onChange={(event) => setReplyText(event.target.value.slice(0, 280))} placeholder="The short X reply will appear here." disabled={!active?.responseText} />
        <div className="xra-counter">{replyText.length}/280</div>{message ? <p role="status">{message}</p> : null}<div className="xra-actions"><button type="button" disabled={!replyText} onClick={() => void copyReply()}>Copy reply</button><a className={!replyText ? "disabled" : "primary"} href={replyText ? replyUrl(active?.tweetUrl ?? tweetUrl, replyText) : undefined} target="_blank" rel="noreferrer">Open reply on X ↗</a><button type="button" disabled={!active || active.status === "FAILED"} onClick={() => void updateStatus("POSTED")}>Mark posted</button></div><small>OddsAura does not post automatically. The final X screen lets you check everything before tapping Post.</small></section>
    </div>
    <details className="xra-shortcut"><summary>Set up “Share → OddsAura” on iPhone</summary><ol><li>Create an Apple Shortcut named <b>OddsAura</b> and enable <b>Show in Share Sheet</b> for URLs.</li><li>Add a URL action: <code>https://oddsaura.site/admin?x_url=</code> followed by the Shortcut Input.</li><li>Add <b>Open URLs</b>. When you share an X post to this shortcut, OddsAura reads and converts it immediately.</li></ol></details>
    <div className="xra-queue"><header><strong>Recent requests</strong><button type="button" onClick={() => void loadQueue()}>Refresh</button></header>{requests.slice(0, 12).map((item) => <button type="button" onClick={() => openRequest(item)} key={item.id}><span><b>{item.sourceCode.split(",").length} code{item.sourceCode.includes(",") ? "s" : ""}</b>{providers.find((provider) => provider.id === item.sourceProvider)?.label} → {providers.find((provider) => provider.id === item.destinationProvider)?.label}</span><span className={`status-${item.status.toLowerCase()}`}>{item.status}</span><small>{new Date(item.createdAt).toLocaleString()}</small></button>)}{!requests.length ? <p>No X conversion requests saved yet.</p> : null}</div>
  </section>;
}
