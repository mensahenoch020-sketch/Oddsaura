import type { FastifyInstance, FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import { config } from "../config.js";

export async function authPlugin(app: FastifyInstance) {
  await app.register(fastifyJwt, { secret: config.JWT_SECRET });
  app.decorate("requireAdmin", async function requireAdmin(request: FastifyRequest) {
    await request.jwtVerify();
    if (request.user.role !== "ADMIN") {
      const error = new Error("Administrator access required") as Error & { statusCode?: number };
      error.statusCode = 403;
      throw error;
    }
  });
}

declare module "fastify" {
  interface FastifyInstance {
    requireAdmin(request: FastifyRequest): Promise<void>;
  }
}
