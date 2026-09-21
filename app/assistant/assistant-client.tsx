"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import ProductNavigation from "../product-navigation";
import ConverterForm from "../converter/converter-form";
import { fallbackSnapshot, loadSnapshot, refreshSnapshot, type PredictedPick, type Snapshot, type Ticket, type TicketSelection, type WatchlistPick } from "../data";
import { BookmakerCodeError, expandBookmakerMarkets, generateBookmakerCode, providerAdapters, providerSupportsMarket, type BookmakerCodeResponse, type ProviderId } from "../builder/providers";
import { buildTargetSlip, rankBestBets } from "../builder/target-builder";
import { extractDateWindow, interpretAssistantRequest, isWithinDateWindow, matchesRequestedMarket, type AssistantIntent } from "./nlu";
import { includedPicks, resolvedTotal, targetReached } from "./code-summary";
import "./assistant.css";
import "../converter/converter.css";
import "../converter/home-converter.css";
import "../compact-theme.css";

type PendingIntent = Exclude<AssistantIntent, { kind: "unknown" | "daily" | "best" | "results" }>;
type SelectionSummary = { id: string; match: string; market: string; selection: string; odds: number | null; priceStatus?: "QUOTED" | "MODEL_ESTIMATE" };
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
type DailyTicketSummary = {
  id: string;
  title: string;
  totalOdds: number | null;
  status: string;
  selections: SelectionSummary[];
  bookingCodes: Ticket["bookingCodes"];
  warning?: string;
};
type ResultSummary = { id: string; title: string; totalOdds: number; status: string; publishedAt?: string; selections: number };
type AssistantOutput =
  | { kind: "codes"; cards: CodeSummary[] }
  | { kind: "best"; picks: SelectionSummary[] }
  | { kind: "daily"; tickets: DailyTicketSummary[]; watchlist: SelectionSummary[] }
  | { kind: "results"; tickets: ResultSummary[]; won: number; lost: number; pending: number };
type Message = { id: number; role: "user" | "assistant"; text: string; output?: AssistantOutput };
const providerName = (provider: ProviderId) => providerAdapters.find((item) => item.id === provider)?.label ?? provider;
const conversionStageName = (stage?: string) => ({ INPUT: "Request check", IMPORT: "Source import", TRANSLATE: "Market translation", MATCH: "Destination matching", CREATE: "Code creation", VERIFY: "Code verification" }[stage ?? ""] ?? "Conversion");
const formatOdds = (value: number) => value >= 1_000_000 ? value.toExponential(2) : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pickPrice = (pick: PredictedPick) => pick.quotedOdds ?? pick.fairOdds ?? null;

function summarizeSelection(pick: PredictedPick | WatchlistPick | TicketSelection): SelectionSummary {
  const odds = "quotedOdds" in pick ? pick.quotedOdds ?? pick.fairOdds : pick.odds;
  const priceStatus = "priceStatus" in pick ? pick.priceStatus : "quotedOdds" in pick && pick.quotedOdds == null ? "MODEL_ESTIMATE" : "QUOTED";
  return { id: pick.id, match: `${pick.homeTeam.name} vs ${pick.awayTeam.name}`, market: pick.market.name, selection: pick.selection, odds, priceStatus };
}

function bookmakerSelections(picks: PredictedPick[], provider: ProviderId) {
  return picks.map((pick) => ({
    fixtureId: pick.fixtureId,
    homeTeam: pick.homeTeam.name,
    awayTeam: pick.awayTeam.name,
    kickoff: pick.kickoff,
    marketKey: pick.market.key,
    marketName: pick.market.name,
    selection: pick.selection,
    line: pick.market.line,
    providerEventId: pick.oddsProvider?.toLowerCase() === provider ? pick.providerEventId : null,
    providerMarketId: pick.oddsProvider?.toLowerCase() === provider ? pick.providerMarketId : null,
    providerOutcomeId: pick.oddsProvider?.toLowerCase() === provider ? pick.providerSelectionId : null,
    providerSpecifier: pick.oddsProvider?.toLowerCase() === provider ? pick.providerSpecifier : null,
    quotedOdds: pick.quotedOdds,
  }));
}

function mergePending(pending: PendingIntent, input: string): AssistantIntent {
  const next = interpretAssistantRequest(pending.kind === "convert" ? `convert ${input}` : input);
  if (pending.kind === "build") {
    const candidate = next.kind === "build" ? next : null;
    return { ...pending, targetOdds: candidate?.targetOdds ?? pending.targetOdds, provider: candidate?.provider ?? pending.provider, dateWindow: candidate?.dateWindow ?? pending.dateWindow, marketKeys: candidate?.marketKeys ?? pending.marketKeys, confidence: Math.max(pending.confidence, next.confidence) };
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
      dateWindow: candidate && "dateWindow" in candidate ? candidate.dateWindow ?? pending.dateWindow : pending.dateWindow,
      marketKeys: candidate?.marketKeys ?? pending.marketKeys,
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
    return { ...pending, code: candidate?.code ?? pending.code, sourceProvider, destinationProvider, confidence: Math.max(pending.confidence, next.confidence) };
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

export default function AssistantClient({ initialRequest = "", initialTool = "ask" }: { initialRequest?: string; initialTool?: "ask" | "converter" }) {
  const [snapshot, setSnapshot] = useState<Snapshot>(fallbackSnapshot);
  const [resultsSnapshot, setResultsSnapshot] = useState<Snapshot>(fallbackSnapshot);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState(initialRequest.slice(0, 500));
  const [pending, setPending] = useState<PendingIntent | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const nextId = useRef(1);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let active = true;
    const load = (scope: "builder" | "results", apply: (data: Snapshot) => void) => {
      loadSnapshot(scope).then((data) => { if (active) apply(data); }).catch(() => undefined);
      refreshSnapshot(scope).then((data) => { if (active) apply(data); }).catch(() => undefined);
    };
    loadSnapshot("builder").then((data) => { if (active) setSnapshot(data); }).catch(() => undefined).finally(() => { if (active) setLoading(false); });
    refreshSnapshot("builder").then((data) => { if (active) setSnapshot(data); }).catch(() => undefined);
    load("results", setResultsSnapshot);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const predictions = snapshot.predictedPicks ?? [];

  function addMessage(role: Message["role"], text: string, output?: AssistantOutput) {
    setMessages((current) => [...current, { id: nextId.current++, role, text, output }]);
  }

  function askForMissing(intent: AssistantIntent) {
    if (intent.kind === "build" && (!intent.targetOdds || !intent.provider)) {
      setPending(intent);
      addMessage("assistant", !intent.targetOdds && !intent.provider ? "Tell me the target odds and bookmaker—for example, “20 odds for Sporty”." : !intent.targetOdds ? `What total odds should I build for ${providerName(intent.provider!)}?` : "Which bookmaker should I create the code for?");
      return true;
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
    const base: CodeSummary = { provider, requestedOdds, estimatedOdds, selections: picks.map(summarizeSelection) };
    if (picks.some(pick => !Number.isFinite(Date.parse(pick.kickoff)) || Date.parse(pick.kickoff) <= Date.now() + 30 * 60_000)) return { ...base, warning: "A selection is too close to kickoff or has started. Please request a fresh slip." };
    if (adapter.status !== "live") return { ...base, deepLink: adapter.deepLink, warning: `${adapter.label} code creation is still assisted. The complete selection list is ready, but OddsAura will not invent a code.` };
    try {
      const result = await generateBookmakerCode(provider, bookmakerSelections(picks, provider), true);
      const liveOdds = resolvedTotal(result.resolved);
      const warning = [result.warning, !result.verified ? "Check this slip in the bookmaker before betting." : ""].filter(Boolean).join(" ");
      return { ...base, selections: includedPicks(picks, result.resolved).map(pick => ({ ...summarizeSelection(pick), odds: pick.quotedOdds })), code: result.code, deepLink: result.deepLink, verified: result.verified, partial: result.partial, warning, liveOdds, unmatched: result.unmatched };
    } catch (error) {
      const message = error instanceof BookmakerCodeError ? error.message : `${adapter.label} could not create a code right now.`;
      return { ...base, warning: message };
    }
  }

  async function expandEligiblePool(current: PredictedPick[], provider: ProviderId, dateWindow: NonNullable<ReturnType<typeof extractDateWindow>>, marketKeys?: string[], fixtureLimit?: number) {
    try {
      const expanded = await expandBookmakerMarkets(provider, dateWindow.start, dateWindow.end, marketKeys, fixtureLimit);
      const merged = new Map(current.map(pick => [pick.id, pick]));
      for (const pick of expanded) merged.set(pick.id, pick);
      return [...merged.values()].filter(pick => pick.quotedOdds != null && matchesRequestedMarket(pick.market.key, marketKeys) && isWithinDateWindow(pick.kickoff, dateWindow) && providerSupportsMarket(provider, pick.market.key));
    } catch {
      // The saved verified pool remains usable when a bookmaker throttles or
      // temporarily blocks the request-time expansion.
      return current;
    }
  }

  async function executeBuild(intent: Extract<AssistantIntent, { kind: "build" }>) {
    const referenceTime = Date.now();
    const provider = intent.provider!;
    const target = intent.targetOdds!;
    const searchWindow = intent.dateWindow ?? extractDateWindow("upcoming", referenceTime)!;
    let eligible = predictions.filter((pick) => pick.quotedOdds != null && matchesRequestedMarket(pick.market.key, intent.marketKeys) && isWithinDateWindow(pick.kickoff, searchWindow) && providerSupportsMarket(provider, pick.market.key));
    let built = buildTargetSlip(eligible, target, referenceTime, provider, "target");
    if (!built?.exact) {
      const fixtureLimit = target >= 20 ? 80 : target >= 5 ? 60 : 40;
      const expanded = await expandEligiblePool(eligible, provider, searchWindow, intent.marketKeys, fixtureLimit);
      const candidate = buildTargetSlip(expanded, target, referenceTime, provider, "target");
      if (candidate && (!built || Math.abs(candidate.estimatedOdds - target) < Math.abs(built.estimatedOdds - target))) { eligible = expanded; built = candidate; }
    }
    if (!built) {
      addMessage("assistant", `I couldn’t build ${formatOdds(target)} odds for ${providerName(provider)}${intent.dateWindow ? ` ${intent.dateWindow.label}` : ""}.`);
      return;
    }
    const card = await createCodeCard(provider, built.picks, target, built.estimatedOdds);
    addMessage("assistant", card.code
      ? `${providerName(provider)} ${card.partial ? "partial code" : "code"} ready.`
      : `${providerName(provider)} code could not be created.`, { kind: "codes", cards: [card] });
  }

  async function executeSplit(intent: Extract<AssistantIntent, { kind: "split" }>) {
    const referenceTime = Date.now();
    const provider = intent.provider!;
    const target = intent.targetOdds!;
    const requestedParts = intent.parts!;
    const searchWindow = intent.dateWindow ?? extractDateWindow("upcoming", referenceTime)!;
    let eligible = predictions.filter((pick) => pick.quotedOdds != null && matchesRequestedMarket(pick.market.key, intent.marketKeys) && isWithinDateWindow(pick.kickoff, searchWindow) && providerSupportsMarket(provider, pick.market.key));
    let built = buildTargetSlip(eligible, target, referenceTime, provider, "target");
    if (!built?.exact) {
      const fixtureLimit = target >= 20 ? 80 : target >= 5 ? 60 : 40;
      eligible = await expandEligiblePool(eligible, provider, searchWindow, intent.marketKeys, fixtureLimit);
      built = buildTargetSlip(eligible, target, referenceTime, provider, "target");
    }
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
    addMessage("assistant", `${cards.filter(card => card.code).length} of ${groups.length} ${providerName(provider)} codes are ready.`, { kind: "codes", cards });
  }

  async function executeConversion(intent: Extract<AssistantIntent, { kind: "convert" }>) {
    try {
      const response = await fetch("/api/providers/convert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceProvider: intent.sourceProvider, destinationProvider: intent.destinationProvider, code: intent.code, allowPartial: true }),
      });
      const payload = await response.json() as BookmakerCodeResponse & { error?: string; details?: { stage?: string } };
      if (!response.ok || !payload.code) throw new Error(`${conversionStageName(payload.details?.stage)} failed — ${payload.error || "that booking code could not be converted."}`);
      const sourceSelections = payload.sourceSelections ?? [];
      const card: CodeSummary = {
        provider: intent.destinationProvider!, code: payload.code, deepLink: payload.deepLink, verified: payload.verified, partial: payload.partial, warning: [payload.warning, !payload.verified ? "Verification incomplete or mismatched. Check all selections before use." : ""].filter(Boolean).join(" "),
        liveOdds: resolvedTotal(payload.resolved),
        selections: payload.resolved.map((item, index) => {
          const source = sourceSelections.find((selection) => selection.fixtureId === item.fixtureId);
          return { id: `${item.fixtureId}-${index}`, match: source ? `${source.homeTeam} vs ${source.awayTeam}` : item.fixtureId, market: source?.marketName ?? "Converted selection", selection: source?.selection ?? "Included", odds: item.odds };
        }),
        unmatched: [...(payload.unmatched ?? []), ...(payload.sourceIssues ?? []).map(issue => ({ homeTeam: issue.eventName ?? "Untranslated selection", awayTeam: "", reason: `${issue.marketName ?? ""}: ${issue.outcomeName ?? ""}. ${issue.reason ?? "No safe equivalent"}` }))],
      };
      addMessage("assistant", payload.partial ? `I created a partial ${providerName(intent.destinationProvider!)} code. The available selections are included, and every omission is listed below.` : `Your ${providerName(intent.destinationProvider!)} code is ready.`, { kind: "codes", cards: [card] });
    } catch (error) {
      addMessage("assistant", error instanceof Error ? error.message : "That booking code could not be converted.");
    }
  }

  async function execute(intent: AssistantIntent, referenceTime: number) {
    const todayWindow = extractDateWindow("today", referenceTime);
    if (askForMissing(intent)) return;
    setPending(null);
    setBusy(true);
    try {
      if (intent.kind === "build") await executeBuild(intent);
      else if (intent.kind === "split") await executeSplit(intent);
      else if (intent.kind === "convert") await executeConversion(intent);
      else if (intent.kind === "best") {
        const provider = intent.provider ?? "sportybet";
        const dateWindow = intent.dateWindow ?? todayWindow;
        let eligible = predictions.filter((pick) => pick.quotedOdds != null && matchesRequestedMarket(pick.market.key, intent.marketKeys) && isWithinDateWindow(pick.kickoff, dateWindow) && providerSupportsMarket(provider, pick.market.key));
        let ranked = rankBestBets(eligible, referenceTime, provider).slice(0, 3);
        if (!ranked.length) {
          eligible = await expandEligiblePool(eligible, provider, dateWindow, intent.marketKeys);
          ranked = rankBestBets(eligible, referenceTime, provider).slice(0, 3);
        }
        const picks = ranked.map(summarizeSelection);
        addMessage("assistant", picks.length ? `${picks.length} best ${providerName(provider)} selections for ${dateWindow?.label ?? "the requested period"}.` : `No ${providerName(provider)} selections are available for ${dateWindow?.label ?? "the requested period"}.`, picks.length ? { kind: "best", picks } : undefined);
      } else if (intent.kind === "daily") {
        const provider = intent.provider ?? "sportybet";
        const dateWindow = intent.dateWindow ?? todayWindow;
        let eligible = predictions.filter((pick) => pick.quotedOdds != null && matchesRequestedMarket(pick.market.key, intent.marketKeys) && isWithinDateWindow(pick.kickoff, dateWindow) && providerSupportsMarket(provider, pick.market.key));
        if (![2, 5].some(target => buildTargetSlip(eligible, target, referenceTime, provider, "recommended")?.exact)) eligible = await expandEligiblePool(eligible, provider, dateWindow, intent.marketKeys);
        const tickets: DailyTicketSummary[] = [];
        for (const target of [2, 5]) {
          const built = buildTargetSlip(eligible, target, referenceTime, provider, "recommended");
          if (!built || !built.exact) continue;
          const card = await createCodeCard(provider, built.picks, target, built.estimatedOdds);
          const qualified = targetReached(target, card.liveOdds, card.verified, card.partial);
          tickets.push({
            id: `${dateWindow?.start ?? referenceTime}-${provider}-${target}`,
            title: qualified ? `Daily ${target} Odds` : `Requested ${target} Odds — review required`,
            totalOdds: card.liveOdds ?? card.estimatedOdds ?? null,
            status: qualified ? "CODE_READY" : "REVIEW_REQUIRED",
            selections: card.selections,
            bookingCodes: card.code ? [{ provider, code: card.code, ...(card.deepLink ? { deepLink: card.deepLink } : {}) }] : [],
            warning: [card.warning, !qualified ? "Not a verified complete Daily Odds ticket. Check the final bookmaker total and included selections." : "", ...(card.unmatched ?? []).map(row => `${row.homeTeam} vs ${row.awayTeam}: ${row.reason}`)].filter(Boolean).join(" "),
          });
        }
        const watchlist = rankBestBets(eligible, referenceTime, provider).slice(0, 3).map(summarizeSelection);
        addMessage("assistant", tickets.length ? `I built ${tickets.length} bookmaker-priced ${providerName(provider)} Daily Odds ${tickets.length === 1 ? "ticket" : "tickets"} for ${dateWindow?.label ?? "the requested period"}.` : `No complete bookmaker-priced ${providerName(provider)} Daily Odds ticket passes every check for ${dateWindow?.label ?? "the requested period"}.${watchlist.length ? " The strongest individual qualifiers are shown separately." : ""}`, { kind: "daily", tickets, watchlist });
      } else if (intent.kind === "results") {
        const history = [...(resultsSnapshot.ticketHistory ?? resultsSnapshot.tickets ?? [])]
          .filter((ticket) => !intent.dateWindow || ticket.selections.some((pick) => isWithinDateWindow(pick.kickoff, intent.dateWindow)))
          .sort((a, b) => Date.parse(b.publishedAt ?? "") - Date.parse(a.publishedAt ?? ""));
        const tickets = history.slice(0, 8).map((ticket) => ({ id: ticket.id, title: ticket.title, totalOdds: ticket.totalOdds, status: ticket.status === "PUBLISHED" ? "PENDING" : ticket.status, publishedAt: ticket.publishedAt, selections: ticket.selections.length }));
        const won = history.filter((ticket) => ticket.status === "WON").length;
        const lost = history.filter((ticket) => ticket.status === "LOST").length;
        const pending = history.filter((ticket) => ticket.status === "PENDING" || ticket.status === "PUBLISHED").length;
        addMessage("assistant", tickets.length ? `Here are the tracked OddsAura tickets${intent.dateWindow ? ` for ${intent.dateWindow.label}` : ""}. Bookmaker settlement remains final.` : `No tracked results are available${intent.dateWindow ? ` for ${intent.dateWindow.label}` : " yet"}.`, { kind: "results", tickets, won, lost, pending });
      } else {
        addMessage("assistant", "I’m not certain what you want yet. Try “20 odds for Sporty”, “split 100 odds into 3”, “show today’s odds”, “best bet”, or “convert this code”.");
      }
    } finally { setBusy(false); }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = input.trim();
    if (!value || busy) return;
    setInput("");
    addMessage("user", value);
    // Event handler only: obtain the submission time, never a render-time clock.
    // eslint-disable-next-line react-hooks/purity
    const referenceTime = Date.now();
    void execute(pending ? mergePending(pending, value) : interpretAssistantRequest(value, referenceTime), referenceTime);
  }

  function runPrompt(value: string) {
    if (busy || loading) return;
    addMessage("user", value);
    // Click handler only: keep relative dates current even after midnight.
    // eslint-disable-next-line react-hooks/purity
    const referenceTime = Date.now();
    void execute(interpretAssistantRequest(value, referenceTime), referenceTime);
  }

  function startNewChat() {
    if (initialTool === "converter") {
      window.location.assign("/dashboard");
      return;
    }
    setMessages([]);
    setPending(null);
    setInput("");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  return <main className="assistant-app">
    <ProductNavigation active={initialTool === "converter" ? "converter" : "home"} />
    <section className="assistant-shell">
      <header className="assistant-toolbar">
        <span><i aria-hidden="true" /> Verified football data</span>
        <button type="button" onClick={startNewChat}>New chat</button>
      </header>
      <section className={`assistant-workspace ${messages.length ? "has-messages" : ""}`} aria-label="OddsAura betting assistant">
        {initialTool === "converter" ? <section className="home-code-converter" aria-label="Booking code converter">
          <header><div><span>Code converter</span><h1>Move a code to another bookmaker.</h1></div><p>Choose the original bookmaker, the destination and paste the booking code. OddsAura reloads the source slip, matches the destination markets and shows every selection it could not include.</p></header>
          <ConverterForm embedded />
        </section> : <>
        {!messages.length && !busy ? <div className="assistant-welcome">
          <div className="assistant-orb" aria-hidden="true"><i /><i /><span /></div>
          <span>OddsAura assistant</span>
          <h1>What do you want to bet?</h1>
          <p>Write naturally. I can build target odds, split slips, convert codes, find the strongest matches and check results.</p>
          <div className="assistant-prompts" aria-label="Example requests">
            {["Give me 20 odds for Sporty", "Split 100 odds into 3 Sporty codes", "Show today’s qualified odds", "Check recent results"].map((prompt, index) => <button type="button" key={prompt} onClick={() => runPrompt(prompt)}><b>{["↗", "⑂", "◎", "✓"][index]}</b><span>{prompt}</span></button>)}
          </div>
        </div> : null}
        {messages.length || busy ? <div ref={threadRef} className="assistant-thread" aria-live="polite">
          {messages.map((message) => <article key={message.id} className={`assistant-message ${message.role}`}><div className="assistant-avatar" aria-hidden="true">{message.role === "assistant" ? "OA" : "You"}</div><div className="assistant-bubble"><p>{message.text}</p>{message.output ? <OutputView output={message.output} /> : null}</div></article>)}
          {busy ? <article className="assistant-message assistant"><div className="assistant-avatar" aria-hidden="true">OA</div><div className="assistant-bubble assistant-thinking"><i /><i /><i /><span>Checking matches and bookmaker markets…</span></div></article> : null}
        </div> : null}
        <div className="assistant-composer-dock">
          <form className="assistant-composer" onSubmit={submit}>
            <label htmlFor="assistant-request">Tell OddsAura what you want</label>
            <textarea ref={inputRef} id="assistant-request" rows={1} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={loading ? "Loading football data…" : "Ask OddsAura anything…"} disabled={busy || loading} />
            <button type="submit" disabled={busy || loading || !input.trim()} aria-label="Send request"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 14-7-4 14-3-6z" /><path d="m12 13 7-8" /></svg></button>
          </form>
          <p>Verified selections only · Check every bookmaker slip · 18+</p>
        </div>
        </>}
      </section>
    </section>
  </main>;
}

function OutputView({ output }: { output: AssistantOutput }) {
  const [copied, setCopied] = useState("");
  async function copy(value: string) { await navigator.clipboard.writeText(value); setCopied(value); window.setTimeout(() => setCopied(""), 1600); }

  if (output.kind === "best") return <details className="assistant-expandable"><summary><span>{output.picks.length} best selections</span><b>Show</b></summary><div className="assistant-picks">{output.picks.map((pick, index) => <div key={pick.id}><span>#{index + 1}</span><div><b>{pick.match}</b><small>{pick.market}: {pick.selection}</small></div><strong>{pick.odds?.toFixed(2) ?? "—"}</strong></div>)}</div></details>;

  if (output.kind === "daily") return <div className="assistant-daily-output">
    {output.tickets.map((ticket) => <section className="assistant-ticket-card" key={ticket.id}>
      <header><div><span>Ticket check</span><b>{ticket.title}</b></div><strong>{ticket.totalOdds == null ? "—" : formatOdds(ticket.totalOdds)}</strong></header>
      <small>{ticket.selections.length} picks · {ticket.status === "CODE_READY" ? "Verified code ready" : "Review required"}</small>
      <details className="assistant-output-details"><summary><span>{ticket.selections.length} selections</span><b>Show</b></summary>{ticket.selections.map((pick) => <SelectionRow key={pick.id} pick={pick} />)}</details>
      {ticket.bookingCodes.map((item) => <div className="assistant-inline-code" key={`${ticket.id}-${item.provider}`}><span>{item.provider}</span><b>{item.code}</b><button type="button" onClick={() => void copy(item.code)}>{copied === item.code ? "Copied ✓" : "Copy"}</button></div>)}
      {ticket.warning ? <p className="assistant-warning">{ticket.warning}</p> : null}
    </section>)}
    {output.watchlist.length ? <details className="assistant-watchlist assistant-expandable"><summary><span>{output.watchlist.length} qualified selections</span><b>Show</b></summary><div>{output.watchlist.map((pick) => <SelectionRow key={pick.id} pick={pick} />)}</div></details> : null}
  </div>;

  if (output.kind === "results") return <div className="assistant-results-output">
    <div className="assistant-result-summary"><span><b>{output.won}</b> Won</span><span><b>{output.lost}</b> Lost</span><span><b>{output.pending}</b> Pending</span></div>
    <div>{output.tickets.map((ticket) => <article key={ticket.id}><span className={`result-${ticket.status.toLowerCase()}`}>{ticket.status.replaceAll("_", " ")}</span><div><b>{ticket.title}</b><small>{ticket.publishedAt ? new Date(ticket.publishedAt).toLocaleDateString() : "Tracked ticket"} · {ticket.selections} picks</small></div><strong>{formatOdds(ticket.totalOdds)}</strong></article>)}</div>
  </div>;

  return <div className="assistant-code-grid">{output.cards.map((card, index) => <section className="assistant-code-card" key={`${card.provider}-${index}`}>
    <header><div><span>{providerName(card.provider)} {output.cards.length > 1 ? `code ${index + 1}` : "code"}</span>{card.code ? <strong>{card.code}</strong> : <strong className="unavailable">Not created</strong>}</div>{card.liveOdds ? <b>{formatOdds(card.liveOdds)}</b> : card.estimatedOdds ? <b>{formatOdds(card.estimatedOdds)}</b> : null}</header>
    {card.code ? <div className="assistant-code-actions"><button type="button" onClick={() => void copy(card.code!)}>{copied === card.code ? "Copied ✓" : "Copy code"}</button>{card.deepLink ? <a href={card.deepLink} target="_blank" rel="noreferrer">Open {providerName(card.provider)} ↗</a> : null}</div> : card.deepLink ? <a className="assistant-open-manual" href={card.deepLink} target="_blank" rel="noreferrer">Open {providerName(card.provider)} ↗</a> : null}
    <details className="assistant-output-details"><summary><span>{card.selections.length} {card.code ? "included" : "proposed"} {card.selections.length === 1 ? "selection" : "selections"}</span><b>Show</b></summary>{card.selections.map((pick) => <SelectionRow key={pick.id} pick={pick} />)}</details>
    {card.unmatched?.length ? <details className="assistant-unmatched assistant-output-details"><summary><span>{card.unmatched.length} not included</span><b>Show</b></summary>{card.unmatched.map((row, rowIndex) => <p key={`${row.homeTeam}-${rowIndex}`}><b>{row.homeTeam} vs {row.awayTeam}</b><span>{row.reason}</span></p>)}</details> : null}
    {card.warning ? <p className="assistant-warning">{card.warning}</p> : null}
  </section>)}</div>;
}

function SelectionRow({ pick }: { pick: SelectionSummary }) {
  return <div className="assistant-selection"><div><b>{pick.match}</b><small>{pick.market}: {pick.selection}</small></div><strong>{pick.odds?.toFixed(2) ?? "—"}</strong></div>;
}
