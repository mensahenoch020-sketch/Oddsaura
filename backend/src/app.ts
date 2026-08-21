import Fastify from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { config } from "./config.js";
import { authPlugin } from "./plugins/auth.js";
import { authRoutes } from "./modules/auth/routes.js";
import { fixtureRoutes } from "./modules/fixtures/routes.js";
import { ticketRoutes } from "./modules/tickets/routes.js";
import { adminRoutes } from "./modules/admin/routes.js";
import { providerRoutes } from "./modules/providers/routes.js";

export async function buildApp() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: config.CORS_ORIGIN.split(",").map((item) => item.trim()), credentials: true });
  await authPlugin(app);

  app.setErrorHandler((error: unknown, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed", details: error.issues });
    const typed = error as Error & { statusCode?: number };
    const statusCode = typeof typed.statusCode === "number" ? typed.statusCode : 500;
    if (statusCode >= 500) app.log.error(error);
    return reply.code(statusCode).send({ error: statusCode >= 500 ? "Internal server error" : typed.message });
  });

  app.get("/api/health", async () => ({ ok: true, service: "oddsaura-api", time: new Date().toISOString() }));
  await app.register(authRoutes);
  await app.register(fixtureRoutes);
  await app.register(ticketRoutes);
  await app.register(adminRoutes);
  await app.register(providerRoutes);
  return app;
}
