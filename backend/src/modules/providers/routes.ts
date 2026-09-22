import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BOOKMAKER_IDS, BookmakerIntegrationError, createBookmakerCode, convertBookmakerCode, inspectBookmakerCode, providerHealthReport, type BookmakerId } from "./controller.js";
import { expandProviderMarkets, type ExpansionCandidate } from "./market-expansion.js";

const selection = z.object({
  fixtureId: z.string().min(1),
  homeTeam: z.string().min(1),
  awayTeam: z.string().min(1),
  kickoff: z.string().min(1),
  marketKey: z.string().min(1),
  marketName: z.string().min(1),
  selection: z.string().min(1),
  line: z.number().nullable().optional(),
  providerEventId: z.string().nullable().optional(),
  providerMarketId: z.string().nullable().optional(),
  providerOutcomeId: z.string().nullable().optional(),
  providerSpecifier: z.string().nullable().optional(),
  quotedOdds: z.number().gt(1).nullable().optional(),
});

export async function providerRoutes(app: FastifyInstance) {
  app.get("/api/providers/health", async () => ({ providers: providerHealthReport(), scope: "latest operation on this server instance" }));

  app.post("/api/providers/:provider/decode", async (request, reply) => {
    const provider = z.enum(BOOKMAKER_IDS).parse((request.params as { provider?: string }).provider) as BookmakerId;
    const body = z.object({ code: z.string().min(4).max(16) }).parse(request.body);
    try {
      return await inspectBookmakerCode(provider, body.code, fetch);
    } catch (error) {
      if (error instanceof BookmakerIntegrationError) return reply.code(error.status).send({ error: error.message, details: error.details });
      throw error;
    }
  });

  app.post("/api/providers/convert", async (request, reply) => {
    const body = z.object({ sourceProvider: z.enum(BOOKMAKER_IDS), destinationProvider: z.enum(BOOKMAKER_IDS), code: z.string().min(4).max(16), allowPartial: z.boolean().optional() }).parse(request.body);
    try {
      return { verified: true, ...await convertBookmakerCode(body.sourceProvider, body.destinationProvider, body.code, fetch, body.allowPartial ?? false) };
    } catch (error) {
      if (error instanceof BookmakerIntegrationError) return reply.code(error.status).send({ error: error.message, details: error.details });
      throw error;
    }
  });

  app.post("/api/providers/:provider/code", async (request, reply) => {
    const provider = z.enum(BOOKMAKER_IDS).parse((request.params as { provider?: string }).provider) as BookmakerId;
    const body = z.object({ selections: z.array(selection).min(1).max(50), allowPartial: z.boolean().optional() }).parse(request.body);
    try {
      return { provider, verified: true, ...await createBookmakerCode(provider, body.selections, fetch, body.allowPartial ?? false) };
    } catch (error) {
      if (error instanceof BookmakerIntegrationError) return reply.code(error.status).send({ error: error.message, details: error.details });
      throw error;
    }
  });

  app.post("/api/providers/:provider/expand", async (request, reply) => {
    const provider = z.enum(BOOKMAKER_IDS).parse((request.params as { provider?: string }).provider) as BookmakerId;
    const body = z.object({
      start: z.string().datetime(),
      end: z.string().datetime(),
      marketKeys: z.array(z.string().min(1)).max(40).optional(),
      fixtureLimit: z.number().int().min(1).max(80).optional(),
    }).parse(request.body);
    const start = Date.parse(body.start), end = Date.parse(body.end);
    if (end <= start || end - start > 8 * 86_400_000) return reply.code(400).send({ error: "Choose a valid period of no more than eight days." });
    try {
      const paths = [resolve(process.cwd(), "data/public/expansion.json"), resolve(process.cwd(), "../data/public/expansion.json")];
      let payload: { candidates?: ExpansionCandidate[] } | null = null;
      for (const path of paths) {
        try { payload = JSON.parse(await readFile(path, "utf8")); break; } catch { /* try the next deployment layout */ }
      }
      if (!payload) return reply.code(503).send({ error: "The expanded prediction pool has not been published yet." });
      const allowed = body.marketKeys?.length ? new Set(body.marketKeys) : null;
      const candidates = (payload.candidates ?? []).filter(candidate => Date.parse(candidate.kickoff) >= start && Date.parse(candidate.kickoff) < end && (!allowed || allowed.has(candidate.key)));
      return await expandProviderMarkets(provider, candidates, fetch, body.fixtureLimit ?? 40);
    } catch (error) {
      if (error instanceof BookmakerIntegrationError) return reply.code(error.status).send({ error: error.message, details: error.details });
      return reply.code(502).send({ error: "The live bookmaker expansion could not finish. The saved verified pool is still available." });
    }
  });
}
