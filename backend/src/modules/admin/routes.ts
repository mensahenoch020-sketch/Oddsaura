import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { runPredictionEngine, syncFootballData } from "../data/sync.js";
import { buildTicket, type TicketBand } from "../prediction/ticket-builder.js";

const ticketInclude = {
  bookingCodes: true,
  selections: { orderBy: { position: "asc" as const }, include: { prediction: { include: { fixture: { include: { homeTeam: true, awayTeam: true, league: true } } } } } },
};

const createTicketSchema = z.object({
  title: z.string().min(3),
  category: z.enum(["SAFE", "BALANCED", "HIGH_RISK"]),
  predictionIds: z.array(z.string()).min(2),
  expiresAt: z.coerce.date(),
  bookingCodes: z.array(z.object({ provider: z.string().min(2), code: z.string().min(2), deepLink: z.string().url().optional() })).default([]),
});

const patchTicketSchema = z.object({
  title: z.string().min(3).optional(),
  category: z.enum(["SAFE", "BALANCED", "HIGH_RISK"]).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "EXPIRED", "ARCHIVED"]).optional(),
  expiresAt: z.coerce.date().optional(),
  bookingCodes: z.array(z.object({ provider: z.string().min(2), code: z.string().min(2), deepLink: z.string().url().nullable().optional(), active: z.boolean().default(true) })).optional(),
});

async function createFromPredictions(input: z.infer<typeof createTicketSchema>) {
  const predictions = await prisma.prediction.findMany({ where: { id: { in: input.predictionIds } } });
  if (predictions.length !== input.predictionIds.length) throw Object.assign(new Error("One or more predictions were not found"), { statusCode: 400 });
  if (predictions.some((item) => !item.recommendedOdds)) throw Object.assign(new Error("Every ticket prediction requires bookmaker odds"), { statusCode: 400 });
  const totalOdds = predictions.reduce((total, item) => total * (item.recommendedOdds ?? 1), 1);
  const confidence = predictions.reduce((total, item) => total + item.confidenceScore, 0) / predictions.length;
  return prisma.ticket.create({
    data: {
      title: input.title,
      category: input.category,
      totalOdds: Number(totalOdds.toFixed(2)),
      confidence,
      expiresAt: input.expiresAt,
      selections: { create: input.predictionIds.map((predictionId, position) => ({ predictionId, position, oddsSnapshot: predictions.find((item) => item.id === predictionId)?.recommendedOdds ?? 1 })) },
      bookingCodes: { create: input.bookingCodes },
    },
    include: ticketInclude,
  });
}

export async function adminRoutes(app: FastifyInstance) {
  const admin = { preHandler: [app.requireAdmin] };

  app.get("/api/admin/overview", admin, async () => {
    const [fixtures, predictions, draftTickets, publishedTickets, users] = await Promise.all([
      prisma.fixture.count({ where: { kickoff: { gt: new Date() }, status: "SCHEDULED" } }),
      prisma.prediction.count({ where: { status: "CANDIDATE" } }),
      prisma.ticket.count({ where: { status: "DRAFT" } }),
      prisma.ticket.count({ where: { status: "PUBLISHED", expiresAt: { gt: new Date() } } }),
      prisma.user.count(),
    ]);
    return { fixtures, predictions, draftTickets, publishedTickets, users };
  });

  app.get("/api/admin/tickets", admin, async () => ({ tickets: await prisma.ticket.findMany({ include: ticketInclude, orderBy: { createdAt: "desc" } }) }));

  app.post("/api/admin/tickets", admin, async (request, reply) => {
    const ticket = await createFromPredictions(createTicketSchema.parse(request.body));
    return reply.code(201).send({ ticket });
  });

  app.patch("/api/admin/tickets/:id", admin, async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = patchTicketSchema.parse(request.body);
    const { bookingCodes, ...ticketData } = body;
    const data: Record<string, unknown> = { ...ticketData };
    if (bookingCodes) {
      data.bookingCodes = {
        upsert: bookingCodes.map((item) => ({
          where: { ticketId_provider: { ticketId: id, provider: item.provider } },
          update: { code: item.code, deepLink: item.deepLink, active: item.active },
          create: { provider: item.provider, code: item.code, deepLink: item.deepLink, active: item.active },
        })),
      };
    }
    const ticket = await prisma.ticket.update({ where: { id }, data, include: ticketInclude });
    return { ticket };
  });

  app.post("/api/admin/tickets/:id/publish", admin, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const current = await prisma.ticket.findUnique({ where: { id }, include: { bookingCodes: { where: { active: true } } } });
    if (!current) return reply.code(404).send({ error: "Ticket not found" });
    const ticket = await prisma.ticket.update({ where: { id }, data: { status: "PUBLISHED", publishedAt: new Date() }, include: ticketInclude });
    return { ticket, warning: current.bookingCodes.length ? null : "Published without a bookmaker booking code" };
  });

  app.post("/api/admin/tickets/:id/unpublish", admin, async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    return { ticket: await prisma.ticket.update({ where: { id }, data: { status: "DRAFT", publishedAt: null }, include: ticketInclude }) };
  });

  app.delete("/api/admin/tickets/:id", admin, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    await prisma.ticket.delete({ where: { id } });
    return reply.code(204).send();
  });

  app.post("/api/admin/sync", admin, async () => ({ sync: await syncFootballData() }));
  app.post("/api/admin/predictions/run", admin, async () => ({ predictions: await runPredictionEngine() }));

  app.post("/api/admin/tickets/generate", admin, async () => {
    const predictions = await prisma.prediction.findMany({
      where: { status: "CANDIDATE", recommendedOdds: { not: null }, fixture: { kickoff: { gt: new Date(), lt: new Date(Date.now() + 4 * 86_400_000) }, status: "SCHEDULED" } },
      include: { fixture: true },
      orderBy: { confidenceScore: "desc" },
    });
    const candidates = predictions.map((item) => ({ predictionId: item.id, fixtureId: item.fixtureId, probability: item.modelProbability, confidence: item.confidenceScore, odds: item.recommendedOdds ?? 1 }));
    const created: unknown[] = [];
    for (const band of ["SAFE", "BALANCED", "HIGH_RISK"] as TicketBand[]) {
      const generated = buildTicket(candidates, band);
      if (!generated.valid) continue;
      const category = band;
      const expiry = Math.min(...generated.selections.map((selection) => predictions.find((item) => item.id === selection.predictionId)?.fixture.kickoff.getTime() ?? Date.now() + 86_400_000));
      created.push(await prisma.ticket.create({
        data: {
          title: band === "SAFE" ? "Safe 2–3 Odds" : band === "BALANCED" ? "Balanced 5–10 Odds" : "High Risk",
          category,
          totalOdds: generated.totalOdds,
          confidence: generated.confidence,
          expiresAt: new Date(expiry),
          selections: { create: generated.selections.map((item, position) => ({ predictionId: item.predictionId, oddsSnapshot: item.odds, position })) },
        },
        include: ticketInclude,
      }));
    }
    return { tickets: created };
  });
}
