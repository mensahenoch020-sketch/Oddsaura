import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BOOKMAKER_IDS, BookmakerIntegrationError, createBookmakerCode, convertBookmakerCode, type BookmakerId } from "./controller.js";

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
});

export async function providerRoutes(app: FastifyInstance) {
  app.post("/api/providers/convert", async (request, reply) => {
    const body = z.object({ sourceProvider: z.enum(BOOKMAKER_IDS), destinationProvider: z.enum(BOOKMAKER_IDS), code: z.string().min(4).max(16), allowPartial: z.boolean().optional() }).parse(request.body);
    try {
      return { verified: true, ...await convertBookmakerCode(body.sourceProvider, body.destinationProvider, body.code, fetch, false) };
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
}
