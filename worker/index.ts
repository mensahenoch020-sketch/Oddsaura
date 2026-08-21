/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { createSportyBetCode, SportyBetIntegrationError, type SportyBetSelectionInput } from "../backend/src/modules/providers/sportybet";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

function accountIdentity(request: Request) {
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (!email) return null;
  const encoded = request.headers.get("oai-authenticated-user-full-name");
  let name = email;
  if (encoded && request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8") {
    try { name = decodeURIComponent(encoded); } catch { name = email; }
  }
  return { email, name };
}

async function ensureAccountTables(db: D1Database) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY NOT NULL, display_name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS saved_slips (id TEXT PRIMARY KEY NOT NULL, user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE, name TEXT NOT NULL, picks_json TEXT NOT NULL, created_at INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS saved_slips_user_created_idx ON saved_slips (user_email, created_at)"),
  ]);
}

async function accountApi(request: Request, env: Env, url: URL) {
  const identity = accountIdentity(request);
  if (!identity) return Response.json({ error: "Sign in to use your OddsAura account." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "Account storage is not ready yet." }, { status: 503 });
  await ensureAccountTables(env.DB);
  const now = Date.now();
  await env.DB.prepare("INSERT INTO users (email, display_name, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at")
    .bind(identity.email, identity.name, now, now).run();

  if (url.pathname === "/api/account" && request.method === "GET") return Response.json({ user: identity });
  if (url.pathname === "/api/slips" && request.method === "GET") {
    const rows = await env.DB.prepare("SELECT id, name, picks_json AS picksJson, created_at AS createdAt FROM saved_slips WHERE user_email = ? ORDER BY created_at DESC LIMIT 50")
      .bind(identity.email).all();
    return Response.json({ slips: rows.results.map((row) => ({ ...row, picks: JSON.parse(String(row.picksJson)), picksJson: undefined })) });
  }
  if (url.pathname === "/api/slips" && request.method === "POST") {
    const body = await request.json() as { name?: string; picks?: unknown[] };
    if (!Array.isArray(body.picks) || body.picks.length < 1 || body.picks.length > 50) return Response.json({ error: "Save between 1 and 50 picks." }, { status: 400 });
    const payload = JSON.stringify(body.picks);
    if (payload.length > 60_000) return Response.json({ error: "This slip is too large to save." }, { status: 400 });
    const id = crypto.randomUUID();
    const name = String(body.name || `Prediction slip · ${new Date(now).toISOString().slice(0, 10)}`).slice(0, 80);
    await env.DB.prepare("INSERT INTO saved_slips (id, user_email, name, picks_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, identity.email, name, payload, now).run();
    return Response.json({ id, name, createdAt: now }, { status: 201 });
  }
  if (url.pathname.startsWith("/api/slips/") && request.method === "DELETE") {
    const id = decodeURIComponent(url.pathname.slice("/api/slips/".length));
    await env.DB.prepare("DELETE FROM saved_slips WHERE id = ? AND user_email = ?").bind(id, identity.email).run();
    return Response.json({ deleted: true });
  }
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/account" || url.pathname === "/api/slips" || url.pathname.startsWith("/api/slips/")) {
      return accountApi(request, env, url);
    }

    if (url.pathname === "/api/sportybet/code") {
      if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: { allow: "POST" } });
      try {
        const body = await request.json() as { selections?: SportyBetSelectionInput[]; allowPartial?: boolean };
        const result = await createSportyBetCode(body.selections ?? [], fetch, body.allowPartial ?? false);
        return Response.json({ provider: "sportybet", verified: true, ...result }, { headers: { "cache-control": "no-store" } });
      } catch (error) {
        const typed = error instanceof SportyBetIntegrationError ? error : new SportyBetIntegrationError("SportyBet code creation failed.", 502);
        return Response.json({ error: typed.message, details: typed.details }, { status: typed.status, headers: { "cache-control": "no-store" } });
      }
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
