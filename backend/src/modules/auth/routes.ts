import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });

export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }
    const token = await reply.jwtSign({ sub: user.id, email: user.email, role: user.role }, { expiresIn: "12h" });
    return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  });

  app.get("/api/auth/me", { preHandler: [app.requireAdmin] }, async (request) => ({ user: request.user }));
}
