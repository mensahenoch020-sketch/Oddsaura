/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { BookmakerIntegrationError, createBookmakerCode, type BookmakerId } from "../backend/src/modules/providers/controller";
import { decodeBookmakerCode } from "../backend/src/modules/providers/decoder";
import type { SportyBetSelectionInput } from "../backend/src/modules/providers/sportybet";

interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  ODDSAURA_ADMIN_EMAILS?: string;
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

type AccountIdentity = { email: string; name: string; role: "USER" | "ADMIN" };

const SESSION_COOKIE = "oa_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
// Cloudflare Workers currently caps Web Crypto PBKDF2 at 100,000 rounds.
// Store the iteration count in the hash so existing hashes remain verifiable
// if this value changes in a future runtime.
const PASSWORD_ITERATIONS = 100_000;
const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomToken(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

async function digest(value: string) {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

async function passwordHash(password: string) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PASSWORD_ITERATIONS }, key, 256);
  return `pbkdf2$${PASSWORD_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(new Uint8Array(bits))}`;
}

async function passwordMatches(password: string, stored: string | null) {
  if (!stored) return false;
  const [scheme, iterationsText, saltText, expected] = stored.split("$");
  if (scheme !== "pbkdf2" || !iterationsText || !saltText || !expected) return false;
  const iterations = Number(iterationsText);
  if (!Number.isInteger(iterations) || iterations < 100_000) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromBase64Url(saltText), iterations }, key, 256);
  const actual = toBase64Url(new Uint8Array(bits));
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function sessionCookie(request: Request, value: string, maxAge: number) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function normalizeEmail(value: unknown) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function validPassword(value: unknown) {
  const password = String(value || "");
  return password.length >= 8 && password.length <= 128 ? password : null;
}

async function requestJson(request: Request) {
  try { return await request.json() as Record<string, unknown>; } catch { return {}; }
}

async function ensureAccountTables(db: D1Database) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY NOT NULL, display_name TEXT NOT NULL, password_hash TEXT, role TEXT NOT NULL DEFAULT 'USER', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY NOT NULL, user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS sessions_user_expires_idx ON sessions (user_email, expires_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS password_reset_tokens (token_hash TEXT PRIMARY KEY NOT NULL, user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE, expires_at INTEGER NOT NULL, used_at INTEGER, created_at INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS password_reset_user_expires_idx ON password_reset_tokens (user_email, expires_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS saved_slips (id TEXT PRIMARY KEY NOT NULL, user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE, name TEXT NOT NULL, picks_json TEXT NOT NULL, created_at INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS saved_slips_user_created_idx ON saved_slips (user_email, created_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS generated_codes (id TEXT PRIMARY KEY NOT NULL, user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE, provider TEXT NOT NULL, code TEXT NOT NULL, deep_link TEXT, selections_json TEXT NOT NULL, created_at INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS generated_codes_user_created_idx ON generated_codes (user_email, created_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS code_request_events (id TEXT PRIMARY KEY NOT NULL, user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE, request_hash TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS code_request_events_user_created_idx ON code_request_events (user_email, created_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS sportybet_code_cache (request_hash TEXT PRIMARY KEY NOT NULL, response_json TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS sportybet_code_cache_expires_idx ON sportybet_code_cache (expires_at)"),
  ]);
}

async function createSession(request: Request, db: D1Database, email: string, maxAge = SESSION_SECONDS) {
  const rawToken = randomToken();
  const tokenHash = await digest(rawToken);
  const now = Date.now();
  await db.prepare("INSERT INTO sessions (token_hash, user_email, expires_at, created_at) VALUES (?, ?, ?, ?)").bind(tokenHash, email, now + maxAge * 1000, now).run();
  return sessionCookie(request, rawToken, maxAge);
}

async function sessionIdentity(request: Request, env: Env): Promise<AccountIdentity | null> {
  if (!env.DB) {
    const email = request.headers.get("x-oddsaura-user-email")?.trim().toLowerCase();
    const name = request.headers.get("x-oddsaura-user-name")?.trim();
    const admins = new Set(String(env.ODDSAURA_ADMIN_EMAILS || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
    return email ? { email, name: name || email, role: admins.has(email) ? "ADMIN" : "USER" } : null;
  }
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  await ensureAccountTables(env.DB);
  const row = await env.DB.prepare("SELECT users.email AS email, users.display_name AS name, users.role AS role FROM sessions JOIN users ON users.email = sessions.user_email WHERE sessions.token_hash = ? AND sessions.expires_at > ? LIMIT 1").bind(await digest(token), Date.now()).first<{ email: string; name: string; role: "USER" | "ADMIN" }>();
  if (!row) return null;
  const admins = new Set(String(env.ODDSAURA_ADMIN_EMAILS || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
  return { email: row.email, name: row.name, role: row.role === "ADMIN" || admins.has(row.email) ? "ADMIN" : "USER" };
}

async function sendResetEmail(request: Request, env: Env, email: string, token: string) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) return false;
  const resetUrl = new URL(`/reset-password?token=${encodeURIComponent(token)}`, request.url).toString();
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ from: env.RESEND_FROM_EMAIL, to: [email], subject: "Reset your OddsAura password", html: `<div style="font-family:Arial,sans-serif;color:#0b1426"><h1>Reset your OddsAura password</h1><p>This link expires in 30 minutes.</p><p><a href="${resetUrl}">Choose a new password</a></p><p>If you did not request this, you can ignore this email.</p></div>` }) });
  return response.ok;
}

async function authApi(request: Request, env: Env, url: URL) {
  if (!env.DB) return Response.json({ error: "Account storage is unavailable on this host." }, { status: 503 });
  await ensureAccountTables(env.DB);
  const body = request.method === "POST" || request.method === "PATCH" ? await requestJson(request) : {};
  const now = Date.now();

  if (url.pathname === "/api/auth/signup" && request.method === "POST") {
    const email = normalizeEmail(body.email); const password = validPassword(body.password); const name = String(body.name || "").trim().slice(0, 60);
    if (!email || !password || name.length < 2 || body.password !== body.confirmPassword || body.acceptedTerms !== true) return Response.json({ error: "Enter a valid name, email and matching password, then accept the terms." }, { status: 400 });
    const existing = await env.DB.prepare("SELECT email FROM users WHERE email = ? LIMIT 1").bind(email).first();
    if (existing) return Response.json({ error: "An account already exists for this email." }, { status: 409 });
    await env.DB.prepare("INSERT INTO users (email, display_name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(email, name, await passwordHash(password), now, now).run();
    return Response.json({ user: { email, name } }, { status: 201, headers: { "set-cookie": await createSession(request, env.DB, email), "cache-control": "no-store" } });
  }

  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    const email = normalizeEmail(body.email); const password = validPassword(body.password);
    if (!email || !password) return Response.json({ error: "Enter a valid email and password." }, { status: 400 });
    const user = await env.DB.prepare("SELECT email, display_name AS name, password_hash AS passwordHash FROM users WHERE email = ? LIMIT 1").bind(email).first<{ email: string; name: string; passwordHash: string | null }>();
    if (!user || !(await passwordMatches(password, user.passwordHash))) return Response.json({ error: "Invalid email or password." }, { status: 401 });
    const maxAge = body.remember === "on" ? SESSION_SECONDS : 60 * 60 * 12;
    return Response.json({ user: { email: user.email, name: user.name } }, { headers: { "set-cookie": await createSession(request, env.DB, email, maxAge), "cache-control": "no-store" } });
  }

  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    const token = cookieValue(request, SESSION_COOKIE);
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await digest(token)).run();
    return Response.json({ signedOut: true }, { headers: { "set-cookie": sessionCookie(request, "", 0), "cache-control": "no-store" } });
  }

  if (url.pathname === "/api/auth/forgot-password" && request.method === "POST") {
    const email = normalizeEmail(body.email);
    if (email) {
      const user = await env.DB.prepare("SELECT email FROM users WHERE email = ? LIMIT 1").bind(email).first();
      if (user) { const token = randomToken(); await env.DB.prepare("INSERT INTO password_reset_tokens (token_hash, user_email, expires_at, used_at, created_at) VALUES (?, ?, ?, NULL, ?)").bind(await digest(token), email, now + 30 * 60 * 1000, now).run(); await sendResetEmail(request, env, email, token); }
    }
    return Response.json({ message: "If that email is registered, a reset link is on its way." });
  }

  if (url.pathname === "/api/auth/reset-password" && request.method === "POST") {
    const password = validPassword(body.newPassword); const token = String(body.token || "");
    if (!password || password !== body.confirmPassword || !token) return Response.json({ error: "Use a valid reset link and enter matching passwords." }, { status: 400 });
    const tokenHash = await digest(token);
    const row = await env.DB.prepare("SELECT user_email AS email FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? LIMIT 1").bind(tokenHash, now).first<{ email: string }>();
    if (!row) return Response.json({ error: "This password reset link is invalid or expired." }, { status: 400 });
    await env.DB.batch([env.DB.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE email = ?").bind(await passwordHash(password), now, row.email), env.DB.prepare("UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ?").bind(now, tokenHash), env.DB.prepare("DELETE FROM sessions WHERE user_email = ?").bind(row.email)]);
    return Response.json({ message: "Password updated. You can now log in." }, { headers: { "set-cookie": sessionCookie(request, "", 0) } });
  }

  const identity = await sessionIdentity(request, env);
  if (!identity) return Response.json({ error: "Log in to continue." }, { status: 401 });
  if (url.pathname === "/api/auth/me" && request.method === "GET") return Response.json({ user: identity }, { headers: { "cache-control": "no-store" } });
  if (url.pathname === "/api/auth/profile" && request.method === "PATCH") {
    const name = String(body.name || "").trim().slice(0, 60);
    if (name.length < 2) return Response.json({ error: "Enter a valid name." }, { status: 400 });
    await env.DB.prepare("UPDATE users SET display_name = ?, updated_at = ? WHERE email = ?").bind(name, now, identity.email).run();
    return Response.json({ user: { ...identity, name } });
  }
  if (url.pathname === "/api/auth/change-password" && request.method === "POST") {
    const current = validPassword(body.currentPassword); const next = validPassword(body.newPassword);
    if (!current || !next || next !== body.confirmPassword) return Response.json({ error: "Enter your current password and matching new passwords." }, { status: 400 });
    const user = await env.DB.prepare("SELECT password_hash AS passwordHash FROM users WHERE email = ? LIMIT 1").bind(identity.email).first<{ passwordHash: string | null }>();
    if (!user || !(await passwordMatches(current, user.passwordHash))) return Response.json({ error: "Your current password is incorrect." }, { status: 401 });
    await env.DB.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE email = ?").bind(await passwordHash(next), now, identity.email).run();
    return Response.json({ message: "Password changed successfully." });
  }
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}

async function accountApi(request: Request, env: Env, url: URL, identity: AccountIdentity | null) {
  if (!identity) return Response.json({ error: "Log in to use your OddsAura account." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "Account storage is not ready yet." }, { status: 503 });
  await ensureAccountTables(env.DB);
  const now = Date.now();
  if (url.pathname === "/api/account" && request.method === "GET") return Response.json({ user: identity }, { headers: { "cache-control": "no-store" } });
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
  if (url.pathname === "/api/codes" && request.method === "GET") {
    const rows = await env.DB.prepare("SELECT id, provider, code, deep_link AS deepLink, selections_json AS selectionsJson, created_at AS createdAt FROM generated_codes WHERE user_email = ? ORDER BY created_at DESC LIMIT 50")
      .bind(identity.email).all();
    return Response.json({ codes: rows.results.map((row) => ({ ...row, selections: JSON.parse(String(row.selectionsJson)), selectionsJson: undefined })) }, { headers: { "cache-control": "no-store" } });
  }
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}

async function ticketControlsApi(env: Env) {
  if (!env.DB) return Response.json({ controls: [] }, { headers: { "cache-control": "no-store" } });
  const rows = await env.DB.prepare("SELECT ticket_id AS ticketId, visible, title_override AS titleOverride, updated_at AS updatedAt FROM ticket_controls").all();
  return Response.json({ controls: rows.results.map((row) => ({ ...row, visible: Boolean(row.visible) })) }, { headers: { "cache-control": "no-store" } });
}

async function adminApi(request: Request, env: Env, url: URL, identity: AccountIdentity | null) {
  if (!identity) return Response.json({ error: "Log in to continue." }, { status: 401 });
  if (identity.role !== "ADMIN") return Response.json({ error: "Administrator access required." }, { status: 403 });
  if (!env.DB) return Response.json({ error: "Account storage is unavailable." }, { status: 503 });
  const now = Date.now();
  if (url.pathname === "/api/admin/overview" && request.method === "GET") {
    const [usersCount, slipsCount, codesCount, usersRows, controlsRows] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM saved_slips").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM generated_codes").first<{ count: number }>(),
      env.DB.prepare("SELECT email, display_name AS name, role, created_at AS createdAt FROM users ORDER BY created_at DESC LIMIT 25").all(),
      env.DB.prepare("SELECT ticket_id AS ticketId, visible, title_override AS titleOverride, updated_at AS updatedAt FROM ticket_controls").all(),
    ]);
    return Response.json({
      stats: { users: Number(usersCount?.count ?? 0), savedSlips: Number(slipsCount?.count ?? 0), generatedCodes: Number(codesCount?.count ?? 0) },
      users: usersRows.results,
      controls: controlsRows.results.map((row) => ({ ...row, visible: Boolean(row.visible) })),
      services: { passwordResetEmail: Boolean(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL) },
    }, { headers: { "cache-control": "no-store" } });
  }
  if (url.pathname.startsWith("/api/admin/tickets/") && request.method === "PATCH") {
    const ticketId = decodeURIComponent(url.pathname.slice("/api/admin/tickets/".length)).slice(0, 160);
    const body = await requestJson(request);
    if (!ticketId) return Response.json({ error: "Ticket ID is required." }, { status: 400 });
    const visible = body.visible !== false;
    const titleOverride = String(body.titleOverride || "").trim().slice(0, 80) || null;
    await env.DB.prepare("INSERT INTO ticket_controls (ticket_id, visible, title_override, updated_by, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(ticket_id) DO UPDATE SET visible = excluded.visible, title_override = excluded.title_override, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
      .bind(ticketId, visible ? 1 : 0, titleOverride, identity.email, now).run();
    return Response.json({ control: { ticketId, visible, titleOverride, updatedAt: now } });
  }
  if (url.pathname.startsWith("/api/admin/users/") && request.method === "PATCH") {
    const email = normalizeEmail(decodeURIComponent(url.pathname.slice("/api/admin/users/".length)));
    const body = await requestJson(request);
    const role = body.role === "ADMIN" ? "ADMIN" : body.role === "USER" ? "USER" : null;
    if (!email || !role) return Response.json({ error: "Valid user and role required." }, { status: 400 });
    const fixedAdmins = new Set(String(env.ODDSAURA_ADMIN_EMAILS || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
    if (fixedAdmins.has(email) && role !== "ADMIN") return Response.json({ error: "Environment-designated admins cannot be demoted here." }, { status: 400 });
    await env.DB.prepare("UPDATE users SET role = ?, updated_at = ? WHERE email = ?").bind(role, now, email).run();
    return Response.json({ user: { email, role } });
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

    if (url.pathname.startsWith("/api/auth/")) {
      try {
        return await authApi(request, env, url);
      } catch (error) {
        console.error("OddsAura account service failed", error);
        return Response.json(
          { error: "The account service could not complete that request. Please try again." },
          { status: 500, headers: { "cache-control": "no-store" } },
        );
      }
    }

    const protectedPages = ["/dashboard", "/daily", "/matches", "/builder", "/converter", "/results", "/account", "/admin"];
    const isProtectedPage = protectedPages.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`));
    const providerCodeMatch = url.pathname.match(/^\/api\/providers\/(sportybet|betpawa|bet9ja|betking|betway)\/code$/);
    const isProtectedApi = Boolean(providerCodeMatch) || url.pathname === "/api/providers/convert" || url.pathname === "/api/sportybet/code" || url.pathname === "/api/account" || url.pathname === "/api/codes" || url.pathname === "/api/slips" || url.pathname.startsWith("/api/slips/") || url.pathname === "/api/ticket-controls" || url.pathname.startsWith("/api/admin/");
    const identity = isProtectedPage || isProtectedApi ? await sessionIdentity(request, env) : null;
    if ((isProtectedPage || isProtectedApi) && !identity) {
      if (isProtectedApi) return Response.json({ error: "Log in to continue." }, { status: 401, headers: { "cache-control": "no-store" } });
      const returnTo = `${url.pathname}${url.search}`;
      return Response.redirect(new URL(`/login?next=${encodeURIComponent(returnTo)}`, request.url), 302);
    }
    if ((url.pathname === "/admin" || url.pathname.startsWith("/admin/")) && identity?.role !== "ADMIN") {
      return Response.redirect(new URL("/dashboard", request.url), 302);
    }
    if (url.pathname.startsWith("/api/admin/") && identity?.role !== "ADMIN") return Response.json({ error: "Administrator access required." }, { status: 403 });
    let authenticatedRequest = request;
    if (identity) {
      const headers = new Headers(request.headers);
      headers.set("x-oddsaura-user-email", identity.email);
      headers.set("x-oddsaura-user-name", identity.name);
      headers.set("x-oddsaura-user-role", identity.role);
      authenticatedRequest = new Request(request, { headers });
    }

    if (url.pathname === "/api/account" || url.pathname === "/api/codes" || url.pathname === "/api/slips" || url.pathname.startsWith("/api/slips/")) {
      return accountApi(authenticatedRequest, env, url, identity);
    }
    if (url.pathname === "/api/ticket-controls") return ticketControlsApi(env);
    if (url.pathname.startsWith("/api/admin/")) return adminApi(authenticatedRequest, env, url, identity);

    if (url.pathname === "/api/providers/convert") {
      if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: { allow: "POST" } });
      if (!identity || !env.DB) return Response.json({ error: "Account storage is not ready yet." }, { status: 503 });
      try {
        const body = await authenticatedRequest.json() as { sourceProvider?: BookmakerId; destinationProvider?: BookmakerId; code?: string; allowPartial?: boolean };
        const providers = new Set<BookmakerId>(["sportybet", "betpawa", "bet9ja", "betking", "betway"]);
        if (!body.sourceProvider || !body.destinationProvider || !providers.has(body.sourceProvider) || !providers.has(body.destinationProvider)) return Response.json({ error: "Choose valid source and destination bookmakers." }, { status: 400 });
        if (body.sourceProvider === body.destinationProvider) return Response.json({ error: "Choose a different destination bookmaker." }, { status: 400 });
        const code = String(body.code || "").trim().toUpperCase();
        if (!/^[A-Z0-9]{4,16}$/.test(code)) return Response.json({ error: "Enter a valid bookmaker code." }, { status: 400 });
        await ensureAccountTables(env.DB);
        const stored = await env.DB.prepare("SELECT selections_json AS selectionsJson FROM generated_codes WHERE user_email = ? AND lower(provider) = ? AND upper(code) = ? ORDER BY created_at DESC LIMIT 1")
          .bind(identity.email, body.sourceProvider, code).first<{ selectionsJson: string }>();
        let selections: SportyBetSelectionInput[] = [];
        let importedFrom: "account" | "bookmaker" = "bookmaker";
        if (stored?.selectionsJson) {
          const parsed = JSON.parse(stored.selectionsJson) as { requested?: SportyBetSelectionInput[] };
          selections = Array.isArray(parsed.requested) ? parsed.requested : [];
          importedFrom = "account";
        }
        let sourceIssues: Array<{ eventName?: string; marketName?: string; outcomeName?: string; reason?: string }> = [];
        if (!selections.length) {
          const decoded = await decodeBookmakerCode(body.sourceProvider, code, fetch);
          sourceIssues = decoded.skippedSelections;
          if (decoded.partial) {
            const firstSkipped = decoded.skippedSelections[0];
            const subject = firstSkipped ? `${firstSkipped.eventName} — ${firstSkipped.marketName}: ${firstSkipped.outcomeName}` : `${decoded.skipped} selection${decoded.skipped === 1 ? "" : "s"}`;
            throw new BookmakerIntegrationError(`Could not safely translate ${subject}. No selections were removed and no partial code was created.`, 422, { skipped: decoded.skipped, skippedSelections: decoded.skippedSelections, sourceSelections: decoded.selections });
          }
          selections = decoded.selections;
        }
        let result;
        try {
          result = await createBookmakerCode(body.destinationProvider, selections, fetch, false);
        } catch (error) {
          if (error instanceof BookmakerIntegrationError) {
            const existing = error.details && typeof error.details === "object" && !Array.isArray(error.details) ? error.details : {};
            throw new BookmakerIntegrationError(error.message, error.status, { ...existing, sourceSelections: selections });
          }
          throw error;
        }
        const now = Date.now();
        await env.DB.prepare("INSERT INTO generated_codes (id, user_email, provider, code, deep_link, selections_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(crypto.randomUUID(), identity.email, body.destinationProvider, result.code, result.deepLink ?? null, JSON.stringify({ requested: selections, resolved: result.resolved ?? [], unmatched: result.unmatched ?? [], sourceIssues, convertedFrom: { provider: body.sourceProvider, code } }), now).run();
        return Response.json({ verified: true, sourceProvider: body.sourceProvider, destinationProvider: body.destinationProvider, sourceCode: code, importedFrom, decoded: selections.length, sourceIssues, ...result, partial: Boolean(result.partial || sourceIssues.length) }, { headers: { "cache-control": "no-store" } });
      } catch (error) {
        const typed = error instanceof BookmakerIntegrationError ? error : error instanceof Error && "status" in error ? error as BookmakerIntegrationError : new BookmakerIntegrationError("The code could not be converted.", 502);
        return Response.json({ error: typed.message, details: typed.details }, { status: typed.status, headers: { "cache-control": "no-store" } });
      }
    }

    if (providerCodeMatch || url.pathname === "/api/sportybet/code") {
      const provider = (providerCodeMatch?.[1] ?? "sportybet") as BookmakerId;
      if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: { allow: "POST" } });
      if (!identity || !env.DB) return Response.json({ error: "Account storage is not ready yet." }, { status: 503 });
      let eventId = "";
      try {
        const body = await authenticatedRequest.json() as { selections?: SportyBetSelectionInput[]; allowPartial?: boolean };
        await ensureAccountTables(env.DB);
        const now = Date.now();
        const requestHash = await digest(`${identity.email}|${provider}|${JSON.stringify({ selections: body.selections ?? [], allowPartial: body.allowPartial ?? false })}`);
        const recent = await env.DB.prepare("SELECT COUNT(*) AS count FROM code_request_events WHERE user_email = ? AND created_at > ?")
          .bind(identity.email, now - 60_000).first<{ count: number }>();
        if (Number(recent?.count ?? 0) >= 6) {
          return Response.json({ error: "Please wait a moment before generating another code." }, { status: 429, headers: { "retry-after": "60", "cache-control": "no-store" } });
        }
        eventId = crypto.randomUUID();
        await env.DB.prepare("INSERT INTO code_request_events (id, user_email, request_hash, status, created_at) VALUES (?, ?, ?, 'STARTED', ?)")
          .bind(eventId, identity.email, requestHash, now).run();
        const cached = await env.DB.prepare("SELECT response_json AS responseJson FROM sportybet_code_cache WHERE request_hash = ? AND expires_at > ? LIMIT 1")
          .bind(requestHash, now).first<{ responseJson: string }>();
        if (cached?.responseJson) {
          const cachedResult = JSON.parse(cached.responseJson) as Record<string, unknown>;
          await env.DB.prepare("UPDATE code_request_events SET status = 'CACHED' WHERE id = ?").bind(eventId).run();
          return Response.json({ provider, verified: true, cached: true, ...cachedResult }, { headers: { "cache-control": "no-store" } });
        }
        const result = await createBookmakerCode(provider, body.selections ?? [], fetch, body.allowPartial ?? false);
        await env.DB.batch([
          env.DB.prepare("INSERT INTO generated_codes (id, user_email, provider, code, deep_link, selections_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(crypto.randomUUID(), identity.email, provider, result.code, result.deepLink ?? null, JSON.stringify({ requested: body.selections ?? [], resolved: result.resolved ?? [], unmatched: result.unmatched ?? [] }), now),
          env.DB.prepare("INSERT INTO sportybet_code_cache (request_hash, response_json, expires_at, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(request_hash) DO UPDATE SET response_json = excluded.response_json, expires_at = excluded.expires_at, created_at = excluded.created_at")
            .bind(requestHash, JSON.stringify(result), now + 120_000, now),
          env.DB.prepare("UPDATE code_request_events SET status = 'SUCCEEDED' WHERE id = ?").bind(eventId),
        ]);
        ctx.waitUntil(env.DB.batch([
          env.DB.prepare("DELETE FROM code_request_events WHERE created_at < ?").bind(now - 86_400_000),
          env.DB.prepare("DELETE FROM sportybet_code_cache WHERE expires_at < ?").bind(now),
        ]).then(() => undefined));
        return Response.json({ provider, verified: true, ...result }, { headers: { "cache-control": "no-store" } });
      } catch (error) {
        if (eventId) ctx.waitUntil(env.DB.prepare("UPDATE code_request_events SET status = 'FAILED' WHERE id = ?").bind(eventId).run().then(() => undefined));
        const typed = error instanceof BookmakerIntegrationError ? error : new BookmakerIntegrationError("Bookmaker code creation failed.", 502);
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

    return handler.fetch(authenticatedRequest, env, ctx);
  },
};

export default worker;
