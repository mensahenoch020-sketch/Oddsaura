import cron from "node-cron";
import type { FastifyBaseLogger } from "fastify";
import { config } from "../../config.js";
import { runPredictionEngine, syncFootballData } from "../data/sync.js";

let running = false;

export function startScheduler(log: FastifyBaseLogger) {
  cron.schedule(config.SYNC_CRON, async () => {
    if (running) return;
    running = true;
    try {
      const sync = await syncFootballData();
      const predictions = sync.skipped ? null : await runPredictionEngine();
      log.info({ sync, predictions }, "Scheduled football refresh completed");
    } catch (error) {
      log.error(error, "Scheduled football refresh failed");
    } finally {
      running = false;
    }
  });
}
