import "dotenv/config";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./lib/prisma.js";
import { startScheduler } from "./modules/jobs/scheduler.js";

const app = await buildApp();
await app.listen({ host: "0.0.0.0", port: config.PORT });
startScheduler(app.log);

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
