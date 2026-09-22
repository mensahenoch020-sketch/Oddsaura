"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import ProductNavigation from "../product-navigation";
import ConverterForm from "../converter/converter-form";
import { fallbackSnapshot, loadSnapshot, refreshSnapshot, type PredictedPick, type Snapshot, type Ticket, type TicketSelection, type WatchlistPick } from "../data";
import { BookmakerCodeError, decodeBookmakerCode, expandBookmakerMarkets, generateBookmakerCode, providerAdapters, providerSupportsMarket, unavailableFixtureIds, type BookmakerCodeResponse, type BookmakerSelection, type ProviderId } from "../builder/providers";
import { buildTargetSlip, rankBestBets } from "../builder/target-builder";
import { extractDateWindow, interpretAssistantRequest, isWithinDateWindow, matchesRequestedMarket, type AssistantIntent } from "./nlu";
import { includedPicks, resolvedTotal, targetReached } from "./code-summary";
import { plainPickExplanation, unmetTargetMessage } from "./plain-language";
import "./assistant.css";
import "../converter/converter.css";
import "../converter/home-converter.css";
import "../compact-theme.css";

type PendingIntent = Extract<AssistantIntent, { kind: "build" | "split" | "convert" | "analyze" }>;
type SelectionSummary = { id: string; match: string; market: string; selection: string; odds: number | null; priceStatus?: "QUOTED" | "MODEL_ESTIMATE"; probability?: number | null; fairOdds?: number | null; edge?: number | null; confidence?: number | null; reasoning?: string; fixtureId?: string };
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
  failedFixtureIds?: string[];
};
type ConversationOutcome = { kind: "build" | "conversion"; explanation: string };
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
  | { kind: "results"; tickets: ResultSummary[]; won: number; lost: number; pending: number }
  | { kind: "analysis"; selections: SelectionSummary[]; totalOdds: number | null; risk: "LOW" | "MEDIUM" | "HIGH"; warning?: string }
  | { kind: "explanation"; selected: SelectionSummary; alternatives: SelectionSummary[] };
type Message = { id: number; role: "user" | "assistant"; text: string; output?: AssistantOutput };
const providerName = (provider: ProviderId) => providerAdapters.find((item) => item.id === provider)?.label ?? provider;
const formatOdds = (value: number) => value >= 1_000_000 ? value.toExponential(2) : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pickPrice = (pick: PredictedPick) => pick.quotedOdds ?? pick.fairOdds ?? null;

function summarizeSelection(pick: PredictedPick | WatchlistPick | TicketSelection): SelectionSummary {
  const odds = "quotedOdds" in pick ? pick.quotedOdds ?? pick.fairOdds : pick.odds;
  const priceStatus = "priceStatus" in pick ? pick.priceStatus : "quotedOdds" in pick && pick.quotedOdds == null ? "MODEL_ESTIMATE" : "QUOTED";
  return { id: pick.id, fixtureId: pick.fixtureId, match: `${pick.homeTeam.name} vs ${pick.awayTeam.name}`, market: pick.market.name, selection: pick.selection, odds, priceStatus, probability: pick.probability, fairOdds: "fairOdds" in pick ? pick.fairOdds : pick.probability > 0 ? 1 / pick.probability : null, edge: pick.edge, confidence: pick.confidence, reasoning: plainPickExplanation(pick) };
}

const normalizedWords = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(fc|cf|sc|afc|club|united|utd)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

function decodedSummary(selection: BookmakerSelection, index: number, model?: PredictedPick): SelectionSummary {
  if (model) return { ...summarizeSelection(model), odds: selection.quotedOdds ?? model.quotedOdds };
  return { id: `${selection.fixtureId}-${index}`, fixtureId: selection.fixtureId, match: `${selection.homeTeam} vs ${selection.awayTeam}`, market: selection.marketName, selection: selection.selection, odds: selection.quotedOdds ?? null };
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
      code: candidate?.kind === "split" ? candidate.code ?? pending.code : pending.code,
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
  if (pending.kind === "analyze") {
    const candidate = next.kind === "analyze" ? next : next.kind === "convert" ? next : null;
    return { ...pending, code: candidate && "code" in candidate ? candidate.code ?? pending.code : pending.code, provider: candidate?.kind === "analyze" ? candidate.provider ?? pending.provider : candidate?.sourceProvider ?? pending.provider, confidence: Math.max(pending.confidence, next.confidence) };
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

function partitionSelections(selections: BookmakerSelection[], requestedParts: number) {
  const parts = Math.max(1, Math.min(requestedParts, selections.length));
  const groups = Array.from({ length: parts }, () => [] as BookmakerSelection[]);
  const totals = Array.from({ length: parts }, () => 0);
  for (const selection of [...selections].sort((left, right) => (right.quotedOdds ?? 1) - (left.quotedOdds ?? 1))) {
    const target = totals.indexOf(Math.min(...totals));
    groups[target].push(selection);
    totals[target] += Math.log(Math.max(1.001, selection.quotedOdds ?? 1));
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
  const conversation = useRef<{ provider: ProviderId | null; code: string | null; selections: SelectionSummary[]; picks: PredictedPick[]; decoded: BookmakerSelection[]; lastOutcome: ConversationOutcome | null }>({ provider: null, code: null, selections: [], picks: [], decoded: [], lastOutcome: null });
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
      const missing = [!intent.code && !intent.targetOdds ? "booking code or total odds" : "", !intent.parts ? "number of smaller codes" : "", !intent.provider ? "bookmaker" : ""].filter(Boolean);
      if (missing.length) {
        setPending(intent);
        addMessage("assistant", `I can split it. I still need the ${missing.join(", ").replace(/, ([^,]*)$/, " and $1")}.`);
        return true;
      }
    }
    if (intent.kind === "analyze" && intent.code && !intent.provider) {
      setPending(intent);
      addMessage("assistant", "Which bookmaker is that booking code from?");
      return true;
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
      return { ...base, warning: message, failedFixtureIds: unavailableFixtureIds(error) };
    }
  }

  async function createTargetCodeCard(provider: ProviderId, initialPicks: PredictedPick[], eligible: PredictedPick[], target: number, estimatedOdds: number) {
    let selected = initialPicks;
    let estimate = estimatedOdds;
    let best: CodeSummary | null = null;
    const excluded = new Set<string>();
    const attempts = new Set<string>();

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const signature = selected.map((pick) => pick.id).sort().join("|");
      if (!signature || attempts.has(signature)) break;
      attempts.add(signature);

      const card = await createCodeCard(provider, selected, target, estimate);
      const distance = card.liveOdds == null ? Number.POSITIVE_INFINITY : Math.abs(card.liveOdds - target) / target;
      const bestDistance = best?.liveOdds == null ? Number.POSITIVE_INFINITY : Math.abs(best.liveOdds - target) / target;
      if (!best || (card.code && !best.code) || (Boolean(card.code) === Boolean(best.code) && distance < bestDistance)) best = card;
      if (targetReached(target, card.liveOdds, card.verified, card.partial)) return card;

      const includedIds = new Set(card.selections.map((pick) => pick.fixtureId).filter((id): id is string => Boolean(id)));
      const accepted = card.code ? selected.filter((pick) => includedIds.has(pick.fixtureId)) : [];
      const failed = new Set(card.failedFixtureIds ?? []);
      if (card.partial) for (const pick of selected) if (!includedIds.has(pick.fixtureId)) failed.add(pick.fixtureId);
      for (const id of failed) excluded.add(id);

      const acceptedTotal = card.liveOdds;
      const remainingTarget = accepted.length && acceptedTotal && acceptedTotal > 1 ? Math.max(1.2, target / acceptedTotal) : target;
      const unavailable = new Set([...excluded, ...accepted.map((pick) => pick.fixtureId)]);
      const replacementPool = eligible.filter((pick) => !unavailable.has(pick.fixtureId));
      const replacements = buildTargetSlip(replacementPool, remainingTarget, Date.now(), provider, "target");
      if (!replacements) break;
      selected = [...accepted, ...replacements.picks];
      estimate = selected.reduce((total, pick) => total * (pickPrice(pick) ?? 1), 1);
    }

    return best ?? createCodeCard(provider, initialPicks, target, estimatedOdds);
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
      const explanation = unmetTargetMessage(providerName(provider), target);
      conversation.current = { provider, code: null, selections: [], picks: [], decoded: [], lastOutcome: { kind: "build", explanation } };
      addMessage("assistant", explanation);
      return;
    }
    const card = await createTargetCodeCard(provider, built.picks, eligible, target, built.estimatedOdds);
    const reached = targetReached(target, card.liveOdds, card.verified, card.partial);
    const closeToTarget = card.liveOdds != null && !card.partial && Math.abs(card.liveOdds - target) / target <= .05;
    const explanation = reached
      ? `${providerName(provider)} code ready at ${formatOdds(card.liveOdds!)} odds.`
      : card.code && closeToTarget
        ? `${providerName(provider)} code created at ${formatOdds(card.liveOdds!)} odds. Check the final slip with ${providerName(provider)} before using it.`
      : card.code
        ? unmetTargetMessage(providerName(provider), target, card.liveOdds, true)
        : `${unmetTargetMessage(providerName(provider), target)}${card.warning ? ` ${card.warning}` : ""}`;
    const selectedIds = new Set(card.selections.map((pick) => pick.id));
    const finalPicks = eligible.filter((pick) => selectedIds.has(pick.id));
    conversation.current = { provider, code: card.code ?? null, selections: card.selections, picks: finalPicks, decoded: [], lastOutcome: { kind: "build", explanation } };
    addMessage("assistant", explanation, { kind: "codes", cards: [card] });
  }

  async function executeSplit(intent: Extract<AssistantIntent, { kind: "split" }>) {
    const referenceTime = Date.now();
    const provider = intent.provider!;
    const requestedParts = intent.parts!;
    if (intent.code) {
      try {
        const decoded = await decodeBookmakerCode(provider, intent.code);
        const groups = partitionSelections(decoded.selections, requestedParts);
        const cards: CodeSummary[] = [];
        for (const group of groups) {
          try {
            const result = await generateBookmakerCode(provider, group, true);
            cards.push({
              provider,
              code: result.code,
              deepLink: result.deepLink,
              verified: result.verified,
              partial: result.partial,
              liveOdds: resolvedTotal(result.resolved),
              selections: group.map((selection, index) => decodedSummary(selection, index)),
              unmatched: result.unmatched,
              warning: [result.warning, !result.verified ? "Reload verification is incomplete. Check every selection before use." : ""].filter(Boolean).join(" "),
            });
          } catch (error) {
            cards.push({ provider, selections: group.map((selection, index) => decodedSummary(selection, index)), warning: error instanceof Error ? error.message : `${providerName(provider)} could not create this part.` });
          }
        }
        if (decoded.skippedSelections.length && cards[0]) {
          cards[0].unmatched = [...(cards[0].unmatched ?? []), ...decoded.skippedSelections.map(issue => ({ homeTeam: issue.eventName ?? "Unreadable source selection", awayTeam: "", reason: `${issue.marketName ?? "Unknown market"}: ${issue.outcomeName ?? "Unknown option"}. ${issue.reason ?? "No safe equivalent"}` }))];
        }
        const summaries = cards.flatMap(card => card.selections);
        const matchedPicks = decoded.selections.flatMap(selection => { const match = matchPrediction(selection, provider); return match ? [match] : []; });
        conversation.current = { provider, code: intent.code, selections: summaries, picks: matchedPicks, decoded: decoded.selections, lastOutcome: null };
        addMessage("assistant", `${cards.filter(card => card.code).length} of ${cards.length} ${providerName(provider)} split codes are ready.${decoded.partial ? ` ${decoded.skipped} source selection${decoded.skipped === 1 ? " was" : "s were"} not readable and were not hidden.` : ""}`, { kind: "codes", cards });
      } catch (error) {
        addMessage("assistant", error instanceof Error ? error.message : `That ${providerName(provider)} code could not be split.`);
      }
      return;
    }
    const target = intent.targetOdds!;
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
    conversation.current = { provider, code: null, selections: cards.flatMap(card => card.selections), picks: built.picks, decoded: [], lastOutcome: null };
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
      if (!response.ok || !payload.code) throw new Error(payload.error || "That booking code could not be converted.");
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
      const matchedPicks = sourceSelections.flatMap(selection => { const match = matchPrediction(selection, intent.destinationProvider!); return match ? [match] : []; });
      conversation.current = { provider: intent.destinationProvider!, code: payload.code, selections: card.selections, picks: matchedPicks, decoded: sourceSelections, lastOutcome: null };
      addMessage("assistant", payload.partial ? `I created a partial ${providerName(intent.destinationProvider!)} code. The available selections are included, and every omission is listed below.` : `Your ${providerName(intent.destinationProvider!)} code is ready.`, { kind: "codes", cards: [card] });
    } catch (error) {
      addMessage("assistant", error instanceof Error ? error.message : "That booking code could not be converted.");
    }
  }

  function matchPrediction(selection: BookmakerSelection, provider: ProviderId) {
    const home = normalizedWords(selection.homeTeam), away = normalizedWords(selection.awayTeam);
    return predictions.find((pick) => pick.market.key === selection.marketKey
      && (!pick.oddsProvider || pick.oddsProvider.toLowerCase() === provider)
      && normalizedWords(pick.homeTeam.name) === home
      && normalizedWords(pick.awayTeam.name) === away);
  }

  async function executeAnalysis(intent: Extract<AssistantIntent, { kind: "analyze" }>) {
    let selections = conversation.current.selections;
    let decoded: BookmakerSelection[] = conversation.current.decoded;
    let provider = intent.provider ?? conversation.current.provider;
    if (intent.code) {
      try {
        provider = intent.provider!;
        const result = await decodeBookmakerCode(provider, intent.code);
        decoded = result.selections;
        selections = decoded.map((selection, index) => decodedSummary(selection, index, matchPrediction(selection, provider!)));
        conversation.current = { provider, code: intent.code, selections, picks: decoded.flatMap(selection => { const match = matchPrediction(selection, provider!); return match ? [match] : []; }), decoded, lastOutcome: null };
      } catch (error) {
        addMessage("assistant", error instanceof Error ? error.message : "That booking code could not be analysed.");
        return;
      }
    }
    if (!selections.length) {
      addMessage("assistant", "Send a booking code with its bookmaker, or first ask me to build a slip. Then I can analyse the exact selections.");
      return;
    }
    const quoted = selections.map(item => item.odds).filter((value): value is number => value != null && value > 1);
    const totalOdds = quoted.length === selections.length ? quoted.reduce((total, price) => total * price, 1) : null;
    const risk: "LOW" | "MEDIUM" | "HIGH" = selections.length >= 8 || (totalOdds ?? 0) >= 20 ? "HIGH" : selections.length >= 4 || (totalOdds ?? 0) >= 5 ? "MEDIUM" : "LOW";
    const unsupported = selections.filter(item => item.probability == null).length;
    const warning = unsupported ? `${unsupported} selection${unsupported === 1 ? " does" : "s do"} not have enough verified information for a detailed assessment.` : undefined;
    addMessage("assistant", `This is a ${risk.toLowerCase()}-risk slip with ${selections.length} selection${selections.length === 1 ? "" : "s"}${totalOdds ? ` at ${formatOdds(totalOdds)} combined odds` : ""}. I only used information OddsAura could verify.`, { kind: "analysis", selections, totalOdds, risk, warning });
  }

  function executeExplanation(intent: Extract<AssistantIntent, { kind: "explain" }>) {
    const picks = conversation.current.picks;
    if (!picks.length) {
      addMessage("assistant", conversation.current.lastOutcome?.explanation ?? "I don’t have a match or booking code to explain yet. Send one, or ask me to build a slip first.");
      return;
    }
    const subject = normalizedWords(intent.subject);
    const selected = picks.find(pick => subject.includes(normalizedWords(pick.homeTeam.name)) || subject.includes(normalizedWords(pick.awayTeam.name)) || subject.includes(normalizedWords(pick.selection))) ?? picks[0]!;
    const provider = (selected.oddsProvider?.toLowerCase() as ProviderId | undefined) ?? conversation.current.provider;
    const alternatives = predictions.filter(pick => pick.fixtureId === selected.fixtureId && pick.id !== selected.id && (!provider || pick.oddsProvider?.toLowerCase() === provider)).sort((a, b) => b.confidence - a.confidence).slice(0, 4);
    addMessage("assistant", plainPickExplanation(selected, provider ? providerName(provider) : null), { kind: "explanation", selected: summarizeSelection(selected), alternatives: alternatives.map(summarizeSelection) });
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
      else if (intent.kind === "analyze") await executeAnalysis(intent);
      else if (intent.kind === "explain") executeExplanation(intent);
      else if (intent.kind === "best") {
        const provider = intent.provider ?? "sportybet";
        const dateWindow = intent.dateWindow ?? todayWindow;
        let eligible = predictions.filter((pick) => pick.quotedOdds != null && matchesRequestedMarket(pick.market.key, intent.marketKeys) && isWithinDateWindow(pick.kickoff, dateWindow) && providerSupportsMarket(provider, pick.market.key));
        let ranked = rankBestBets(eligible, referenceTime, provider, intent.strategy).slice(0, 3);
        if (!ranked.length) {
          eligible = await expandEligiblePool(eligible, provider, dateWindow, intent.marketKeys);
          ranked = rankBestBets(eligible, referenceTime, provider, intent.strategy).slice(0, 3);
        }
        const picks = ranked.map(summarizeSelection);
        conversation.current = { provider, code: null, selections: picks, picks: ranked, decoded: [], lastOutcome: null };
        const strategyLabel = intent.strategy === "value" ? "best-value" : "best-protection";
        addMessage("assistant", picks.length ? `${picks.length} ${strategyLabel} ${providerName(provider)} selections for ${dateWindow?.label ?? "the requested period"}.` : `No ${providerName(provider)} ${strategyLabel} selections are available for ${dateWindow?.label ?? "the requested period"}.`, picks.length ? { kind: "best", picks } : undefined);
      } else if (intent.kind === "daily") {
        const provider = intent.provider ?? "sportybet";
        const dateWindow = intent.dateWindow ?? todayWindow;
        let eligible = predictions.filter((pick) => pick.quotedOdds != null && matchesRequestedMarket(pick.market.key, intent.marketKeys) && isWithinDateWindow(pick.kickoff, dateWindow) && providerSupportsMarket(provider, pick.market.key));
        if (![2, 5].some(target => buildTargetSlip(eligible, target, referenceTime, provider, intent.strategy)?.exact)) eligible = await expandEligiblePool(eligible, provider, dateWindow, intent.marketKeys);
        const tickets: DailyTicketSummary[] = [];
        const chosenPicks: PredictedPick[] = [];
        for (const target of [2, 5]) {
          const built = buildTargetSlip(eligible, target, referenceTime, provider, intent.strategy);
          if (!built || !built.exact) continue;
          chosenPicks.push(...built.picks);
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
        const watchlist = rankBestBets(eligible, referenceTime, provider, intent.strategy).slice(0, 3).map(summarizeSelection);
        conversation.current = { provider, code: tickets[0]?.bookingCodes[0]?.code ?? null, selections: tickets.flatMap(ticket => ticket.selections), picks: chosenPicks, decoded: [], lastOutcome: null };
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
        addMessage("assistant", "I’m not certain what you want yet. Try “20 odds for Sporty”, “split Sporty code BA12345 into 3”, “what do you think about this odds?”, “why this pick?”, or “convert this code”.");
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
    conversation.current = { provider: null, code: null, selections: [], picks: [], decoded: [], lastOutcome: null };
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
            {["Best protection for today", "Best value for today", "Build 20 odds for Sporty", "Show today’s qualified odds"].map((prompt, index) => <button type="button" key={prompt} onClick={() => runPrompt(prompt)}><b>{["✓", "↗", "⑂", "◎"][index]}</b><span>{prompt}</span></button>)}
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

  if (output.kind === "analysis") return <section className="assistant-analysis">
    <header><div><span>Slip assessment</span><b>{output.risk} RISK</b></div><strong>{output.totalOdds == null ? "Odds unavailable" : formatOdds(output.totalOdds)}</strong></header>
    <div>{output.selections.map((pick) => <SelectionRow key={pick.id} pick={pick} detailed />)}</div>
    {output.warning ? <p className="assistant-warning">{output.warning}</p> : null}
  </section>;

  if (output.kind === "explanation") return <section className="assistant-analysis assistant-explanation">
    <header><div><span>Why this option</span><b>{output.selected.match}</b></div><strong>{output.selected.odds?.toFixed(2) ?? "—"}</strong></header>
    <SelectionRow pick={output.selected} detailed />
    {output.alternatives.length ? <details className="assistant-output-details"><summary><span>{output.alternatives.length} alternatives considered</span><b>Compare</b></summary>{output.alternatives.map(pick => <SelectionRow key={pick.id} pick={pick} detailed />)}</details> : null}
  </section>;

  return <div className="assistant-code-grid">{output.cards.map((card, index) => <section className="assistant-code-card" key={`${card.provider}-${index}`}>
    <header><div><span>{providerName(card.provider)} {output.cards.length > 1 ? `code ${index + 1}` : "code"}</span>{card.code ? <strong>{card.code}</strong> : <strong className="unavailable">Not created</strong>}</div>{card.liveOdds ? <b>{formatOdds(card.liveOdds)}</b> : card.estimatedOdds ? <b>{formatOdds(card.estimatedOdds)}</b> : null}</header>
    {card.code ? <div className="assistant-code-actions"><button type="button" onClick={() => void copy(card.code!)}>{copied === card.code ? "Copied ✓" : "Copy code"}</button>{card.deepLink ? <a href={card.deepLink} target="_blank" rel="noreferrer">Open {providerName(card.provider)} ↗</a> : null}</div> : card.deepLink ? <a className="assistant-open-manual" href={card.deepLink} target="_blank" rel="noreferrer">Open {providerName(card.provider)} ↗</a> : null}
    <details className="assistant-output-details"><summary><span>{card.selections.length} {card.code ? "included" : "proposed"} {card.selections.length === 1 ? "selection" : "selections"}</span><b>Show</b></summary>{card.selections.map((pick) => <SelectionRow key={pick.id} pick={pick} />)}</details>
    {card.unmatched?.length ? <details className="assistant-unmatched assistant-output-details"><summary><span>{card.unmatched.length} not included</span><b>Show</b></summary>{card.unmatched.map((row, rowIndex) => <p key={`${row.homeTeam}-${rowIndex}`}><b>{row.homeTeam} vs {row.awayTeam}</b><span>{row.reason}</span></p>)}</details> : null}
    {card.warning ? <p className="assistant-warning">{card.warning}</p> : null}
  </section>)}</div>;
}

function SelectionRow({ pick, detailed = false }: { pick: SelectionSummary; detailed?: boolean }) {
  return <div className="assistant-selection"><div><b>{pick.match}</b><small>{pick.market}: {pick.selection}</small>{detailed && pick.confidence != null ? <em>{Math.round(pick.confidence * 100)}% confidence</em> : null}</div><strong>{pick.odds?.toFixed(2) ?? "—"}</strong></div>;
}
