"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import ProductNavigation from "../product-navigation";
import ConverterForm from "../converter/converter-form";
import { fallbackSnapshot, loadHistoricalFixtures, loadSnapshot, refreshSnapshot, type PredictedPick, type Snapshot, type Ticket, type TicketSelection, type WatchlistPick } from "../data";
import { BookmakerCodeError, decodeBookmakerCode, expandBookmakerMarkets, generateBookmakerCode, providerAdapters, providerSupportsMarket, unavailableFixtureIds, type BookmakerSelection, type ProviderId } from "../builder/providers";
import { buildTargetSlip, rankBestBets } from "../builder/target-builder";
import { extractDateWindow, interpretAssistantRequest, isWithinDateWindow, matchesRequestedMarket, type AssistantIntent, type DateWindow } from "./nlu";
import { includedPicks, resolvedTotal, targetReached } from "./code-summary";
import { plainPickExplanation, unmetTargetMessage } from "./plain-language";
import { leagueFilterFor, leagueFilterLabel, leagueMatches, type LeagueFilter } from "../leagues";
import { canonicalFixtureIdentity } from "./fixture-identity";
import { applyConversationReference, resolveAssistantTurn, type PendingIntent } from "./conversation";
import { saveBetslipImage } from "./betslip-image";
import { matchImageRowsToFixtures, parsePredictionImageText, parseTypedPredictionText, type MatchedImagePrediction } from "./image-import";
import "./assistant.css";
import "../converter/converter.css";
import "../converter/home-converter.css";
import "../compact-theme.css";
import "./experience.css";

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
type FixtureSummary = { id: string; competition: string; country?: string; kickoff: string; homeTeam: string; awayTeam: string; status: string; homeScore?: number | null; awayScore?: number | null };
type AssistantOutput =
  | { kind: "codes"; cards: CodeSummary[] }
  | { kind: "best"; picks: SelectionSummary[] }
  | { kind: "daily"; tickets: DailyTicketSummary[]; watchlist: SelectionSummary[] }
  | { kind: "results"; tickets: ResultSummary[]; won: number; lost: number; pending: number }
  | { kind: "fixtures"; fixtures: FixtureSummary[]; windowLabel: string }
  | { kind: "analysis"; selections: SelectionSummary[]; totalOdds: number | null; risk: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN"; warning?: string }
  | { kind: "explanation"; selected: SelectionSummary; alternatives: SelectionSummary[] };
type Message = { id: number; role: "user" | "assistant"; text: string; output?: AssistantOutput };
type ImageImportReview = { fileName: string; provider: ProviderId; matched: MatchedImagePrediction[]; selected: boolean[]; unmatched: Array<{ homeTeam: string; awayTeam: string; marketText: string; reason: string }> };
const providerName = (provider: ProviderId) => providerAdapters.find((item) => item.id === provider)?.label ?? provider;
const formatOdds = (value: number) => value >= 1_000_000 ? value.toExponential(2) : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pickPrice = (pick: PredictedPick) => pick.quotedOdds ?? pick.fairOdds ?? null;

function friendlyBookmakerError(error: unknown, provider: ProviderId, action: "load" | "create" | "convert") {
  const raw = error instanceof Error ? error.message : "";
  if (/market label not found|market.*not found/i.test(raw)) return `${providerName(provider)} returned a market OddsAura could not translate safely. The readable selections are kept so you can review or retry without that market.`;
  if (/does not currently list|fixture|event.*not found|match.*not found/i.test(raw)) return `${providerName(provider)} does not currently list one or more matches in this slip. OddsAura will keep every match that is available.`;
  if (/timeout|temporar|right now|502|503|blocked|thrott/i.test(raw)) return `${providerName(provider)} is temporarily unavailable. Your selections are still here, so you can try again shortly.`;
  if (/recognise|recognize|valid.*code|could not load/i.test(raw) && action === "load") return `${providerName(provider)} could not load that code. Check the code and bookmaker, then try again.`;
  return `${providerName(provider)} could not ${action === "load" ? "load that code" : action === "create" ? "create the code" : "finish the conversion"}. Your readable selections have not been discarded.`;
}

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

function matchesRequestedLeagues(pick: PredictedPick, filters?: LeagueFilter[]) {
  return !filters?.length || filters.some((filter) => leagueMatches(pick.league, filter));
}

async function prepareOcrImage(file: File): Promise<Blob | File> {
  if (typeof document === "undefined" || !file.type.startsWith("image/")) return file;
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { return file; }
  const scale = Math.min(4, Math.max(1.5, 1400 / Math.max(bitmap.width, 1)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) { bitmap.close(); return file; }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  let luminance = 0;
  let samples = 0;
  for (let index = 0; index < image.data.length; index += 16) {
    luminance += image.data[index]! * .299 + image.data[index + 1]! * .587 + image.data[index + 2]! * .114;
    samples += 1;
  }
  const invert = luminance / Math.max(1, samples) < 118;
  for (let index = 0; index < image.data.length; index += 4) {
    let gray = image.data[index]! * .299 + image.data[index + 1]! * .587 + image.data[index + 2]! * .114;
    if (invert) gray = 255 - gray;
    gray = Math.max(0, Math.min(255, (gray - 128) * 1.35 + 128));
    image.data[index] = image.data[index + 1] = image.data[index + 2] = gray;
  }
  context.putImageData(image, 0, 0);
  return await new Promise((resolve) => canvas.toBlob((blob) => resolve(blob ?? file), "image/png"));
}

function withDeadline<T>(promise: Promise<T>, milliseconds: number, label: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
    promise.then(value => { window.clearTimeout(timer); resolve(value); }, error => { window.clearTimeout(timer); reject(error); });
  });
}

function requestedCompetitionLabel(filters?: LeagueFilter[]) {
  if (!filters?.length) return "the requested competitions";
  return filters.map(leagueFilterLabel).join(filters.length === 2 ? " and " : ", ");
}

function bettingSearchWindow(referenceTime: number, explicit: DateWindow | null, filters?: LeagueFilter[]): DateWindow {
  if (explicit) return explicit;
  if (!filters?.length) return extractDateWindow("upcoming", referenceTime)!;
  return {
    kind: "NEXT_DAYS",
    label: `the available ${requestedCompetitionLabel(filters)} schedule`,
    start: new Date(referenceTime).toISOString(),
    end: new Date(referenceTime + 366 * 86_400_000).toISOString(),
  };
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
  const [matchesSnapshot, setMatchesSnapshot] = useState<Snapshot>(fallbackSnapshot);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [readingImage, setReadingImage] = useState(false);
  const [ocrStatus, setOcrStatus] = useState("");
  const [imageImport, setImageImport] = useState<ImageImportReview | null>(null);
  const [input, setInput] = useState(initialRequest.slice(0, 500));
  const [pending, setPending] = useState<PendingIntent | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const conversation = useRef<{ provider: ProviderId | null; code: string | null; selections: SelectionSummary[]; picks: PredictedPick[]; decoded: BookmakerSelection[]; lastOutcome: ConversationOutcome | null; fixtureList?: FixtureSummary[] }>({ provider: null, code: null, selections: [], picks: [], decoded: [], lastOutcome: null });
  const lastIntent = useRef<AssistantIntent | null>(null);
  const nextId = useRef(1);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    const load = (scope: "builder" | "results", apply: (data: Snapshot) => void) => {
      loadSnapshot(scope).then((data) => { if (active) apply(data); }).catch(() => undefined);
      refreshSnapshot(scope).then((data) => { if (active) apply(data); }).catch(() => undefined);
    };
    loadSnapshot("builder").then((data) => { if (active) setSnapshot(data); }).catch(() => undefined).finally(() => { if (active) setLoading(false); });
    refreshSnapshot("builder").then((data) => { if (active) setSnapshot(data); }).catch(() => undefined);
    load("results", setResultsSnapshot);
    load("matches", setMatchesSnapshot);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const predictions = snapshot.predictedPicks ?? [];
  const fixtures = matchesSnapshot.fixtures ?? [];

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
      const fromListedMatches = !intent.code && Boolean(conversation.current.fixtureList?.length);
      const missing = [!intent.code && !fromListedMatches ? "booking code" : "", !intent.sourceProvider && !fromListedMatches ? "original bookmaker" : "", !intent.allDestinations && !intent.destinationProvider ? "new bookmaker" : ""].filter(Boolean);
      if (missing.length) {
        setPending(intent);
        addMessage("assistant", `To convert it, tell me the ${missing.join(", ").replace(/, ([^,]*)$/, " and $1")}.`);
        return true;
      }
      if (!intent.allDestinations && intent.sourceProvider === intent.destinationProvider) {
        setPending({ ...intent, destinationProvider: null });
        addMessage("assistant", "The original and new bookmaker are the same. Which different bookmaker should receive the code?");
        return true;
      }
    }
    if (intent.kind === "textCode" && !intent.provider) {
      setPending(intent);
      addMessage("assistant", "Which bookmaker should I create this typed selection for?");
      return true;
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

  async function expandEligiblePool(current: PredictedPick[], provider: ProviderId, dateWindow: NonNullable<ReturnType<typeof extractDateWindow>>, marketKeys?: string[], fixtureLimit?: number, leagueFilters?: LeagueFilter[]) {
    try {
      const expanded = await expandBookmakerMarkets(provider, dateWindow.start, dateWindow.end, marketKeys, fixtureLimit);
      const merged = new Map(current.map(pick => [pick.id, pick]));
      for (const pick of expanded) merged.set(pick.id, pick);
      return [...merged.values()].filter(pick => pick.quotedOdds != null && matchesRequestedMarket(pick.market.key, marketKeys) && matchesRequestedLeagues(pick, leagueFilters) && isWithinDateWindow(pick.kickoff, dateWindow) && providerSupportsMarket(provider, pick.market.key));
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
    const searchWindow = bettingSearchWindow(referenceTime, intent.dateWindow, intent.leagueFilters);
    let eligible = predictions.filter((pick) => pick.quotedOdds != null && matchesRequestedMarket(pick.market.key, intent.marketKeys) && matchesRequestedLeagues(pick, intent.leagueFilters) && isWithinDateWindow(pick.kickoff, searchWindow) && providerSupportsMarket(provider, pick.market.key));
    let built = buildTargetSlip(eligible, target, referenceTime, provider, "target");
    if (!built?.exact) {
      const fixtureLimit = target >= 20 ? 80 : target >= 5 ? 60 : 40;
      const expanded = await expandEligiblePool(eligible, provider, searchWindow, intent.marketKeys, fixtureLimit, intent.leagueFilters);
      const candidate = buildTargetSlip(expanded, target, referenceTime, provider, "target");
      if (candidate && (!built || Math.abs(candidate.estimatedOdds - target) < Math.abs(built.estimatedOdds - target))) { eligible = expanded; built = candidate; }
    }
    if (!built) {
      const leagueNote = intent.leagueFilters?.length ? ` I found no eligible ${requestedCompetitionLabel(intent.leagueFilters)} selections${intent.dateWindow ? ` for ${intent.dateWindow.label}` : " in the available bookmaker schedule"}; I did not substitute another competition.` : "";
      const explanation = `${unmetTargetMessage(providerName(provider), target)}${leagueNote}`;
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
    const searchWindow = bettingSearchWindow(referenceTime, intent.dateWindow, intent.leagueFilters);
    let eligible = predictions.filter((pick) => pick.quotedOdds != null && matchesRequestedMarket(pick.market.key, intent.marketKeys) && matchesRequestedLeagues(pick, intent.leagueFilters) && isWithinDateWindow(pick.kickoff, searchWindow) && providerSupportsMarket(provider, pick.market.key));
    let built = buildTargetSlip(eligible, target, referenceTime, provider, "target");
    if (!built?.exact) {
      const fixtureLimit = target >= 20 ? 80 : target >= 5 ? 60 : 40;
      eligible = await expandEligiblePool(eligible, provider, searchWindow, intent.marketKeys, fixtureLimit, intent.leagueFilters);
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
    if (!intent.code && conversation.current.fixtureList?.length) {
      const fixtureIds = new Set(conversation.current.fixtureList
        .filter((fixture) => Date.parse(fixture.kickoff) > Date.now() + 30 * 60_000)
        .map((fixture) => fixture.id));
      const destinations = intent.allDestinations
        ? providerAdapters.filter((adapter) => adapter.status === "live" && adapter.capability === "booking-code").map((adapter) => adapter.id)
        : intent.destinationProvider ? [intent.destinationProvider] : [];
      if (!fixtureIds.size) {
        addMessage("assistant", "That list contains no matches that are still upcoming. I can show their results, but a bookmaker code needs future fixtures and current prices.");
        return;
      }
      const cards: CodeSummary[] = [];
      const selectedByProvider = new Map<ProviderId, PredictedPick[]>();
      for (const destination of destinations) {
        const eligible = predictions.filter((pick) => fixtureIds.has(pick.fixtureId) && pick.quotedOdds != null && providerSupportsMarket(destination, pick.market.key));
        const ranked = rankBestBets(eligible, Date.now(), destination, "protection");
        const used = new Set<string>();
        const chosen = ranked.filter((pick) => !used.has(pick.fixtureId) && Boolean(used.add(pick.fixtureId)));
        selectedByProvider.set(destination, chosen);
        if (!chosen.length) {
          cards.push({ provider: destination, selections: [], warning: `I found no current ${providerName(destination)} prices for the listed matches, so I did not make up selections or odds.` });
          continue;
        }
        const card = await createCodeCard(destination, chosen);
        const requestedIds = new Set(chosen.map((pick) => pick.fixtureId));
        const includedIds = new Set(card.selections.map((pick) => pick.fixtureId).filter((id): id is string => Boolean(id)));
        const notPriced = conversation.current.fixtureList.filter((fixture) => fixtureIds.has(fixture.id) && !requestedIds.has(fixture.id));
        const omitted = notPriced.map((fixture) => ({ homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam, reason: `No current quoted ${providerName(destination)} prediction was available for this match.` }));
        const failed = chosen.filter((pick) => !includedIds.has(pick.fixtureId)).map((pick) => ({ homeTeam: pick.homeTeam.name, awayTeam: pick.awayTeam.name, reason: `The ${providerName(destination)} code creator did not include this match.` }));
        cards.push({ ...card, partial: card.partial || omitted.length > 0 || failed.length > 0, unmatched: [...(card.unmatched ?? []), ...omitted, ...failed] });
      }
      const firstProvider = destinations[0];
      const firstPicks = firstProvider ? selectedByProvider.get(firstProvider) ?? [] : [];
      const firstCard = cards[0];
      conversation.current = { ...conversation.current, provider: firstProvider ?? conversation.current.provider, code: firstCard?.code ?? null, selections: firstCard?.selections ?? [], picks: firstPicks, decoded: firstProvider ? bookmakerSelections(firstPicks, firstProvider) : [], lastOutcome: null };
      if (!cards.length) addMessage("assistant", "Name a bookmaker, or ask for ‘all bookmakers’, and I’ll build from the upcoming matches in the list.");
      else if (intent.allDestinations) addMessage("assistant", `${cards.filter((card) => card.code).length} of ${cards.length} bookmaker codes are ready from the listed matches. Each card shows any matches it could not price or include.`, { kind: "codes", cards });
      else addMessage("assistant", firstCard?.code ? `${firstCard.partial ? "I made a partial code from the matches and prices available. Check the omitted rows." : "The code is ready from the upcoming matches you listed."}` : firstCard?.warning ?? "I couldn’t create a code from that match list.", { kind: "codes", cards });
      return;
    }
    const source = intent.sourceProvider!;
    let decoded: Awaited<ReturnType<typeof decodeBookmakerCode>>;
    try {
      decoded = await decodeBookmakerCode(source, intent.code!);
    } catch (error) {
      addMessage("assistant", friendlyBookmakerError(error, source, "load"));
      return;
    }

    const destinations = intent.allDestinations
      ? providerAdapters.filter(adapter => adapter.status === "live" && adapter.capability === "booking-code" && adapter.id !== source).map(adapter => adapter.id)
      : [intent.destinationProvider!];
    const cards: CodeSummary[] = [];
    for (const destination of destinations) {
      let candidates = decoded.selections;
      let removed: BookmakerSelection[] = [];
      try {
      let payload;
      try {
        payload = await generateBookmakerCode(destination, candidates, true);
      } catch (error) {
        const failed = new Set(unavailableFixtureIds(error));
        if (!failed.size) throw error;
        removed = candidates.filter((selection) => failed.has(selection.fixtureId));
        candidates = candidates.filter((selection) => !failed.has(selection.fixtureId));
        if (!candidates.length) throw error;
        payload = await generateBookmakerCode(destination, candidates, true);
      }
      const sourceIssues = decoded.skippedSelections.map((issue) => ({ homeTeam: issue.eventName ?? "Unreadable source selection", awayTeam: "", reason: `${issue.marketName ?? "Unknown market"}: ${issue.outcomeName ?? "Unknown option"}. ${issue.reason ?? "No safe equivalent"}` }));
      const removedIssues = removed.map((selection) => ({ homeTeam: selection.homeTeam, awayTeam: selection.awayTeam, reason: `${providerName(destination)} does not currently offer the same match or market.` }));
      cards.push({
        provider: destination, code: payload.code, deepLink: payload.deepLink, verified: payload.verified, partial: payload.partial || removed.length > 0 || decoded.partial, warning: [payload.warning, !payload.verified ? "Check every selection in the bookmaker before using this code." : ""].filter(Boolean).join(" "),
        liveOdds: resolvedTotal(payload.resolved),
        selections: payload.resolved.map((item, index) => {
          const selection = candidates.find((candidate) => candidate.fixtureId === item.fixtureId);
          return { id: `${item.fixtureId}-${index}`, fixtureId: item.fixtureId, match: selection ? `${selection.homeTeam} vs ${selection.awayTeam}` : item.fixtureId, market: selection?.marketName ?? "Converted selection", selection: selection?.selection ?? "Included", odds: item.odds };
        }),
        unmatched: [...payload.unmatched, ...removedIssues, ...sourceIssues],
      });
      } catch (error) {
        cards.push({ provider: destination, selections: candidates.map((selection, index) => decodedSummary(selection, index)), warning: friendlyBookmakerError(error, destination, "convert"), partial: true });
      }
    }
    const successful = cards.filter(card => card.code);
    const last = successful.at(-1);
    const lastFixtureIds = new Set(last?.selections.map(item => item.fixtureId).filter(Boolean) ?? []);
    const matchedPicks = last ? decoded.selections.filter(selection => lastFixtureIds.has(selection.fixtureId)).flatMap(selection => { const match = matchPrediction(selection, last.provider); return match ? [match] : []; }) : [];
    conversation.current = { provider: last?.provider ?? source, code: last?.code ?? intent.code, selections: (last ?? cards[0])?.selections ?? [], picks: matchedPicks, decoded: decoded.selections, lastOutcome: null };
    if (intent.allDestinations) addMessage("assistant", `${successful.length} of ${destinations.length} bookmaker codes are ready. Each bookmaker result shows anything it could not include.`, { kind: "codes", cards });
    else if (last) addMessage("assistant", last.partial ? `I created the ${providerName(last.provider)} code with every available selection. Anything omitted is listed clearly below.` : `Your ${providerName(last.provider)} code is ready.`, { kind: "codes", cards });
    else addMessage("assistant", cards[0]?.warning ?? "The conversion could not be completed.", { kind: "codes", cards });
  }

  async function executeTextCode(intent: Extract<AssistantIntent, { kind: "textCode" }>) {
    const provider = intent.provider!;
    const rows = parseTypedPredictionText(intent.text);
    if (!rows.length) {
      addMessage("assistant", "I couldn’t separate the teams and market. Use a format like “Chelsea vs Arsenal — home 1UP” and put each selection on a new line or separate them with semicolons.");
      return;
    }
    const currentFixtures = fixtures.filter(fixture => fixture.status === "SCHEDULED" && Date.parse(fixture.kickoff) > Date.now() + 30 * 60_000);
    const result = matchImageRowsToFixtures(rows, currentFixtures);
    const supported = result.matched.filter(item => providerSupportsMarket(provider, item.selection.marketKey));
    const unsupported = result.matched.filter(item => !providerSupportsMarket(provider, item.selection.marketKey)).map(item => ({ homeTeam: item.selection.homeTeam, awayTeam: item.selection.awayTeam, reason: `${providerName(provider)} does not support automatic ${item.selection.marketName} conversion yet.` }));
    if (!supported.length) {
      const reason = [...result.unmatched, ...unsupported].map(item => `${item.homeTeam}${item.awayTeam ? ` vs ${item.awayTeam}` : ""}: ${item.reason}`).join(" ");
      addMessage("assistant", reason || "No current fixture matched the typed selection.");
      return;
    }
    try {
      const selections = supported.map(item => item.selection);
      const payload = await generateBookmakerCode(provider, selections, true);
      const includedIds = new Set(payload.resolved.map(item => item.fixtureId));
      const card: CodeSummary = {
        provider, code: payload.code, deepLink: payload.deepLink, verified: payload.verified,
        partial: payload.partial || result.unmatched.length > 0 || unsupported.length > 0,
        warning: payload.warning,
        liveOdds: resolvedTotal(payload.resolved),
        selections: selections.filter(item => includedIds.has(item.fixtureId)).map((item, index) => decodedSummary(item, index)),
        unmatched: [...payload.unmatched, ...unsupported, ...result.unmatched.map(item => ({ homeTeam: item.homeTeam, awayTeam: item.awayTeam, reason: item.reason }))],
      };
      const matchedPicks = selections.filter(item => includedIds.has(item.fixtureId)).flatMap(selection => { const match = matchPrediction(selection, provider); return match ? [match] : []; });
      conversation.current = { provider, code: payload.code, selections: card.selections, picks: matchedPicks, decoded: selections, lastOutcome: null };
      addMessage("assistant", card.partial ? `I created the ${providerName(provider)} code from every typed selection I could match. Review the omitted items below.` : `Your ${providerName(provider)} code is ready from the typed selection${selections.length === 1 ? "" : "s"}.`, { kind: "codes", cards: [card] });
    } catch (error) {
      addMessage("assistant", friendlyBookmakerError(error, provider, "create"));
    }
  }

  function matchPrediction(selection: BookmakerSelection, provider: ProviderId) {
    const home = normalizedWords(selection.homeTeam), away = normalizedWords(selection.awayTeam);
    const matches = predictions.filter((pick) => pick.market.key === selection.marketKey
      && normalizedWords(pick.homeTeam.name) === home
      && normalizedWords(pick.awayTeam.name) === away);
    return matches.find((pick) => !pick.oddsProvider || pick.oddsProvider.toLowerCase() === provider)
      ?? matches.sort((left, right) => right.confidence - left.confidence)[0];
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
    const supported = selections.filter(item => item.probability != null || item.confidence != null);
    const risk: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN" = !totalOdds && !supported.length ? "UNKNOWN" : selections.length >= 8 || (totalOdds ?? 0) >= 20 ? "HIGH" : selections.length >= 4 || (totalOdds ?? 0) >= 5 ? "MEDIUM" : "LOW";
    const unsupported = selections.filter(item => item.probability == null).length;
    const warning = unsupported ? `${unsupported} selection${unsupported === 1 ? " is" : "s are"} readable, but ${unsupported === 1 ? "it has" : "they have"} no verified price or model rating yet.` : undefined;
    const summary = risk === "UNKNOWN"
      ? `I loaded ${selections.length} selection${selections.length === 1 ? "" : "s"}, but the bookmaker did not return enough pricing data for an honest risk rating.`
      : `This slip rates ${risk.toLowerCase()} risk with ${selections.length} selection${selections.length === 1 ? "" : "s"}${totalOdds ? ` at ${formatOdds(totalOdds)} combined odds` : ""}.`;
    addMessage("assistant", summary, { kind: "analysis", selections, totalOdds, risk, warning });
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

  function referencedSelection(subject: string, order: "risk" | "safe") {
    const normalized = normalizedWords(subject);
    const named = conversation.current.selections.find((item) => normalized.includes(normalizedWords(item.match)) || item.match.split(" vs ").some((team) => normalized.includes(normalizedWords(team))));
    if (named) return named;
    const scored = [...conversation.current.selections].sort((left, right) => {
      const leftStrength = left.probability ?? left.confidence ?? (left.odds && left.odds > 1 ? 1 / left.odds : .5);
      const rightStrength = right.probability ?? right.confidence ?? (right.odds && right.odds > 1 ? 1 / right.odds : .5);
      return order === "risk" ? leftStrength - rightStrength : rightStrength - leftStrength;
    });
    return scored[0] ?? null;
  }

  async function executeRevision(intent: Extract<AssistantIntent, { kind: "revise" }>) {
    if (!conversation.current.selections.length) {
      addMessage("assistant", "Send a booking code or ask me to build a slip first. Then I can identify, remove or replace a selection.");
      return;
    }
    const order = intent.action === "safest" ? "safe" : "risk";
    const selected = referencedSelection(intent.subject, order);
    if (!selected) return;
    if (intent.action === "riskiest" || intent.action === "safest") {
      const label = intent.action === "riskiest" ? "riskiest" : "safest";
      const reason = selected.reasoning ? ` ${selected.reasoning}` : selected.odds ? ` Its quoted price is ${selected.odds.toFixed(2)}.` : "";
      addMessage("assistant", `${selected.match} — ${selected.selection} is the ${label} selection I can identify in this slip.${reason}`, { kind: "analysis", selections: [selected], totalOdds: selected.odds, risk: intent.action === "riskiest" ? "HIGH" : "LOW" });
      return;
    }

    const provider = conversation.current.provider;
    if (!provider) {
      addMessage("assistant", "Tell me which bookmaker should receive the revised code.");
      return;
    }
    const currentPicks = conversation.current.picks;
    if (currentPicks.length) {
      const removed = currentPicks.find((pick) => pick.id === selected.id || pick.fixtureId === selected.fixtureId) ?? currentPicks[currentPicks.length - 1]!;
      let revised = currentPicks.filter((pick) => pick.id !== removed.id);
      let replacement: PredictedPick | null = null;
      if (intent.action !== "remove") {
        const usedFixtures = new Set(revised.map((pick) => pick.fixtureId));
        const window = extractDateWindow("upcoming")!;
        const candidates = rankBestBets(predictions.filter((pick) => pick.quotedOdds != null && !usedFixtures.has(pick.fixtureId) && isWithinDateWindow(pick.kickoff, window) && providerSupportsMarket(provider, pick.market.key)), Date.now(), provider, "protection");
        replacement = candidates.find((pick) => pick.probability > removed.probability) ?? candidates[0] ?? null;
        if (replacement) revised = [...revised, replacement];
      }
      if (!revised.length) {
        addMessage("assistant", "That is the only supported selection in the slip, so removing it would leave no code to create.");
        return;
      }
      const estimated = revised.reduce((total, pick) => total * (pickPrice(pick) ?? 1), 1);
      const card = await createCodeCard(provider, revised, undefined, estimated);
      conversation.current = { provider, code: card.code ?? null, selections: card.selections, picks: revised, decoded: [], lastOutcome: { kind: "build", explanation: card.code ? `${providerName(provider)} revised code ready.` : `${providerName(provider)} could not create the revised code.` } };
      const action = replacement ? `I replaced ${removed.homeTeam.name} vs ${removed.awayTeam.name} with ${replacement.homeTeam.name} vs ${replacement.awayTeam.name}.` : `I removed ${removed.homeTeam.name} vs ${removed.awayTeam.name}.`;
      addMessage("assistant", `${action} ${card.code ? "The revised code is below." : card.warning || "No revised code was created."}`, { kind: "codes", cards: [card] });
      return;
    }

    const remaining = conversation.current.decoded.filter((item) => item.fixtureId !== selected.fixtureId);
    if (!remaining.length) {
      addMessage("assistant", "That is the only readable selection in the code, so removing it would leave an empty slip.");
      return;
    }
    if (intent.action !== "remove") {
      addMessage("assistant", `I identified ${selected.match} as the weakest readable selection, but I do not have a verified replacement for that match. Ask me to remove it if you want a smaller code.`);
      return;
    }
    try {
      const result = await generateBookmakerCode(provider, remaining, true);
      const included = new Set(result.resolved.map((item) => item.fixtureId));
      const card: CodeSummary = { provider, code: result.code, deepLink: result.deepLink, verified: result.verified, partial: result.partial, liveOdds: resolvedTotal(result.resolved), selections: remaining.filter((item) => included.has(item.fixtureId)).map((item, index) => decodedSummary(item, index, matchPrediction(item, provider))), unmatched: result.unmatched, warning: result.warning };
      conversation.current = { provider, code: result.code, selections: card.selections, picks: remaining.flatMap((item) => { const pick = matchPrediction(item, provider); return pick ? [pick] : []; }), decoded: remaining, lastOutcome: { kind: "build", explanation: `${providerName(provider)} revised code ready.` } };
      addMessage("assistant", `I removed ${selected.match}. The revised ${providerName(provider)} code is below.`, { kind: "codes", cards: [card] });
    } catch (error) {
      addMessage("assistant", error instanceof Error ? error.message : `${providerName(provider)} could not create the revised code.`);
    }
  }

  async function executeConfirmation() {
    const provider = conversation.current.provider;
    const selections = conversation.current.decoded;
    if (!provider || !selections.length) {
      addMessage("assistant", "There isn’t an unfinished slip in this chat yet. Send a booking code or ask me to build one first.");
      return;
    }
    try {
      const result = await generateBookmakerCode(provider, selections, true);
      const includedIds = new Set(result.resolved.map((item) => item.fixtureId));
      const card: CodeSummary = {
        provider,
        code: result.code,
        deepLink: result.deepLink,
        verified: result.verified,
        partial: result.partial,
        liveOdds: resolvedTotal(result.resolved),
        selections: selections.filter((item) => includedIds.has(item.fixtureId)).map((item, index) => decodedSummary(item, index, matchPrediction(item, provider))),
        unmatched: result.unmatched,
        warning: result.warning,
      };
      conversation.current = { ...conversation.current, code: result.code, selections: card.selections };
      addMessage("assistant", result.partial ? `I created the ${providerName(provider)} code with every available selection.` : `Your ${providerName(provider)} code is ready.`, { kind: "codes", cards: [card] });
    } catch (error) {
      addMessage("assistant", friendlyBookmakerError(error, provider, "create"));
    }
  }

  async function execute(intent: AssistantIntent, referenceTime: number) {
    const todayWindow = extractDateWindow("today", referenceTime);
    if (askForMissing(intent)) return;
    lastIntent.current = intent;
    setPending(null);
    setBusy(true);
    try {
      if (intent.kind === "build") await executeBuild(intent);
      else if (intent.kind === "split") await executeSplit(intent);
      else if (intent.kind === "convert") await executeConversion(intent);
      else if (intent.kind === "textCode") await executeTextCode(intent);
      else if (intent.kind === "analyze") await executeAnalysis(intent);
      else if (intent.kind === "explain") executeExplanation(intent);
      else if (intent.kind === "revise") await executeRevision(intent);
      else if (intent.kind === "confirm") await executeConfirmation();
      else if (intent.kind === "help") {
        addMessage("assistant", "I can build target odds, find safer or better-value picks, explain a match, analyse or split a booking code, turn typed selections into a code, and convert one code to every supported bookmaker. Try: “Chelsea vs Arsenal — home 1UP on SportyBet” or “convert SportyBet code 4V0XMZ to all bookmakers”.");
      } else if (intent.kind === "limits") {
        addMessage("assistant", "I can’t guarantee a win, but I can build the safest supported option. Tell me the bookmaker and target odds.");
      } else if (intent.kind === "match") {
        const provider = intent.provider ?? conversation.current.provider ?? "sportybet";
        const home = normalizedWords(intent.homeTeam), away = normalizedWords(intent.awayTeam);
        const candidates = predictions.filter((pick) => {
          const pickHome = normalizedWords(pick.homeTeam.name), pickAway = normalizedWords(pick.awayTeam.name);
          const namesMatch = (pickHome.includes(home) || home.includes(pickHome)) && (pickAway.includes(away) || away.includes(pickAway));
          return namesMatch && pick.quotedOdds != null && (!pick.oddsProvider || pick.oddsProvider.toLowerCase() === provider) && providerSupportsMarket(provider, pick.market.key);
        });
        const selected = rankBestBets(candidates, referenceTime, provider, "protection")[0] ?? [...candidates].sort((left, right) => right.confidence - left.confidence)[0];
        if (!selected) {
          addMessage("assistant", `I can’t find a current verified ${providerName(provider)} market for ${intent.homeTeam} vs ${intent.awayTeam}. Check the team names or try another bookmaker.`);
        } else {
          const alternatives = candidates.filter((pick) => pick.id !== selected.id).sort((left, right) => right.confidence - left.confidence).slice(0, 3);
          conversation.current = { provider, code: null, selections: [summarizeSelection(selected)], picks: [selected], decoded: [], lastOutcome: null };
          addMessage("assistant", plainPickExplanation(selected, providerName(provider)), { kind: "explanation", selected: summarizeSelection(selected), alternatives: alternatives.map(summarizeSelection) });
        }
      }
      else if (intent.kind === "fixtures") {
        const dateWindow = intent.dateWindow ?? (intent.leagueFilters?.length ? null : extractDateWindow("upcoming", referenceTime)!);
        const archiveStart = dateWindow?.start ?? "2010-01-01T00:00:00.000Z";
        const archiveEnd = dateWindow?.end ?? `${new Date(referenceTime).getUTCFullYear() + 1}-12-31T23:59:59.999Z`;
        const archived = await loadHistoricalFixtures(archiveStart, archiveEnd, intent.leagueFilters);
        const seen = new Set<string>();
        const available = [...fixtures, ...(resultsSnapshot.recentResults ?? []), ...archived]
          .filter((fixture) => !dateWindow || isWithinDateWindow(fixture.kickoff, dateWindow))
          .filter((fixture) => !intent.leagueFilters?.length || intent.leagueFilters.some((filter) => leagueMatches(fixture.league, filter)))
          .sort((left, right) => {
            const leftTime = Date.parse(left.kickoff);
            const rightTime = Date.parse(right.kickoff);
            const leftFuture = leftTime >= referenceTime;
            const rightFuture = rightTime >= referenceTime;
            if (leftFuture !== rightFuture) return leftFuture ? -1 : 1;
            return leftFuture ? leftTime - rightTime : rightTime - leftTime;
          })
          .filter((fixture) => {
            const key = canonicalFixtureIdentity(fixture, leagueFilterFor(fixture.league));
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        const totalAvailable = available.length;
        const listed = available.slice(0, 1000)
          .map((fixture): FixtureSummary => ({
            id: fixture.id,
            competition: fixture.league.name,
            country: fixture.league.country,
            kickoff: fixture.kickoff,
            homeTeam: fixture.homeTeam.name,
            awayTeam: fixture.awayTeam.name,
            status: fixture.status,
            homeScore: fixture.homeScore,
            awayScore: fixture.awayScore,
          }));
        const competitions = [...new Set(listed.map((fixture) => fixture.competition))];
        const requested = intent.leagueFilters?.length ? ` in ${requestedCompetitionLabel(intent.leagueFilters)}` : "";
        const windowLabel = dateWindow?.label ?? (intent.leagueFilters?.length ? "all available dates" : "the next 7 days");
        if (listed.length) conversation.current = { provider: intent.provider ?? conversation.current.provider, code: null, selections: [], picks: [], decoded: [], lastOutcome: null, fixtureList: listed };
        addMessage(
          "assistant",
          listed.length
            ? `${totalAvailable > listed.length ? `Showing ${listed.length} of ${totalAvailable}` : listed.length} listed match${totalAvailable === 1 ? "" : "es"}${requested} for ${windowLabel}${competitions.length ? ` across ${competitions.slice(0, 4).join(", ")}${competitions.length > 4 ? " and more" : ""}` : ""}. Completed matches show their final scores.`
            : `I don’t have any listed fixtures${requested} for ${windowLabel}. I did not replace the requested competition with another one.`,
          listed.length ? { kind: "fixtures", fixtures: listed, windowLabel } : undefined,
        );
      }
      else if (intent.kind === "best" || intent.kind === "allPicks") {
        const provider = intent.provider ?? "sportybet";
        const dateWindow = bettingSearchWindow(referenceTime, intent.dateWindow, intent.leagueFilters);
        if (intent.kind === "allPicks" && Date.parse(dateWindow.end) <= referenceTime) {
          addMessage("assistant", `Those matches have already been played, so I can’t present new pre-match predictions as if they were recorded then. Ask “list ${requestedCompetitionLabel(intent.leagueFilters)} matches for ${dateWindow.label}” to see the archived fixtures and final scores.`);
          return;
        }
        let eligible = predictions.filter((pick) => pick.quotedOdds != null && matchesRequestedMarket(pick.market.key, intent.marketKeys) && matchesRequestedLeagues(pick, intent.leagueFilters) && isWithinDateWindow(pick.kickoff, dateWindow) && providerSupportsMarket(provider, pick.market.key));
        let ranked = rankBestBets(eligible, referenceTime, provider, intent.strategy);
        if (intent.kind === "best") ranked = ranked.slice(0, 3);
        if (!ranked.length) {
          eligible = await expandEligiblePool(eligible, provider, dateWindow, intent.marketKeys, undefined, intent.leagueFilters);
          ranked = rankBestBets(eligible, referenceTime, provider, intent.strategy);
          if (intent.kind === "best") ranked = ranked.slice(0, 3);
        }
        const picks = ranked.map(summarizeSelection);
        conversation.current = { provider, code: null, selections: picks, picks: ranked, decoded: [], lastOutcome: null };
        const strategyLabel = intent.strategy === "value" ? "best-value" : "best-protection";
        const leagueText = intent.leagueFilters?.length ? ` in ${requestedCompetitionLabel(intent.leagueFilters)}` : "";
        const label = intent.kind === "allPicks" ? "qualified picks" : `${strategyLabel} selections`;
        addMessage("assistant", picks.length ? `${picks.length} ${label} for ${providerName(provider)}${leagueText} for ${dateWindow.label}. These are only the matches with a current supported price and qualifying data.` : `No ${providerName(provider)} ${label} are available${leagueText} for ${dateWindow.label}. I did not substitute another competition.`, picks.length ? { kind: "best", picks } : undefined);
      } else if (intent.kind === "daily") {
        const provider = intent.provider ?? "sportybet";
        const dateWindow = intent.leagueFilters?.length ? bettingSearchWindow(referenceTime, intent.dateWindow, intent.leagueFilters) : (intent.dateWindow ?? todayWindow);
        let eligible = predictions.filter((pick) => pick.quotedOdds != null && matchesRequestedMarket(pick.market.key, intent.marketKeys) && matchesRequestedLeagues(pick, intent.leagueFilters) && isWithinDateWindow(pick.kickoff, dateWindow) && providerSupportsMarket(provider, pick.market.key));
        if (![2, 5].some(target => buildTargetSlip(eligible, target, referenceTime, provider, intent.strategy)?.exact)) eligible = await expandEligiblePool(eligible, provider, dateWindow, intent.marketKeys, undefined, intent.leagueFilters);
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

  async function importPredictionImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || readingImage || busy) return;
    if (file.size > 15 * 1024 * 1024) {
      addMessage("assistant", "That screenshot is larger than 15 MB. Please crop it or choose a smaller image, then try again.");
      return;
    }
    setReadingImage(true);
    setOcrStatus("Preparing screenshot…");
    setImageImport(null);
    addMessage("user", `Uploaded prediction image: ${file.name}`);
    let worker: { terminate: () => Promise<unknown> } | null = null;
    let timedOut = false;
    try {
      setOcrStatus("Loading image reader…");
      const { createWorker } = await withDeadline(import("tesseract.js"), 15_000, "Image reader download");
      const workerPromise = createWorker("eng", 1, {
        workerPath: "/data/ocr/worker.min.js",
        corePath: "/data/ocr/tesseract-core.wasm.js",
        langPath: "/data/ocr/lang",
        gzip: false,
        workerBlobURL: false,
        logger: (progress) => {
          if (progress.status === "loading tesseract core") setOcrStatus("Loading image engine…");
          else if (progress.status === "initializing tesseract") setOcrStatus("Starting image reader…");
          else if (progress.status === "loading language traineddata") setOcrStatus("Loading text data…");
          else if (progress.status === "initializing api") setOcrStatus("Preparing text recognition…");
          else if (progress.status === "recognizing text") setOcrStatus(`Reading screenshot… ${Math.round((progress.progress ?? 0) * 100)}%`);
        },
      }).then(created => {
        if (timedOut) void created.terminate().catch(() => undefined);
        else worker = created;
        return created;
      });
      worker = await withDeadline(workerPromise, 45_000, "Image reader");
      setOcrStatus("Reading screenshot…");
      const image = await withDeadline(prepareOcrImage(file), 15_000, "Image preparation");
      const result = await withDeadline(worker.recognize(image), 45_000, "Screenshot reading");
      setOcrStatus("Matching teams and markets…");
      const rows = parsePredictionImageText(result.data.text);
      if (!rows.length) {
        addMessage("assistant", "I couldn’t read clear match and market rows from that image. Try a sharper crop showing the team names and picks, or paste the picks as text.");
        return;
      }
      const availableFixtures = fixtures.filter((fixture) => Date.parse(fixture.kickoff) > Date.now() - 60 * 60_000);
      const review = matchImageRowsToFixtures(rows, availableFixtures);
      setImageImport({ fileName: file.name, provider: conversation.current.provider ?? "sportybet", matched: review.matched, selected: review.matched.map(() => true), unmatched: review.unmatched });
      addMessage("assistant", review.matched.length ? `I read ${rows.length} prediction${rows.length === 1 ? "" : "s"} and matched ${review.matched.length}. Review them below, choose the bookmaker, then create the code.` : `I read ${rows.length} prediction${rows.length === 1 ? "" : "s"}, but none matched a current fixture and supported market safely.`);
    } catch (error) {
      timedOut = true;
      const timeout = error instanceof Error && /timed out/i.test(error.message);
      addMessage("assistant", timeout
        ? "Reading this image took too long, so I stopped instead of leaving it loading. Try a smaller crop or paste the picks as text."
        : "I couldn’t read usable team and market text from that image. Try the original screenshot or paste its picks as text.");
    } finally {
      if (worker) await withDeadline(worker.terminate(), 3_000, "Image reader cleanup").catch(() => undefined);
      setReadingImage(false);
      setOcrStatus("");
    }
  }

  async function createImageCode() {
    if (!imageImport || busy) return;
    const supported = imageImport.matched.filter((match, index) => imageImport.selected[index] && providerSupportsMarket(imageImport.provider, match.selection.marketKey));
    if (!supported.length) {
      addMessage("assistant", `None of the selected image predictions use markets ${providerName(imageImport.provider)} can currently recreate safely.`);
      return;
    }
    setBusy(true);
    try {
      const result = await generateBookmakerCode(imageImport.provider, supported.map((match) => match.selection), true);
      const includedIds = new Set(result.resolved.map((item) => item.fixtureId));
      const selections = supported.filter((match) => includedIds.has(match.selection.fixtureId)).map((match, index) => ({ ...decodedSummary(match.selection, index), odds: result.resolved.find((item) => item.fixtureId === match.selection.fixtureId)?.odds ?? match.row.odds }));
      const unsupported = imageImport.matched.filter((match, index) => imageImport.selected[index] && !providerSupportsMarket(imageImport.provider, match.selection.marketKey));
      const card: CodeSummary = {
        provider: imageImport.provider,
        code: result.code,
        deepLink: result.deepLink,
        verified: result.verified,
        partial: result.partial || unsupported.length > 0 || imageImport.unmatched.length > 0,
        liveOdds: resolvedTotal(result.resolved),
        selections,
        unmatched: [
          ...result.unmatched,
          ...unsupported.map((match) => ({ homeTeam: match.fixture.homeTeam.name, awayTeam: match.fixture.awayTeam.name, reason: `${providerName(imageImport.provider)} does not support this market for automatic conversion.` })),
          ...imageImport.unmatched.map((row) => ({ homeTeam: row.homeTeam, awayTeam: row.awayTeam, reason: row.reason })),
        ],
        warning: result.warning,
      };
      conversation.current = { provider: imageImport.provider, code: result.code, selections, picks: [], decoded: supported.map((match) => match.selection), lastOutcome: null };
      addMessage("assistant", card.partial ? `I created a ${providerName(imageImport.provider)} code from every image selection I could verify. Review the omitted rows below.` : `Your ${providerName(imageImport.provider)} code from the image is ready.`, { kind: "codes", cards: [card] });
      setImageImport(null);
    } catch (error) {
      addMessage("assistant", friendlyBookmakerError(error, imageImport.provider, "create"));
    } finally {
      setBusy(false);
    }
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
    let resolved = applyConversationReference(resolveAssistantTurn(pending, value, referenceTime), conversation.current);
    if (!pending && /\b(?:what about|try|use|how about|same (?:thing|slip|odds?) (?:for|on)|instead (?:use|on))\b/i.test(value) && resolved.kind === "build" && !resolved.targetOdds && resolved.provider) {
      const previous = lastIntent.current;
      if (previous?.kind === "build" || previous?.kind === "best" || previous?.kind === "daily" || previous?.kind === "match") resolved = { ...previous, provider: resolved.provider };
    }
    void execute(resolved, referenceTime);
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
    setImageImport(null);
    conversation.current = { provider: null, code: null, selections: [], picks: [], decoded: [], lastOutcome: null };
    lastIntent.current = null;
    setInput("");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  return <main className="assistant-app">
    <ProductNavigation active={initialTool === "converter" ? "converter" : "home"} />
    <section className="assistant-shell">
      <header className="assistant-toolbar">
        <span><i aria-hidden="true" /> Live data</span>
        <button type="button" onClick={startNewChat}>New chat</button>
      </header>
      <section className={`assistant-workspace ${messages.length ? "has-messages" : ""}`} aria-label="OddsAura betting assistant">
        {initialTool === "converter" ? <section className="home-code-converter" aria-label="Booking code converter">
          <header><div><span>Code converter</span><h1>Move your bet.</h1></div><p>Paste once. OddsAura matches every available selection and clearly shows what was left out.</p></header>
          <ConverterForm embedded />
        </section> : <>
        {!messages.length && !busy ? <div className="assistant-welcome">
          <section className="assistant-welcome-card">
            <header><div><span>OddsAura assistant</span><h1>Today’s football,<br />made simpler.</h1></div><b>Live data</b></header>
            <p>Find fixtures by competition, compare supported markets, build bookmaker codes, or upload a prediction screenshot.</p>
            <div className="assistant-league-chips" aria-label="Browse competitions">
              {["Premier League matches", "Serie A matches", "Nations League matches", "Africa Cup of Nations matches", "International Friendlies"].map((prompt) => <button type="button" key={prompt} onClick={() => runPrompt(prompt)}>{prompt}</button>)}
            </div>
          </section>
        </div> : null}
        {messages.length || busy ? <div ref={threadRef} className="assistant-thread" aria-live="polite">
          {messages.map((message) => <article key={message.id} className={`assistant-message ${message.role}`}><div className="assistant-avatar" aria-hidden="true">{message.role === "assistant" ? "OA" : "You"}</div><div className="assistant-bubble"><p>{message.text}</p>{message.output ? <OutputView output={message.output} /> : null}</div></article>)}
          {readingImage ? <article className="assistant-message assistant" role="status" aria-live="polite"><div className="assistant-avatar" aria-hidden="true">OA</div><div className="assistant-bubble assistant-thinking"><i /><i /><i /><span>{ocrStatus || "Reading prediction image…"}</span></div></article> : null}
          {busy ? <article className="assistant-message assistant"><div className="assistant-avatar" aria-hidden="true">OA</div><div className="assistant-bubble assistant-thinking"><i /><i /><i /><span>Checking matches and bookmaker markets…</span></div></article> : null}
        </div> : null}
        {imageImport ? <section className="assistant-image-review" aria-label="Review predictions read from image">
          <header><div><span>Image review</span><b>{imageImport.fileName}</b></div><button type="button" onClick={() => setImageImport(null)} aria-label="Close image review">×</button></header>
          <div className="assistant-image-review-route"><label>Bookmaker<select value={imageImport.provider} onChange={(event) => setImageImport((current) => current ? { ...current, provider: event.target.value as ProviderId } : current)}>{providerAdapters.filter((provider) => provider.status === "live").map((provider) => <option value={provider.id} key={provider.id}>{provider.label}</option>)}</select></label><strong>{imageImport.selected.filter(Boolean).length} selected</strong></div>
          <div className="assistant-image-review-rows">{imageImport.matched.map((match, index) => <label key={`${match.fixture.id}-${index}`}><input type="checkbox" checked={imageImport.selected[index]} onChange={() => setImageImport((current) => current ? { ...current, selected: current.selected.map((selected, itemIndex) => itemIndex === index ? !selected : selected) } : current)} /><span><b>{match.fixture.homeTeam.name} vs {match.fixture.awayTeam.name}</b><small>{match.selection.marketName}: {match.selection.selection}</small></span><em>{match.row.odds?.toFixed(2) ?? "—"}</em></label>)}</div>
          {imageImport.unmatched.length ? <details><summary>{imageImport.unmatched.length} row{imageImport.unmatched.length === 1 ? "" : "s"} need review</summary>{imageImport.unmatched.map((row, index) => <p key={`${row.homeTeam}-${index}`}><b>{row.awayTeam ? `${row.homeTeam} vs ${row.awayTeam}` : row.homeTeam}</b><span>{row.marketText} · {row.reason}</span></p>)}</details> : null}
          <button className="assistant-image-create" type="button" onClick={() => void createImageCode()} disabled={busy || !imageImport.selected.some(Boolean)}>Create {providerName(imageImport.provider)} code</button>
        </section> : null}
        <div className="assistant-composer-dock">
          <form className="assistant-composer" onSubmit={submit}>
            <label htmlFor="assistant-request">Tell OddsAura what you want</label>
            <input ref={imageInputRef} className="assistant-image-input" type="file" accept="image/*" onChange={(event) => void importPredictionImage(event)} />
            <button className="assistant-attach" type="button" onClick={() => imageInputRef.current?.click()} disabled={busy || loading || readingImage} aria-label="Upload prediction screenshot"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17V3m0 0L7 8m5-5 5 5"/><path d="M5 13v6h14v-6"/></svg></button>
            <textarea ref={inputRef} id="assistant-request" rows={1} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={readingImage ? ocrStatus || "Reading prediction image…" : loading ? "Loading football data…" : "Ask OddsAura anything…"} disabled={busy || loading || readingImage} />
            <button className="assistant-send" type="submit" disabled={busy || loading || readingImage || !input.trim()} aria-label="Send request"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 14-7-4 14-3-6z" /><path d="m12 13 7-8" /></svg></button>
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
  const [saving, setSaving] = useState("");
  async function copy(value: string) { await navigator.clipboard.writeText(value); setCopied(value); window.setTimeout(() => setCopied(""), 1600); }
  async function save(provider: string, code: string, totalOdds: number | null, selections: SelectionSummary[]) {
    setSaving(code);
    try { await saveBetslipImage({ provider, code, totalOdds, selections }); }
    finally { setSaving(""); }
  }

  if (output.kind === "best") return <details className="assistant-expandable"><summary><span>{output.picks.length} best selections</span><b>Show</b></summary><div className="assistant-picks">{output.picks.map((pick, index) => <div key={pick.id}><span>#{index + 1}</span><div><b>{pick.match}</b><small>{pick.market}: {pick.selection}</small></div><strong>{pick.odds?.toFixed(2) ?? "—"}</strong></div>)}</div></details>;

  if (output.kind === "fixtures") {
    const groups = output.fixtures.reduce((map, fixture) => {
      const key = fixture.competition;
      map.set(key, [...(map.get(key) ?? []), fixture]);
      return map;
    }, new Map<string, FixtureSummary[]>());
    return <section className="assistant-fixtures">
      <header><span>Fixtures · {output.windowLabel}</span><b>{output.fixtures.length} matches</b></header>
      {[...groups].map(([competition, rows]) => <section key={competition} className="assistant-competition">
        <h3>{competition}<small>{rows[0]?.country ?? ""}</small></h3>
        {rows.map((fixture) => <div className="assistant-fixture-row" key={fixture.id}>
          <time dateTime={fixture.kickoff}>{new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(fixture.kickoff))}</time>
          <div><b>{fixture.homeTeam}</b><span>{fixture.status === "FINISHED" && fixture.homeScore != null && fixture.awayScore != null ? `${fixture.homeScore}–${fixture.awayScore}` : "vs"}</span><b>{fixture.awayTeam}</b></div>
        </div>)}
      </section>)}
    </section>;
  }

  if (output.kind === "daily") return <div className="assistant-daily-output">
    {output.tickets.map((ticket) => <section className="assistant-ticket-card" key={ticket.id}>
      <header><div><span>Ticket check</span><b>{ticket.title}</b></div><strong>{ticket.totalOdds == null ? "—" : formatOdds(ticket.totalOdds)}</strong></header>
      <small>{ticket.selections.length} picks · {ticket.status === "CODE_READY" ? "Verified code ready" : "Review required"}</small>
      <details className="assistant-output-details"><summary><span>{ticket.selections.length} selections</span><b>Show</b></summary>{ticket.selections.map((pick) => <SelectionRow key={pick.id} pick={pick} />)}</details>
      {ticket.bookingCodes.map((item) => <div className="assistant-inline-code" key={`${ticket.id}-${item.provider}`}><span>{item.provider}</span><b>{item.code}</b><button type="button" onClick={() => void copy(item.code)}>{copied === item.code ? "Copied ✓" : "Copy"}</button><button type="button" onClick={() => void save(providerName(item.provider), item.code, ticket.totalOdds, ticket.selections)}>{saving === item.code ? "Preparing…" : "Save image"}</button></div>)}
      {ticket.warning ? <p className="assistant-warning">{ticket.warning}</p> : null}
    </section>)}
    {output.watchlist.length ? <details className="assistant-watchlist assistant-expandable"><summary><span>{output.watchlist.length} qualified selections</span><b>Show</b></summary><div>{output.watchlist.map((pick) => <SelectionRow key={pick.id} pick={pick} />)}</div></details> : null}
  </div>;

  if (output.kind === "results") return <div className="assistant-results-output">
    <div className="assistant-result-summary"><span><b>{output.won}</b> Won</span><span><b>{output.lost}</b> Lost</span><span><b>{output.pending}</b> Pending</span></div>
    <div>{output.tickets.map((ticket) => <article key={ticket.id}><span className={`result-${ticket.status.toLowerCase()}`}>{ticket.status.replaceAll("_", " ")}</span><div><b>{ticket.title}</b><small>{ticket.publishedAt ? new Date(ticket.publishedAt).toLocaleDateString() : "Tracked ticket"} · {ticket.selections} picks</small></div><strong>{formatOdds(ticket.totalOdds)}</strong></article>)}</div>
  </div>;

  if (output.kind === "analysis") return <section className="assistant-analysis">
    <header><div><span>Slip assessment</span><b>{output.risk === "UNKNOWN" ? "NOT ENOUGH DATA" : `${output.risk} RISK`}</b></div><strong>{output.totalOdds == null ? `${output.selections.length} picks` : formatOdds(output.totalOdds)}</strong></header>
    <div className="assistant-analysis-preview">{output.selections.slice(0, 3).map((pick) => <SelectionRow key={pick.id} pick={pick} detailed />)}</div>
    {output.selections.length > 3 ? <details className="assistant-output-details"><summary><span>View all {output.selections.length} selections</span><b>Show</b></summary>{output.selections.slice(3).map((pick) => <SelectionRow key={pick.id} pick={pick} detailed />)}</details> : null}
    {output.warning ? <p className="assistant-warning">{output.warning}</p> : null}
  </section>;

  if (output.kind === "explanation") return <section className="assistant-analysis assistant-explanation">
    <header><div><span>Why this option</span><b>{output.selected.match}</b></div><strong>{output.selected.odds?.toFixed(2) ?? "—"}</strong></header>
    <SelectionRow pick={output.selected} detailed />
    {output.alternatives.length ? <details className="assistant-output-details"><summary><span>{output.alternatives.length} alternatives considered</span><b>Compare</b></summary>{output.alternatives.map(pick => <SelectionRow key={pick.id} pick={pick} detailed />)}</details> : null}
  </section>;

  return <div className="assistant-code-grid">{output.cards.map((card, index) => <section className="assistant-code-card" key={`${card.provider}-${index}`}>
    <header><div><span>{providerName(card.provider)} {output.cards.length > 1 ? `code ${index + 1}` : "code"}</span>{card.code ? <strong>{card.code}</strong> : <strong className="unavailable">Not created</strong>}</div>{card.liveOdds ? <b>{formatOdds(card.liveOdds)}</b> : card.estimatedOdds ? <b>{formatOdds(card.estimatedOdds)}</b> : null}</header>
    {card.code ? <div className="assistant-code-actions"><button type="button" onClick={() => void copy(card.code!)}>{copied === card.code ? "Copied ✓" : "Copy code"}</button><button type="button" onClick={() => void save(providerName(card.provider), card.code!, card.liveOdds ?? card.estimatedOdds ?? null, card.selections)}>{saving === card.code ? "Preparing…" : "Save betslip"}</button>{card.deepLink ? <a href={card.deepLink} target="_blank" rel="noreferrer">Open {providerName(card.provider)} ↗</a> : null}</div> : card.deepLink ? <a className="assistant-open-manual" href={card.deepLink} target="_blank" rel="noreferrer">Open {providerName(card.provider)} ↗</a> : null}
    <details className="assistant-output-details"><summary><span>{card.selections.length} {card.code ? "included" : "proposed"} {card.selections.length === 1 ? "selection" : "selections"}</span><b>Show</b></summary>{card.selections.map((pick) => <SelectionRow key={pick.id} pick={pick} />)}</details>
    {card.unmatched?.length ? <details className="assistant-unmatched assistant-output-details"><summary><span>{card.unmatched.length} not included</span><b>Show</b></summary>{card.unmatched.map((row, rowIndex) => <p key={`${row.homeTeam}-${rowIndex}`}><b>{row.homeTeam} vs {row.awayTeam}</b><span>{row.reason}</span></p>)}</details> : null}
    {card.warning ? <p className="assistant-warning">{card.warning}</p> : null}
  </section>)}</div>;
}

function SelectionRow({ pick, detailed = false }: { pick: SelectionSummary; detailed?: boolean }) {
  return <div className="assistant-selection"><div><b>{pick.match}</b><small>{pick.market}: {pick.selection}</small>{detailed && pick.confidence != null ? <em>{Math.round(pick.confidence * 100)}% confidence</em> : null}</div><strong>{pick.odds?.toFixed(2) ?? "—"}</strong></div>;
}
