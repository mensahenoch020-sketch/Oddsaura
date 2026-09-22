import type { ProviderId } from "../builder/providers";
import { interpretAssistantRequest, type AssistantIntent } from "./nlu";

export type PendingIntent = Extract<AssistantIntent, { kind: "build" | "split" | "convert" | "analyze" }>;

export type ConversationReference = { provider: ProviderId | null; code: string | null };

export function applyConversationReference(intent: AssistantIntent, reference: ConversationReference): AssistantIntent {
  if (intent.kind === "analyze" && !intent.code && reference.code) return { ...intent, code: reference.code, provider: intent.provider ?? reference.provider };
  if (intent.kind === "split" && !intent.code && reference.code) return { ...intent, code: reference.code, provider: intent.provider ?? reference.provider };
  if (intent.kind === "convert" && !intent.code && reference.code) return { ...intent, code: reference.code, sourceProvider: intent.sourceProvider ?? reference.provider };
  return intent;
}

function providerFromIntent(intent: AssistantIntent): ProviderId | null {
  if ("provider" in intent) return intent.provider;
  if (intent.kind === "convert") return intent.sourceProvider ?? intent.destinationProvider;
  return null;
}

export function isCompleteStandalone(intent: AssistantIntent) {
  if (intent.kind === "build") return Boolean(intent.targetOdds && intent.provider);
  if (intent.kind === "split") return Boolean((intent.code || intent.targetOdds) && intent.parts && intent.provider);
  if (intent.kind === "convert") return Boolean(intent.code && intent.sourceProvider && intent.destinationProvider && intent.sourceProvider !== intent.destinationProvider);
  if (intent.kind === "analyze") return Boolean(intent.code && intent.provider);
  return intent.kind !== "unknown";
}

export function mergePendingIntent(pending: PendingIntent, input: string, referenceTime = Date.now()): AssistantIntent {
  const next = interpretAssistantRequest(pending.kind === "convert" ? `convert ${input}` : input, referenceTime);
  const nextProvider = providerFromIntent(next);
  if (pending.kind === "build") {
    const candidate = next.kind === "build" ? next : null;
    return { ...pending, targetOdds: candidate?.targetOdds ?? pending.targetOdds, provider: nextProvider ?? pending.provider, dateWindow: candidate?.dateWindow ?? pending.dateWindow, marketKeys: candidate?.marketKeys ?? pending.marketKeys, leagueFilters: candidate?.leagueFilters ?? pending.leagueFilters, confidence: Math.max(pending.confidence, next.confidence) };
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
      provider: nextProvider ?? pending.provider,
      dateWindow: candidate && "dateWindow" in candidate ? candidate.dateWindow ?? pending.dateWindow : pending.dateWindow,
      marketKeys: candidate?.marketKeys ?? pending.marketKeys,
      leagueFilters: candidate && "leagueFilters" in candidate ? candidate.leagueFilters ?? pending.leagueFilters : pending.leagueFilters,
      confidence: Math.max(pending.confidence, next.confidence),
    };
  }
  if (pending.kind === "convert") {
    const candidate = next.kind === "convert" ? next : null;
    const candidates = [...new Set([candidate?.sourceProvider, candidate?.destinationProvider, nextProvider].filter((item): item is ProviderId => item != null))];
    const firstMentioned = candidates[0] ?? null;
    const secondMentioned = candidates[1] ?? null;
    const sourceProvider = pending.sourceProvider ?? (!pending.destinationProvider && candidates.length === 1 ? firstMentioned : candidate?.sourceProvider ?? null);
    const destinationProvider = pending.destinationProvider ?? (pending.sourceProvider && candidates.length === 1 ? firstMentioned : secondMentioned ?? (candidates.length > 1 ? candidate?.destinationProvider ?? null : null));
    return { ...pending, code: candidate?.code ?? pending.code, sourceProvider, destinationProvider, confidence: Math.max(pending.confidence, next.confidence) };
  }
  const candidate = next.kind === "analyze" ? next : next.kind === "convert" ? next : null;
  return { ...pending, code: candidate && "code" in candidate ? candidate.code ?? pending.code : pending.code, provider: nextProvider ?? pending.provider, confidence: Math.max(pending.confidence, next.confidence) };
}

export function resolveAssistantTurn(pending: PendingIntent | null, input: string, referenceTime = Date.now()) {
  const interpreted = interpretAssistantRequest(input, referenceTime);
  if (!pending) return interpreted;
  if (interpreted.kind !== pending.kind && isCompleteStandalone(interpreted)) return interpreted;
  return mergePendingIntent(pending, input, referenceTime);
}
