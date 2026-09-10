"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import ProductNavigation from "../product-navigation";
import { fallbackSnapshot, loadSnapshot, refreshSnapshot, type PredictedPick, type Snapshot } from "../data";
import { BookmakerCodeError, generateBookmakerCode, providerAdapters, providerSupportsMarket, type BookmakerCodeResponse, type ProviderId } from "../builder/providers";
import { buildTargetSlip, rankBestBets } from "../builder/target-builder";
import { interpretAssistantRequest, type AssistantIntent } from "./nlu";
import "./assistant.css";
import "../compact-theme.css";

type PendingIntent = Exclude<AssistantIntent, { kind: "unknown" | "daily" | "best" }>;
type SelectionSummary = { id: string; match: string; market: string; selection: string; odds: number | null };
type CodeSummary = {
  provider: ProviderId;
  requestedOdds?: number;
  estimatedOdds?: number;
  liveOdds?: number;
  code?: string;
  deepLink?: string;
  verified?: boolean;
  partial?: boolean;
  warning?: string;
  selections: SelectionSummary[];
  unmatched?: Array<{ homeTeam: string; awayTeam: string; reason: string }>;
};
type AssistantOutput =
  | { kind: "codes"; cards: CodeSummary[] }
  | { kind: "best"; picks: SelectionSummary[] }
  | { kind: "links"; links: Array<{ href: string; label: string }> };
type Message = { id: number; role: "user" | "assistant"; text: string; output?: AssistantOutput };

const providerName = (provider: ProviderId) => providerAdapters.find((item) => item.id === provider)?.label ?? provider;
const formatOdds = (value: number) => value >= 1_000_000 ? value.toExponential(2) : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pickPrice = (pick: PredictedPick) => pick.quotedOdds ?? pick.fairOdds ?? null;

function summarizePick(pick: PredictedPick): SelectionSummary {
  return {
    id: pick.id,
    match: `${pick.homeTeam.name} vs ${pick.awayTeam.name}`,
    market: pick.market.name,
    selection: pick.selection,
    odds: pickPrice(pick),
  };
}

function bookmakerSelections(picks: PredictedPick[]) {
  return picks.map((pick) => ({
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
  }));
}

function mergePending(pending: PendingIntent, input: string): AssistantIntent {
  const next = interpretAssistantRequest(pending.kind === "convert" ? `convert ${input}` : input);
  if (pending.kind === "build") {
    const candidate = next.kind === "build" ? next : null;
    return { ...pending, targetOdds: candidate?.targetOdds ?? pending.targetOdds, provider: candidate?.provider ?? pending.provider, confidence: Math.max(pending.confidence, next.confidence) };
  }
  if (pending.kind === "split") {
    const candidate = next.kind === "split" || next.kind === "build" ? next : null;
    const candidateNumber = candidate && "targetOdds" in candidate ? candidate.targetOdds : null;
    const completingParts = pending.targetOdds != null && pending.parts == null && candidate?.kind === "build" && candidateNumber != null && candidateNumber >= 2 && candidateNumber <= 10;
    return {
      ...pending,
      targetOdds: completingParts ? pending.targetOdds : candidateNumber ?? pending.targetOdds,
      parts: completingParts ? Math.round(candidateNumber!) : candidate && "parts" in candidate ? candidate.parts ?? pending.parts : pending.parts,
      provider: candidate && "provider" in candidate ? candidate.provider ?? pending.provider : pending.provider,
      confidence: Math.max(pending.confidence, next.confidence),
    };
  }
  if (pending.kind === "convert") {
    const candidate = next.kind === "convert" ? next : null;
    const candidates = [...new Set([candidate?.sourceProvider, candidate?.destinationProvider].filter((item): item is ProviderId => item != null))];
    const firstMentioned = candidates[0] ?? null;
    const secondMentioned = candidates[1] ?? null;
    const sourceProvider = pending.sourceProvider ?? (!pending.destinationProvider && candidates.length === 1 ? firstMentioned : candidate?.sourceProvider ?? null);
    const destinationProvider = pending.destinationProvider ?? (pending.sourceProvider && candidates.length === 1 ? firstMentioned : secondMentioned ?? (candidates.length > 1 ? candidate?.destinationProvider ?? null : null));
    return {
      ...pending,
      code: candidate?.code ?? pending.code,
      sourceProvider,
      destinationProvider,
      confidence: Math.max(pending.confidence, next.confidence),
    };
  }
  return next;
}

function partitionPicks(picks: PredictedPick[], requestedParts: number) {
  const parts = Math.max(1, Math.min(requestedParts, picks.length));
  const groups = Array.from({ length: parts }, () => [] as PredictedPick[]);
  const totals = Array.from({ length: parts }, () => 0);
  for (const pick of [...picks].sort((left, right) => (pickPrice(right) ?? 1) - (pickPrice(left) ?? 1))) {
    const target = totals.indexOf(Math.min(...totals));
    groups[target].push(pick);
    totals[target] += Math.log(Math.max(1.001, pickPrice(pick) ?? 1));
  }
  return groups;
}

export default function AssistantClient() {
  const [snapshot, setSnapshot] = useState<Snapshot>(fallbackSnapshot);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<PendingIntent | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    { id: 1, role: "assistant", text: "What do you want to do? Ask for target odds, split a slip, find the strongest picks, or convert a booking code." },
  ]);
  const nextId = useRef(2);
  const endRef = useRef<HTMLDivElement>(null);
  const referenceTime = useMemo(() => Date.now(), []);

  useEffect(() => {
    let active = true;
    const apply = (data: Snapshot) => { if (active) setSnapshot(data); };
    loadSnapshot("builder").then(apply).catch(() => undefined).finally(() => { if (active) setLoading(false); });
    refreshSnapshot("builder").then(apply).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages, busy]);

  const predictions = useMemo(() => (snapshot.predictedPicks ?? []).filter((pick) => Date.parse(pick.kickoff) > referenceTime + 30 * 60_000), [snapshot.predictedPicks, referenceTime]);

  function addMessage(role: Message["role"], text: string, output?: AssistantOutput) {
    setMessages((current) => [...current, { id: nextId.current++, role, text, output }]);
  }

  function askForMissing(intent: AssistantIntent) {
    if (intent.kind === "build") {
      if (!intent.targetOdds || !intent.provider) {
        setPending(intent);
        addMessage("assistant", !intent.targetOdds && !intent.provider ? "Tell me the target odds and bookmaker—for example, “20 odds for Sporty”." : !intent.targetOdds ? `What total odds should I build for ${providerName(intent.provider!)}?` : "Which bookmaker should I create the code for?");
        return true;
      }
    }
    if (intent.kind === "split") {
      const missing = [!intent.targetOdds ? "total odds" : "", !intent.parts ? "number of smaller codes" : "", !intent.provider ? "bookmaker" : ""].filter(Boolean);
      if (missing.length) {
        setPending(intent);
        addMessage("assistant", `I can split it. I still need the ${missing.join(", ").replace(/, ([^,]*)$/, " and $1")}.`);
        return true;
      }
    }
    if (intent.kind === "convert") {
      const missing = [!intent.code ? "booking code" : "", !intent.sourceProvider ? "original bookmaker" : "", !intent.destinationProvider ? "new bookmaker" : ""].filter(Boolean);
      if (missing.length) {
        setPending(intent);
        addMessage("assistant", `To convert it, tell me the ${missing.join(", ").replace(/, ([^,]*)$/, " and $1")}.`);
        return true;
      }
      if (intent.sourceProvider === intent.destinationProvider) {
        setPending({ ...intent, destinationProvider: null });
        addMessage("assistant", "The original and new bookmaker are the same. Which different bookmaker should receive the code?");
        return true;
      }
    }
    return false;
  }

  async function createCodeCard(provider: ProviderId, picks: PredictedPick[], requestedOdds?: number, estimatedOdds?: number): Promise<CodeSummary> {
    const adapter = providerAdapters.find((item) => item.id === provider)!;
    const base: CodeSummary = { provider, requestedOdds, estimatedOdds, selections: picks.map(summarizePick) };
    if (adapter.status !== "live") return { ...base, deepLink: adapter.deepLink, warning: `${adapter.label} code creation is still assisted. The complete selection list is ready, but OddsAura will not invent a code.` };
    try {
      const result = await generateBookmakerCode(provider, bookmakerSelections(picks), true);
      const liveOdds = result.resolved.reduce((total, row) => total * (row.odds ?? 1), 1);
      return { ...base, code: result.code, deepLink: result.deepLink, verified: result.verified, partial: result.partial, warning: result.warning, liveOdds, unmatched: result.unmatched };
    } catch (error) {
      const message = error instanceof BookmakerCodeError ? error.message : `${adapter.label} could not create a code right now.`;
      return { ...base, warning: message };
    }
  }

  async function executeBuild(intent: Extract<AssistantIntent, { kind: "build" }>) {
    const provider = intent.provider!;
    const target = intent.targetOdds!;
    const eligible = predictions.filter((pick) => providerSupportsMarket(provider, pick.market.key));
    const built = buildTargetSlip(eligible, target, referenceTime, provider, "target");
    if (!built) {
      addMessage("assistant", `I couldn’t find enough eligible ${providerName(provider)} selections for ${formatOdds(target)} odds right now. I did not create a fake or unchecked code.`);
      return;
    }
    const card = await createCodeCard(provider, built.picks, target, built.estimatedOdds);
    const reached = Math.abs(built.estimatedOdds - target) / target <= .05;
    addMessage("assistant", card.code
      ? `${card.partial ? "I created a partial" : "Your"} ${providerName(provider)} code is ready${reached ? "" : ` at the closest available total to ${formatOdds(target)}`}.`
      : `I built the ${providerName(provider)} selections, but a verified booking code is not available right now.`, { kind: "codes", cards: [card] });
  }

  async function executeSplit(intent: Extract<AssistantIntent, { kind: "split" }>) {
    const provider = intent.provider!;
    const target = intent.targetOdds!;
    const requestedParts = intent.parts!;
    const eligible = predictions.filter((pick) => providerSupportsMarket(provider, pick.market.key));
    const built = buildTargetSlip(eligible, target, referenceTime, provider, "target");
    if (!built) {
      addMessage("assistant", `I couldn’t build an eligible ${formatOdds(target)}-odds slip to split for ${providerName(provider)}.`);
      return;
    }
    const groups = partitionPicks(built.picks, requestedParts);
    const cards: CodeSummary[] = [];
    for (const group of groups) {
      const estimated = group.reduce((total, pick) => total * (pickPrice(pick) ?? 1), 1);
      cards.push(await createCodeCard(provider, group, undefined, estimated));
    }
    addMessage("assistant", `I split the ${formatOdds(built.estimatedOdds)} estimated total across ${groups.length} smaller ${providerName(provider)} ${groups.length === 1 ? "code" : "codes"}. Their combined selections are the original slip; each smaller code has its own total.`, { kind: "codes", cards });
  }

  async function executeConversion(intent: Extract<AssistantIntent, { kind: "convert" }>) {
    try {
      const response = await fetch("/api/providers/convert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceProvider: intent.sourceProvider, destinationProvider: intent.destinationProvider, code: intent.code, allowPartial: true }),
      });
      const payload = await response.json() as BookmakerCodeResponse & { decoded?: number; error?: string; details?: { unmatched?: CodeSummary["unmatched"] } };
      if (!response.ok || !payload.code) throw new Error(payload.error || "That booking code could not be converted.");
      const card: CodeSummary = {
        provider: intent.destinationProvider!,
        code: payload.code,
        deepLink: payload.deepLink,
        verified: payload.verified,
        partial: payload.partial,
        warning: payload.warning,
        liveOdds: payload.resolved.reduce((total, item) => total * (item.odds ?? 1), 1),
        selections: payload.resolved.map((item, index) => ({ id: `${item.fixtureId}-${index}`, match: item.fixtureId, market: "Converted selection", selection: "Included", odds: item.odds })),
        unmatched: payload.unmatched,
      };
      addMessage("assistant", payload.partial ? `I converted the available selections and created a partial ${providerName(intent.destinationProvider!)} code. Everything omitted is listed below.` : `Your ${providerName(intent.destinationProvider!)} code is ready.`, { kind: "codes", cards: [card] });
    } catch (error) {
      addMessage("assistant", error instanceof Error ? error.message : "That booking code could not be converted.");
    }
  }

  async function execute(intent: AssistantIntent) {
    if (askForMissing(intent)) return;
    setPending(null);
    setBusy(true);
    try {
      if (intent.kind === "build") await executeBuild(intent);
      else if (intent.kind === "split") await executeSplit(intent);
      else if (intent.kind === "convert") await executeConversion(intent);
      else if (intent.kind === "best") {
        const provider = intent.provider ?? "sportybet";
        const picks = rankBestBets(predictions.filter((pick) => providerSupportsMarket(provider, pick.market.key)), referenceTime, provider).slice(0, 5);
        addMessage("assistant", picks.length ? `These are the strongest individual ${providerName(provider)} picks that pass every Best Bet check right now.` : `No ${providerName(provider)} match currently passes every Best Bet check. I won’t loosen the evidence rules to fill the list.`, picks.length ? { kind: "best", picks: picks.map(summarizePick) } : undefined);
      } else if (intent.kind === "daily") {
        addMessage("assistant", "Daily Odds contains the official ready-made tickets. Open it to see today’s qualified 2-odds, 5-odds and longshot slips; when none qualifies, it shows the individually qualified watchlist instead.", { kind: "links", links: [{ href: "/daily", label: "Open Daily Odds" }] });
      } else {
        addMessage("assistant", "I’m not certain what action you want. Try asking me to build target odds, split a slip, show Best Bet, open Daily Odds, or convert a booking code.");
      }
    } finally { setBusy(false); }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = input.trim();
    if (!value || busy) return;
    setInput("");
    addMessage("user", value);
    const interpreted = pending ? mergePending(pending, value) : interpretAssistantRequest(value);
    void execute(interpreted);
  }

  function usePrompt(value: string) {
    if (busy) return;
    setInput(value);
  }

  return <main className="assistant-app compact-betting-app">
    <ProductNavigation active="home" />
    <section className="assistant-shell">
      <header className="assistant-heading"><div><span>OddsAura Assistant</span><h1>Tell me the bet you want.</h1></div><p>Ask naturally. OddsAura understands the request, then uses verified football data and bookmaker connections to do the work.</p></header>
      <section className="assistant-workspace" aria-label="OddsAura betting assistant">
        <div className="assistant-thread" aria-live="polite">
          {messages.map((message) => <article key={message.id} className={`assistant-message ${message.role}`}>
            <div className="assistant-avatar" aria-hidden="true">{message.role === "assistant" ? "OA" : "You"}</div>
            <div className="assistant-bubble"><p>{message.text}</p>{message.output ? <OutputView output={message.output} /> : null}</div>
          </article>)}
          {busy ? <article className="assistant-message assistant"><div className="assistant-avatar" aria-hidden="true">OA</div><div className="assistant-bubble assistant-thinking"><i /><i /><i /><span>Checking matches and bookmaker markets…</span></div></article> : null}
          <div ref={endRef} />
        </div>
        <div className="assistant-prompts" aria-label="Example requests">
          {["Give me 20 odds for Sporty", "Split 100 odds into 3 Sporty codes", "Show me the best bet", "Convert a booking code"].map((prompt) => <button type="button" key={prompt} onClick={() => usePrompt(prompt)}>{prompt}</button>)}
        </div>
        <form className="assistant-composer" onSubmit={submit}>
          <label htmlFor="assistant-request">Your request</label>
          <textarea id="assistant-request" rows={2} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="e.g. Abeg build 20 odds for Sporty" disabled={busy || loading} />
          <button type="submit" disabled={busy || loading || !input.trim()} aria-label="Send request">{loading ? "Loading odds…" : busy ? "Working…" : "Send"}</button>
        </form>
        <p className="assistant-trust">Odds are never guaranteed. Check the returned bookmaker slip before staking. 18+.</p>
      </section>
      <aside className="assistant-shortcuts"><Link href="/builder">Open manual builder</Link><Link href="/converter">Open code converter</Link><Link href="/results">Check results</Link></aside>
    </section>
  </main>;
}

function OutputView({ output }: { output: AssistantOutput }) {
  const [copied, setCopied] = useState("");
  async function copy(value: string) { await navigator.clipboard.writeText(value); setCopied(value); window.setTimeout(() => setCopied(""), 1600); }
  if (output.kind === "links") return <div className="assistant-links">{output.links.map((link) => <Link key={link.href} href={link.href}>{link.label} →</Link>)}</div>;
  if (output.kind === "best") return <div className="assistant-picks">{output.picks.map((pick, index) => <div key={pick.id}><span>#{index + 1}</span><div><b>{pick.match}</b><small>{pick.market}: {pick.selection}</small></div><strong>{pick.odds?.toFixed(2) ?? "—"}</strong></div>)}</div>;
  return <div className="assistant-code-grid">{output.cards.map((card, index) => <section className="assistant-code-card" key={`${card.provider}-${index}`}>
    <header><div><span>{providerName(card.provider)} {output.cards.length > 1 ? `code ${index + 1}` : "code"}</span>{card.code ? <strong>{card.code}</strong> : <strong className="unavailable">Not created</strong>}</div>{card.liveOdds ? <b>{formatOdds(card.liveOdds)}</b> : card.estimatedOdds ? <b>Est. {formatOdds(card.estimatedOdds)}</b> : null}</header>
    {card.code ? <div className="assistant-code-actions"><button type="button" onClick={() => void copy(card.code!)}>{copied === card.code ? "Copied ✓" : "Copy code"}</button>{card.deepLink ? <a href={card.deepLink} target="_blank" rel="noreferrer">Open {providerName(card.provider)} ↗</a> : null}</div> : card.deepLink ? <a className="assistant-open-manual" href={card.deepLink} target="_blank" rel="noreferrer">Open {providerName(card.provider)} ↗</a> : null}
    <details><summary>{card.selections.length} included {card.selections.length === 1 ? "selection" : "selections"}</summary>{card.selections.map((pick) => <div className="assistant-selection" key={pick.id}><div><b>{pick.match}</b><small>{pick.market}: {pick.selection}</small></div><strong>{pick.odds?.toFixed(2) ?? "—"}</strong></div>)}</details>
    {card.unmatched?.length ? <details open className="assistant-unmatched"><summary>{card.unmatched.length} not included</summary>{card.unmatched.map((row, rowIndex) => <p key={`${row.homeTeam}-${rowIndex}`}><b>{row.homeTeam} vs {row.awayTeam}</b><span>{row.reason}</span></p>)}</details> : null}
    {card.warning ? <p className="assistant-warning">{card.warning}</p> : null}
  </section>)}</div>;
}
