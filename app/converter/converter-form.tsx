"use client";

import { FormEvent, useMemo, useState } from "react";

type Provider = "sportybet" | "betpawa" | "bet9ja" | "betking" | "betway";
type Result = { code: string; deepLink: string; decoded: number; partial?: boolean; unmatched?: Array<{ homeTeam: string; awayTeam: string; reason: string }>; importedFrom?: string };

const providers: Array<{ id: Provider; label: string; input: string; output: string; note: string; link: string }> = [
  { id: "sportybet", label: "SportyBet", input: "Public code import", output: "Automatic", note: "Loads and recreates verified selections.", link: "https://www.sportybet.com/ng/" },
  { id: "betpawa", label: "betPawa", input: "Public code import", output: "Automatic", note: "Loads booking numbers and creates a new code.", link: "https://www.betpawa.ng/" },
  { id: "bet9ja", label: "Bet9ja", input: "Public code import", output: "Automatic", note: "Loads, rebuilds and reload-verifies the booking code.", link: "https://sports.bet9ja.com/mobile/bookabet" },
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
  const sourceMeta = useMemo(() => providers.find((item) => item.id === source)!, [source]);
  const destinationMeta = useMemo(() => providers.find((item) => item.id === destination)!, [destination]);

  function swap() { setSource(destination); setDestination(source); setResult(null); setMessage(""); }

  async function convert(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(""); setResult(null);
    try {
      const response = await fetch("/api/providers/convert", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceProvider: source, destinationProvider: destination, code: code.trim(), allowPartial: false }) });
      const text = await response.text();
      let payload: Result & { error?: string };
      try { payload = JSON.parse(text) as Result & { error?: string }; }
      catch { throw new Error("The bookmaker connection returned an unreadable response. Please retry shortly."); }
      if (!response.ok || !payload.code) throw new Error(payload.error || "This code could not be converted.");
      setResult(payload); setMessage("Every selection was converted and the new code was reload-verified.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "This code could not be converted."); }
    finally { setBusy(false); }
  }

  return <>
    <section className={`converter-workspace${embedded ? " converter-workspace-embedded" : ""}`}>
      <form onSubmit={convert}>
        <div className="converter-route">
          <label><span>From</span><select value={source} onChange={(event) => { setSource(event.target.value as Provider); setResult(null); }}>{providers.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select><small>{sourceMeta.input}</small></label>
          <button type="button" className="converter-swap" onClick={swap} aria-label="Swap source and destination">⇄</button>
          <label><span>To</span><select value={destination} onChange={(event) => { setDestination(event.target.value as Provider); setResult(null); }}>{providers.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select><small>{destinationMeta.output}</small></label>
        </div>
        <label className="converter-code"><span>{sourceMeta.label} code</span><input value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16))} placeholder="Enter booking code" minLength={4} maxLength={16} required autoCapitalize="characters" /></label>
        <button className="converter-submit" disabled={busy || source === destination}>{source === destination ? "Choose a different bookmaker" : busy ? "Loading and matching…" : `Convert to ${destinationMeta.label}`}</button>
        {message ? <p className={result ? "converter-message success" : "converter-message"} role="status">{message}</p> : null}
      </form>
      {!embedded ? <aside><span>How it works</span><ol><li>Loads the source bookmaker code.</li><li>Translates supported markets and checks every match.</li><li>Uses the destination’s current odds.</li><li>Creates and reload-verifies the new code.</li></ol><p>Odds can change during conversion. The destination code always uses the odds available there at that moment.</p></aside> : null}
    </section>
    {result ? <section className="converter-result"><div><span>{destinationMeta.label} code</span><strong>{result.code}</strong><small>{result.decoded || 0} selections translated · {result.importedFrom === "account" ? "original OddsAura slip" : "bookmaker import"}</small></div><div><button type="button" onClick={() => void navigator.clipboard.writeText(result.code)}>Copy code</button><a href={result.deepLink} target="_blank" rel="noreferrer">Open {destinationMeta.label} ↗</a></div>{result.unmatched?.length ? <details><summary>{result.unmatched.length} unavailable selections</summary>{result.unmatched.map((item, index) => <p key={`${item.homeTeam}-${index}`}><b>{item.homeTeam} vs {item.awayTeam}</b><span>{item.reason}</span></p>)}</details> : null}</section> : null}
    {!embedded ? <section className="converter-support"><header><span>Live support</span><h2>Bookmaker connection status</h2></header><div>{providers.map((item) => <article key={item.id}><div><strong>{item.label}</strong><span className={item.output === "Automatic" ? "live" : "limited"}>{item.output}</span></div><p>{item.note}</p><a href={item.link} target="_blank" rel="noreferrer">Open bookmaker ↗</a></article>)}</div></section> : null}
  </>;
}
