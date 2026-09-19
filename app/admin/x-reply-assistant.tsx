"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import "./x-reply-assistant.css";

type Provider = "sportybet" | "betpawa" | "bet9ja" | "betking" | "betway";
type ReplyStatus = "READY" | "FAILED" | "POSTED" | "ARCHIVED";
type ReplyRequest = { id: string; tweetUrl: string | null; requestText: string; sourceProvider: Provider; destinationProvider: Provider; sourceCode: string; responseText: string | null; status: ReplyStatus; conversion?: { code?: string; error?: string; resolved?: unknown[]; unmatched?: unknown[] } | null; createdAt: number; updatedAt: number };

const providers: Array<{ id: Provider; label: string; matcher: RegExp }> = [
  { id: "sportybet", label: "SportyBet", matcher: /\b(?:sporty ?bet|sporting ?bet|sporty)\b/i },
  { id: "betpawa", label: "betPawa", matcher: /\bbet ?pawa\b/i },
  { id: "bet9ja", label: "Bet9ja", matcher: /\bbet ?9ja\b/i },
  { id: "betking", label: "BetKing", matcher: /\bbet ?king\b/i },
  { id: "betway", label: "Betway", matcher: /\bbet ?way\b/i },
];

function detectRequest(text: string) {
  const upper = text.toUpperCase();
  const code = (upper.match(/\b(?=[A-Z0-9]{4,16}\b)(?=[A-Z0-9]*\d)[A-Z0-9]+\b/g) ?? []).find((token) => !/^(?:BET9JA|BETWAY|BETKING|BETPAWA|SPORTYBET)$/.test(token)) ?? "";
  const mentioned = providers.filter((provider) => provider.matcher.test(text)).map((provider) => provider.id);
  const destination = providers.find((provider) => new RegExp(`\\b(?:to|into|for)\\s+${provider.matcher.source}`, "i").test(text))?.id ?? (mentioned.length > 1 ? mentioned.at(-1) : undefined);
  const source = providers.find((provider) => new RegExp(`\\bfrom\\s+${provider.matcher.source}`, "i").test(text))?.id ?? mentioned.find((provider) => provider !== destination) ?? (code.startsWith("BW") ? "betway" : undefined);
  return { code, source, destination };
}

function replyUrl(tweetUrl: string | null, responseText: string) {
  const postId = tweetUrl?.match(/(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d+)/i)?.[1];
  const query = new URLSearchParams({ text: responseText });
  if (postId) query.set("in_reply_to", postId);
  return `https://twitter.com/intent/tweet?${query.toString()}`;
}

export default function XReplyAssistant() {
  const [requestText, setRequestText] = useState(""); const [tweetUrl, setTweetUrl] = useState("");
  const [sourceProvider, setSourceProvider] = useState<Provider>("betway"); const [destinationProvider, setDestinationProvider] = useState<Provider>("sportybet"); const [sourceCode, setSourceCode] = useState("");
  const [requests, setRequests] = useState<ReplyRequest[]>([]); const [active, setActive] = useState<ReplyRequest | null>(null); const [replyText, setReplyText] = useState("");
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const readyCount = useMemo(() => requests.filter((item) => item.status === "READY").length, [requests]);

  async function loadQueue() { const response = await fetch("/api/admin/x-replies", { cache: "no-store" }); if (!response.ok) return; const payload = await response.json() as { requests?: ReplyRequest[] }; setRequests(payload.requests ?? []); }
  useEffect(() => { let activeRequest = true; fetch("/api/admin/x-replies", { cache: "no-store" }).then((response) => response.ok ? response.json() : Promise.reject()).then((payload: { requests?: ReplyRequest[] }) => { if (activeRequest) setRequests(payload.requests ?? []); }).catch(() => undefined); return () => { activeRequest = false; }; }, []);

  function detect() { const parsed = detectRequest(requestText); if (parsed.code) setSourceCode(parsed.code); if (parsed.source) setSourceProvider(parsed.source); if (parsed.destination) setDestinationProvider(parsed.destination); setMessage(parsed.code && parsed.source && parsed.destination ? "Request details detected. Check them, then convert." : "Some details need to be selected manually."); }

  async function convert(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(""); setActive(null); setReplyText("");
    try {
      const response = await fetch("/api/admin/x-replies", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestText, tweetUrl, sourceProvider, destinationProvider, sourceCode }) });
      const payload = await response.json() as { request?: ReplyRequest; error?: string };
      if (!response.ok || !payload.request) throw new Error(payload.error || "This request could not be converted.");
      setActive(payload.request); setReplyText(payload.request.responseText ?? ""); setMessage(payload.request.status === "READY" ? "Conversion ready. Review the reply before opening X." : payload.request.conversion?.error || "Conversion failed."); await loadQueue();
    } catch (error) { setMessage(error instanceof Error ? error.message : "This request could not be converted."); } finally { setBusy(false); }
  }

  function openRequest(item: ReplyRequest) { setActive(item); setRequestText(item.requestText); setTweetUrl(item.tweetUrl ?? ""); setSourceProvider(item.sourceProvider); setDestinationProvider(item.destinationProvider); setSourceCode(item.sourceCode); setReplyText(item.responseText ?? ""); setMessage(""); }
  async function updateStatus(status: ReplyStatus) { if (!active) return; const response = await fetch(`/api/admin/x-replies/${encodeURIComponent(active.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status, responseText: replyText }) }); if (!response.ok) { setMessage("The reply status could not be saved."); return; } setActive({ ...active, status, responseText: replyText }); setMessage(status === "POSTED" ? "Reply marked as posted." : "Reply archived."); await loadQueue(); }
  async function copyReply() { if (!replyText) return; await navigator.clipboard.writeText(replyText); setMessage("Reply copied."); }

  return <section id="x-replies" className="xra-shell">
    <div className="adm-section-head"><div><h2>X Reply Assistant</h2><p>Paste a tagged request, convert it, review the result, then post it from your own X account.</p></div><span>{readyCount} ready</span></div>
    <div className="xra-grid">
      <form onSubmit={convert} className="xra-form">
        <label><span>Tagged request</span><textarea rows={4} value={requestText} onChange={(event) => setRequestText(event.target.value)} placeholder="@OddsAura BW73507C38 convert this code to SportyBet" required maxLength={1000} /></label>
        <label><span>X post URL <small>optional</small></span><input type="url" value={tweetUrl} onChange={(event) => setTweetUrl(event.target.value)} placeholder="https://x.com/user/status/…" /></label>
        <div className="xra-route"><label><span>From</span><select value={sourceProvider} onChange={(event) => setSourceProvider(event.target.value as Provider)}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></label><b>→</b><label><span>To</span><select value={destinationProvider} onChange={(event) => setDestinationProvider(event.target.value as Provider)}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></label></div>
        <label><span>Booking code</span><input value={sourceCode} onChange={(event) => setSourceCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16))} minLength={4} maxLength={16} required /></label>
        <div className="xra-actions"><button type="button" onClick={detect}>Detect details</button><button className="primary" disabled={busy || sourceProvider === destinationProvider}>{busy ? "Converting…" : "Convert and draft reply"}</button></div>
      </form>
      <section className="xra-result"><header><span>Reply draft</span>{active ? <b className={`status-${active.status.toLowerCase()}`}>{active.status}</b> : null}</header><textarea rows={9} value={replyText} onChange={(event) => setReplyText(event.target.value)} placeholder="A successful conversion will create the reply here." disabled={!active?.responseText} />{message ? <p role="status">{message}</p> : null}<div className="xra-actions"><button type="button" disabled={!replyText} onClick={() => void copyReply()}>Copy reply</button><a className={!replyText ? "disabled" : "primary"} href={replyText ? replyUrl(active?.tweetUrl ?? null, replyText) : undefined} target="_blank" rel="noreferrer">Open reply on X ↗</a><button type="button" disabled={!active || active.status === "FAILED"} onClick={() => void updateStatus("POSTED")}>Mark posted</button></div><small>OddsAura never posts automatically. You stay in control and can edit every reply first.</small></section>
    </div>
    <div className="xra-queue"><header><strong>Recent requests</strong><button type="button" onClick={() => void loadQueue()}>Refresh</button></header>{requests.slice(0, 12).map((item) => <button type="button" onClick={() => openRequest(item)} key={item.id}><span><b>{item.sourceCode}</b>{providers.find((provider) => provider.id === item.sourceProvider)?.label} → {providers.find((provider) => provider.id === item.destinationProvider)?.label}</span><span className={`status-${item.status.toLowerCase()}`}>{item.status}</span><small>{new Date(item.createdAt).toLocaleString()}</small></button>)}{!requests.length ? <p>No X conversion requests saved yet.</p> : null}</div>
  </section>;
}
