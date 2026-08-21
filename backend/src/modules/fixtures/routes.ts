import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";

export async function fixtureRoutes(app: FastifyInstance) {
  app.get("/api/fixtures", async (request) => {
    const query = z.object({ from: z.string().optional(), to: z.string().optional(), league: z.string().optional() }).parse(request.query);
    const from = query.from ? new Date(query.from) : new Date();
    const to = query.to ? new Date(query.to) : new Date(Date.now() + 7 * 86_400_000);
    const fixtures = await prisma.fixture.findMany({
      where: { kickoff: { gte: from, lte: to }, ...(query.league ? { leagueId: query.league } : {}) },
      include: { league: true, homeTeam: true, awayTeam: true, odds: { orderBy: { collectedAt: "desc" }, take: 20 } },
      orderBy: { kickoff: "asc" },
    });
    return { fixtures };
  });
}
