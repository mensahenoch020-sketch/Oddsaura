import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";

const includeTicket = {
  bookingCodes: { where: { active: true } },
  selections: {
    orderBy: { position: "asc" as const },
    include: { prediction: { include: { fixture: { include: { league: true, homeTeam: true, awayTeam: true } } } } },
  },
};

export async function ticketRoutes(app: FastifyInstance) {
  app.get("/api/tickets", async (request) => {
    const query = z.object({ category: z.enum(["SAFE", "BALANCED", "HIGH_RISK"]).optional() }).parse(request.query);
    const tickets = await prisma.ticket.findMany({
      where: { status: "PUBLISHED", expiresAt: { gt: new Date() }, ...(query.category ? { category: query.category } : {}) },
      include: includeTicket,
      orderBy: { publishedAt: "desc" },
    });
    return { tickets };
  });

  app.get("/api/tickets/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const ticket = await prisma.ticket.findFirst({ where: { id, status: "PUBLISHED" }, include: includeTicket });
    if (!ticket) return reply.code(404).send({ error: "Ticket not found" });
    return { ticket };
  });
}
