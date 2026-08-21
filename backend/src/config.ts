import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGIN: z.string().default("http://localhost:3001"),
  FOOTBALL_API_KEY: z.string().optional(),
  FOOTBALL_API_BASE_URL: z.string().url().default("https://v3.football.api-sports.io"),
  FOOTBALL_LEAGUES: z.string().default("39:2026,140:2026,135:2026,78:2026,61:2026"),
  SYNC_CRON: z.string().default("*/30 * * * *"),
  PREDICTION_CONFIDENCE_MIN: z.coerce.number().min(0).max(1).default(0.62),
  PREDICTION_EDGE_MIN: z.coerce.number().min(0).max(1).default(0.03),
});

export const config = schema.parse(process.env);

export const configuredLeagues = config.FOOTBALL_LEAGUES.split(",").map((item) => {
  const [league, season] = item.trim().split(":").map(Number);
  if (!league || !season) throw new Error(`Invalid FOOTBALL_LEAGUES entry: ${item}`);
  return { league, season };
});
