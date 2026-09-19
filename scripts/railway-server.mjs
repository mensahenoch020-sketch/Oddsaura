import { createServer, request as httpRequest } from "node:http";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import pg from "pg";
import { resolveDatabaseUrl } from "./database-config.mjs";
import { batchMissingSelections, buildBatchXReply, isValidXPostUrl, parseXConversionRequest } from "./x-reply-helper.mjs";
import { readXPost } from "./x-post-reader.mjs";

const { Pool } = pg;
const port = Number(process.env.PORT || 3000);
const appPort = Number(process.env.INTERNAL_APP_PORT || (port === 3001 ? 3002 : 3001));
const cookieName = "oa_session";
const sessionSeconds = 60 * 60 * 24 * 30;
const passwordIterations = 100_000;
const encoder = new TextEncoder();
const protectedPages = ["/dashboard", "/assistant", "/daily", "/matches", "/builder", "/converter", "/results", "/account", "/admin"];
const protectedApis = ["/api/providers", "/api/sportybet/code", "/api/account", "/api/codes", "/api/slips", "/api/ticket-controls", "/api/admin"];
const edgeOrigin = process.env.ODDSAURA_EDGE_ORIGIN?.replace(/\/$/, "") || null;

const databaseUrl = resolveDatabaseUrl();
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

function base64Url(bytes) { return Buffer.from(bytes).toString("base64url"); }
function fromBase64Url(value) { return new Uint8Array(Buffer.from(value, "base64url")); }
function randomToken(size = 32) { const bytes = new Uint8Array(size); crypto.getRandomValues(bytes); return base64Url(bytes); }
async function digest(value) { return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))); }
async function passwordHash(password) { const salt = new Uint8Array(16); crypto.getRandomValues(salt); const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]); const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: passwordIterations }, key, 256); return `pbkdf2$${passwordIterations}$${base64Url(salt)}$${base64Url(new Uint8Array(bits))}`; }
async function passwordMatches(password, stored) { if (!stored) return false; const [scheme, iterationsText, saltText, expected] = stored.split("$"); const iterations = Number(iterationsText); if (scheme !== "pbkdf2" || !Number.isInteger(iterations) || iterations < 100_000 || !saltText || !expected) return false; const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]); const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromBase64Url(saltText), iterations }, key, 256); const actual = Buffer.from(base64Url(new Uint8Array(bits))); const wanted = Buffer.from(expected); return actual.length === wanted.length && timingSafeEqual(actual, wanted); }
function normalizeEmail(value) { const email = String(value || "").trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null; }
function validPassword(value) { const password = String(value || ""); return password.length >= 8 && password.length <= 128 ? password : null; }
function parseCookies(header = "") { return Object.fromEntries(header.split(";").map((part) => part.trim().split("=")).filter(([key]) => key).map(([key, ...rest]) => [key, decodeURIComponent(rest.join("="))])); }
function setCookie(value, maxAge) { return `${cookieName}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Secure`; }
function json(res, status, payload, headers = {}) { const body = JSON.stringify(payload); res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store", ...headers }); res.end(body); }
async function readJson(req) { const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > 100_000) throw new Error("Request is too large."); chunks.push(chunk); } try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; } }

async function ensureTables() {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS oa_users (email TEXT PRIMARY KEY, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'USER', created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)`);
  await pool.query(`ALTER TABLE oa_users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'USER'`);
  await pool.query(`CREATE TABLE IF NOT EXISTS oa_sessions (token_hash TEXT PRIMARY KEY, user_email TEXT NOT NULL REFERENCES oa_users(email) ON DELETE CASCADE, expires_at BIGINT NOT NULL, created_at BIGINT NOT NULL)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS oa_sessions_user_expires_idx ON oa_sessions(user_email, expires_at)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS oa_password_resets (token_hash TEXT PRIMARY KEY, user_email TEXT NOT NULL REFERENCES oa_users(email) ON DELETE CASCADE, expires_at BIGINT NOT NULL, used_at BIGINT, created_at BIGINT NOT NULL)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS oa_saved_slips (id TEXT PRIMARY KEY, user_email TEXT NOT NULL REFERENCES oa_users(email) ON DELETE CASCADE, name TEXT NOT NULL, picks_json TEXT NOT NULL, created_at BIGINT NOT NULL)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS oa_saved_slips_user_created_idx ON oa_saved_slips(user_email, created_at DESC)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS oa_generated_codes (id TEXT PRIMARY KEY, user_email TEXT NOT NULL REFERENCES oa_users(email) ON DELETE CASCADE, provider TEXT NOT NULL, code TEXT NOT NULL, deep_link TEXT, selections_json TEXT NOT NULL, created_at BIGINT NOT NULL)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS oa_generated_codes_user_created_idx ON oa_generated_codes(user_email, created_at DESC)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS oa_ticket_controls (ticket_id TEXT PRIMARY KEY, visible BOOLEAN NOT NULL DEFAULT TRUE, title_override TEXT, updated_by TEXT NOT NULL REFERENCES oa_users(email), updated_at BIGINT NOT NULL)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS oa_public_rate_limits (client_key TEXT NOT NULL, window_start BIGINT NOT NULL, request_count INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(client_key, window_start))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS oa_x_reply_requests (id TEXT PRIMARY KEY, tweet_url TEXT, request_text TEXT NOT NULL, source_provider TEXT NOT NULL, destination_provider TEXT NOT NULL, source_code TEXT NOT NULL, response_text TEXT, status TEXT NOT NULL, conversion_json TEXT, created_by TEXT NOT NULL REFERENCES oa_users(email), created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS oa_x_reply_requests_created_idx ON oa_x_reply_requests(created_at DESC)`);
}

async function createSession(email, maxAge = sessionSeconds) { const token = randomToken(); const now = Date.now(); await pool.query("INSERT INTO oa_sessions(token_hash,user_email,expires_at,created_at) VALUES($1,$2,$3,$4)", [await digest(token), email, now + maxAge * 1000, now]); return token; }
async function identity(req) { if (!pool) return null; const token = parseCookies(req.headers.cookie)[cookieName]; if (!token) return null; const result = await pool.query("SELECT u.email,u.display_name AS name,u.role FROM oa_sessions s JOIN oa_users u ON u.email=s.user_email WHERE s.token_hash=$1 AND s.expires_at>$2 LIMIT 1", [await digest(token), Date.now()]); const user = result.rows[0]; if (!user) return null; const admins = new Set(String(process.env.ODDSAURA_ADMIN_EMAILS || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean)); return { ...user, role: user.role === "ADMIN" || admins.has(user.email) ? "ADMIN" : "USER" }; }

async function sendResetEmail(req, email, token) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) return false;
  const origin = `https://${req.headers.host}`;
  const resetUrl = `${origin}/reset-password?token=${encodeURIComponent(token)}`;
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL, to: [email], subject: "Reset your OddsAura password", html: `<div style="font-family:Arial,sans-serif;color:#0b1426"><h1>Reset your OddsAura password</h1><p>This link expires in 30 minutes.</p><p><a href="${resetUrl}">Choose a new password</a></p><p>If you did not request this, you can ignore this email.</p></div>` }) });
  return response.ok;
}

async function authApi(req, res, url) {
  if (!pool) return json(res, 503, { error: "Account storage is not configured yet." });
  const body = req.method === "POST" || req.method === "PATCH" ? await readJson(req) : {};
  const now = Date.now();
  if (url.pathname === "/api/auth/signup" && req.method === "POST") {
    const email = normalizeEmail(body.email); const password = validPassword(body.password); const name = String(body.name || "").trim().slice(0, 60);
    if (!email || !password || name.length < 2 || body.password !== body.confirmPassword || body.acceptedTerms !== true) return json(res, 400, { error: "Enter a valid name, email and matching password, then accept the terms." });
    const exists = await pool.query("SELECT 1 FROM oa_users WHERE email=$1", [email]); if (exists.rowCount) return json(res, 409, { error: "An account already exists for this email." });
    await pool.query("INSERT INTO oa_users(email,display_name,password_hash,created_at,updated_at) VALUES($1,$2,$3,$4,$5)", [email, name, await passwordHash(password), now, now]);
    return json(res, 201, { user: { email, name } }, { "set-cookie": setCookie(await createSession(email), sessionSeconds) });
  }
  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    const email = normalizeEmail(body.email); const password = validPassword(body.password); if (!email || !password) return json(res, 400, { error: "Enter a valid email and password." });
    const result = await pool.query("SELECT email,display_name AS name,password_hash FROM oa_users WHERE email=$1 LIMIT 1", [email]); const user = result.rows[0];
    if (!user || !(await passwordMatches(password, user.password_hash))) return json(res, 401, { error: "Invalid email or password." });
    const maxAge = body.remember === "on" ? sessionSeconds : 60 * 60 * 12;
    return json(res, 200, { user: { email: user.email, name: user.name } }, { "set-cookie": setCookie(await createSession(email, maxAge), maxAge) });
  }
  if (url.pathname === "/api/auth/logout" && req.method === "POST") { const token = parseCookies(req.headers.cookie)[cookieName]; if (token) await pool.query("DELETE FROM oa_sessions WHERE token_hash=$1", [await digest(token)]); return json(res, 200, { signedOut: true }, { "set-cookie": setCookie("", 0) }); }
  if (url.pathname === "/api/auth/forgot-password" && req.method === "POST") { const email = normalizeEmail(body.email); if (email) { const found = await pool.query("SELECT email FROM oa_users WHERE email=$1", [email]); if (found.rowCount) { const token = randomToken(); await pool.query("INSERT INTO oa_password_resets(token_hash,user_email,expires_at,used_at,created_at) VALUES($1,$2,$3,NULL,$4)", [await digest(token), email, now + 30 * 60 * 1000, now]); await sendResetEmail(req, email, token); } } return json(res, 200, { message: "If that email is registered, a reset link is on its way." }); }
  if (url.pathname === "/api/auth/reset-password" && req.method === "POST") { const password = validPassword(body.newPassword); const token = String(body.token || ""); if (!password || password !== body.confirmPassword || !token) return json(res, 400, { error: "Use a valid reset link and enter matching passwords." }); const tokenHash = await digest(token); const found = await pool.query("SELECT user_email AS email FROM oa_password_resets WHERE token_hash=$1 AND used_at IS NULL AND expires_at>$2 LIMIT 1", [tokenHash, now]); if (!found.rowCount) return json(res, 400, { error: "This password reset link is invalid or expired." }); const email = found.rows[0].email; const client = await pool.connect(); try { await client.query("BEGIN"); await client.query("UPDATE oa_users SET password_hash=$1,updated_at=$2 WHERE email=$3", [await passwordHash(password), now, email]); await client.query("UPDATE oa_password_resets SET used_at=$1 WHERE token_hash=$2", [now, tokenHash]); await client.query("DELETE FROM oa_sessions WHERE user_email=$1", [email]); await client.query("COMMIT"); } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } return json(res, 200, { message: "Password updated. You can now log in." }, { "set-cookie": setCookie("", 0) }); }
  const user = await identity(req); if (!user) return json(res, 401, { error: "Log in to continue." });
  if (url.pathname === "/api/auth/me" && req.method === "GET") return json(res, 200, { user });
  if (url.pathname === "/api/auth/profile" && req.method === "PATCH") { const name = String(body.name || "").trim().slice(0, 60); if (name.length < 2) return json(res, 400, { error: "Enter a valid name." }); await pool.query("UPDATE oa_users SET display_name=$1,updated_at=$2 WHERE email=$3", [name, now, user.email]); return json(res, 200, { user: { ...user, name } }); }
  if (url.pathname === "/api/auth/change-password" && req.method === "POST") { const current = validPassword(body.currentPassword); const next = validPassword(body.newPassword); if (!current || !next || next !== body.confirmPassword) return json(res, 400, { error: "Enter your current password and matching new passwords." }); const found = await pool.query("SELECT password_hash FROM oa_users WHERE email=$1", [user.email]); if (!found.rowCount || !(await passwordMatches(current, found.rows[0].password_hash))) return json(res, 401, { error: "Your current password is incorrect." }); await pool.query("UPDATE oa_users SET password_hash=$1,updated_at=$2 WHERE email=$3", [await passwordHash(next), now, user.email]); return json(res, 200, { message: "Password changed successfully." }); }
  return json(res, 405, { error: "Method not allowed." });
}

async function slipsApi(req, res, url, user) {
  if (!pool) return json(res, 503, { error: "Account storage is not configured yet." });
  if (url.pathname === "/api/account" && req.method === "GET") return json(res, 200, { user });
  if (url.pathname === "/api/slips" && req.method === "GET") { const result = await pool.query("SELECT id,name,picks_json,created_at FROM oa_saved_slips WHERE user_email=$1 ORDER BY created_at DESC LIMIT 50", [user.email]); return json(res, 200, { slips: result.rows.map((row) => ({ id: row.id, name: row.name, picks: JSON.parse(row.picks_json), createdAt: Number(row.created_at) })) }); }
  if (url.pathname === "/api/slips" && req.method === "POST") { const body = await readJson(req); if (!Array.isArray(body.picks) || body.picks.length < 1 || body.picks.length > 50) return json(res, 400, { error: "Save between 1 and 50 picks." }); const payload = JSON.stringify(body.picks); if (payload.length > 60_000) return json(res, 400, { error: "This slip is too large to save." }); const id = crypto.randomUUID(); const now = Date.now(); const name = String(body.name || `Prediction slip · ${new Date(now).toISOString().slice(0, 10)}`).slice(0, 80); await pool.query("INSERT INTO oa_saved_slips(id,user_email,name,picks_json,created_at) VALUES($1,$2,$3,$4,$5)", [id, user.email, name, payload, now]); return json(res, 201, { id, name, createdAt: now }); }
  if (url.pathname.startsWith("/api/slips/") && req.method === "DELETE") { const id = decodeURIComponent(url.pathname.slice("/api/slips/".length)); await pool.query("DELETE FROM oa_saved_slips WHERE id=$1 AND user_email=$2", [id, user.email]); return json(res, 200, { deleted: true }); }
  return json(res, 405, { error: "Method not allowed." });
}

async function codesApi(req, res, user) {
  if (!pool) return json(res, 503, { error: "Account storage is not configured yet." });
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed." });
  const result = await pool.query("SELECT id,provider,code,deep_link,selections_json,created_at FROM oa_generated_codes WHERE user_email=$1 ORDER BY created_at DESC LIMIT 50", [user.email]);
  return json(res, 200, { codes: result.rows.map((row) => ({ id: row.id, provider: row.provider, code: row.code, deepLink: row.deep_link, selections: JSON.parse(row.selections_json), createdAt: Number(row.created_at) })) });
}

async function ticketControlsApi(req, res) {
  if (!pool) return json(res, 503, { error: "Account storage is not configured yet." });
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed." });
  const result = await pool.query("SELECT ticket_id,title_override,visible,updated_at FROM oa_ticket_controls");
  return json(res, 200, { controls: result.rows.map((row) => ({ ticketId: row.ticket_id, titleOverride: row.title_override, visible: row.visible, updatedAt: Number(row.updated_at) })) });
}

function publicClientKey(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const address = forwarded || String(req.headers["x-real-ip"] || req.socket.remoteAddress || "unknown");
  const agent = String(req.headers["user-agent"] || "unknown").slice(0, 180);
  return createHash("sha256").update(`${address}|${agent}`).digest("hex");
}

async function consumePublicConversion(req) {
  const limit = Math.max(1, Math.min(50, Number(process.env.PUBLIC_CONVERSION_HOURLY_LIMIT || 8)));
  const windowStart = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  const result = await pool.query(`INSERT INTO oa_public_rate_limits(client_key,window_start,request_count) VALUES($1,$2,1)
    ON CONFLICT(client_key,window_start) DO UPDATE SET request_count=oa_public_rate_limits.request_count+1
    WHERE oa_public_rate_limits.request_count<$3 RETURNING request_count`, [publicClientKey(req), windowStart, limit]);
  const count = Number(result.rows[0]?.request_count ?? limit);
  return { allowed: result.rowCount > 0, remaining: Math.max(0, limit - count) };
}

async function internalConversion(body, account = { email: "public-converter@oddsaura.local", name: "Public converter" }) {
  const response = await fetch(`http://127.0.0.1:${appPort}/api/providers/convert`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-oddsaura-user-email": account.email, "x-oddsaura-user-name": account.name },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({ error: "The bookmaker returned an invalid response." }));
  return { response, payload };
}

let activePublicConversions = 0;
async function publicConverterApi(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." });
  if (!pool) return json(res, 503, { error: "Public conversion is temporarily unavailable." });
  if (activePublicConversions >= 3) return json(res, 429, { error: "The converter is busy. Please retry in a minute." }, { "retry-after": "60" });
  const body = await readJson(req);
  if (String(body.website || "")) return json(res, 400, { error: "Request could not be accepted." });
  const providers = new Set(["sportybet", "betpawa", "bet9ja", "betking", "betway"]);
  const sourceProvider = String(body.sourceProvider || "").toLowerCase();
  const destinationProvider = String(body.destinationProvider || "").toLowerCase();
  const code = String(body.code || "").trim().toUpperCase();
  if (!providers.has(sourceProvider) || !providers.has(destinationProvider) || sourceProvider === destinationProvider || !/^[A-Z0-9]{4,16}$/.test(code)) return json(res, 400, { error: "Choose two different supported bookmakers and enter a valid booking code." });
  const quota = await consumePublicConversion(req);
  if (!quota.allowed) return json(res, 429, { error: "Fair-use limit reached. Please try again next hour or log in to OddsAura." }, { "retry-after": "3600" });
  activePublicConversions += 1;
  try {
    const { response, payload } = await internalConversion({ sourceProvider, destinationProvider, code, allowPartial: true });
    return json(res, response.status, { sourceProvider, destinationProvider, sourceCode: code, importedFrom: "bookmaker", quotaRemaining: quota.remaining, ...payload });
  } finally { activePublicConversions -= 1; }
}

function xReplyRow(row) {
  return { id: row.id, tweetUrl: row.tweet_url, requestText: row.request_text, sourceProvider: row.source_provider, destinationProvider: row.destination_provider, sourceCode: row.source_code, responseText: row.response_text, status: row.status, conversion: row.conversion_json ? JSON.parse(row.conversion_json) : null, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}

function batchCodes(input, detected) {
  const supplied = Array.isArray(input) ? input : [];
  const candidates = supplied.length ? supplied : detected;
  const output = []; const seen = new Set();
  for (const item of candidates ?? []) {
    const code = String(typeof item === "string" ? item : item?.code || "").trim().toUpperCase();
    const label = String(typeof item === "object" && item?.label ? item.label : "").trim().slice(0, 40) || null;
    if (!/^[A-Z0-9]{4,20}$/.test(code) || seen.has(code)) continue;
    seen.add(code); output.push({ code, label });
  }
  return output.slice(0, 20);
}

function requestOrigin() {
  const configured = String(process.env.ODDSAURA_PUBLIC_ORIGIN || "https://oddsaura.site").trim().replace(/\/$/, "");
  try { return new URL(configured).origin; }
  catch { return "https://oddsaura.site"; }
}

function normalizedConversionPayload(payload) {
  return {
    ...payload,
    unmatched: Array.isArray(payload?.unmatched) ? payload.unmatched : Array.isArray(payload?.details?.unmatched) ? payload.details.unmatched : [],
    sourceIssues: Array.isArray(payload?.sourceIssues) ? payload.sourceIssues : Array.isArray(payload?.details?.skippedSelections) ? payload.details.skippedSelections : [],
  };
}

async function publicXResultApi(req, res, url) {
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed." });
  if (!pool) return json(res, 503, { error: "Conversion results are temporarily unavailable." });
  const id = decodeURIComponent(url.pathname.slice("/api/public/x-results/".length));
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(id)) return json(res, 404, { error: "Conversion result not found." });
  const result = await pool.query("SELECT id,tweet_url,source_provider,destination_provider,source_code,conversion_json,created_at FROM oa_x_reply_requests WHERE id=$1 LIMIT 1", [id]);
  if (!result.rowCount) return json(res, 404, { error: "Conversion result not found." });
  const row = result.rows[0]; const conversion = row.conversion_json ? JSON.parse(row.conversion_json) : {};
  const items = Array.isArray(conversion.batch) ? conversion.batch : [];
  return json(res, 200, { id: row.id, tweetUrl: row.tweet_url, sourceProvider: row.source_provider, destinationProvider: row.destination_provider, sourceCodes: String(row.source_code || "").split(",").filter(Boolean), items, missing: batchMissingSelections(items), createdAt: Number(row.created_at) });
}

async function xReplyApi(req, res, url, user) {
  if (!pool) return json(res, 503, { error: "Account storage is not configured yet." });
  if (req.method === "GET" && url.pathname === "/api/admin/x-replies") {
    const result = await pool.query("SELECT id,tweet_url,request_text,source_provider,destination_provider,source_code,response_text,status,conversion_json,created_at,updated_at FROM oa_x_reply_requests ORDER BY created_at DESC LIMIT 100");
    return json(res, 200, { requests: result.rows.map(xReplyRow) });
  }
  if (req.method === "POST" && url.pathname === "/api/admin/x-replies/resolve") {
    const body = await readJson(req); const tweetUrl = String(body.tweetUrl || "").trim().slice(0, 500);
    if (!isValidXPostUrl(tweetUrl)) return json(res, 400, { error: "Enter a valid public X post link." });
    try {
      const post = await readXPost(tweetUrl);
      return json(res, 200, post);
    } catch (error) { return json(res, 422, { error: error instanceof Error ? error.message : "This X post could not be read." }); }
  }
  if (req.method === "POST" && url.pathname === "/api/admin/x-replies") {
    const body = await readJson(req);
    const tweetUrl = String(body.tweetUrl || "").trim().slice(0, 500) || null;
    if (tweetUrl && !isValidXPostUrl(tweetUrl)) return json(res, 400, { error: "Enter a valid public X post link or leave it blank." });
    let post = null; let requestText = String(body.requestText || "").trim().slice(0, 4_000);
    if (!requestText && tweetUrl) {
      try { post = await readXPost(tweetUrl); requestText = post.requestText; }
      catch (error) { return json(res, 422, { error: error instanceof Error ? error.message : "This X post could not be read." }); }
    }
    const parsed = parseXConversionRequest(requestText);
    const preferDetected = body.autoDetect !== false;
    const sourceProvider = String(preferDetected ? parsed.sourceProvider || body.sourceProvider || "" : body.sourceProvider || parsed.sourceProvider || "").toLowerCase();
    const destinationProvider = String(preferDetected ? parsed.destinationProvider || body.destinationProvider || "" : body.destinationProvider || parsed.destinationProvider || "").toLowerCase();
    const codes = batchCodes(body.sourceCodes, parsed.codes);
    const providers = new Set(["sportybet", "betpawa", "bet9ja", "betking", "betway"]);
    if (!requestText && codes.length) requestText = codes.map((item) => `${item.label ? `${item.label} - ` : ""}${item.code}`).join("\n");
    if (!requestText || !providers.has(sourceProvider) || !providers.has(destinationProvider) || sourceProvider === destinationProvider || !codes.length) return json(res, 400, { error: post?.mediaDetected && !codes.length ? "The attached image was found, but its codes could not be read clearly. Paste the code lines below so OddsAura can continue." : "OddsAura needs the source bookmaker, destination bookmaker and at least one valid booking code.", detected: parsed });
    const id = randomToken(9); const now = Date.now(); const items = [];
    for (const item of codes) {
      try {
        const { response, payload } = await internalConversion({ sourceProvider, destinationProvider, code: item.code, allowPartial: true }, { email: user.email, name: user.name });
        const result = normalizedConversionPayload(payload);
        items.push({ sourceCode: item.code, label: item.label, status: response.ok && result.code ? "READY" : "FAILED", result, error: response.ok ? null : result.error || "Conversion failed." });
      } catch (error) { items.push({ sourceCode: item.code, label: item.label, status: "FAILED", result: {}, error: error instanceof Error ? error.message : "Conversion failed." }); }
    }
    const successCount = items.filter((item) => item.status === "READY").length;
    const status = successCount ? "READY" : "FAILED";
    const resultUrl = `${requestOrigin()}/x/${id}`;
    const responseText = buildBatchXReply({ sourceProvider, destinationProvider, items, resultUrl });
    const conversion = { batch: items, successCount, failureCount: items.length - successCount, mediaDetected: Boolean(post?.mediaDetected), ocrUsed: Boolean(post?.ocrUsed) };
    const sourceCode = codes.map((item) => item.code).join(",");
    await pool.query("INSERT INTO oa_x_reply_requests(id,tweet_url,request_text,source_provider,destination_provider,source_code,response_text,status,conversion_json,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)", [id, tweetUrl, requestText, sourceProvider, destinationProvider, sourceCode, responseText, status, JSON.stringify(conversion), user.email, now]);
    return json(res, 201, { request: { id, tweetUrl, requestText, sourceProvider, destinationProvider, sourceCode, sourceCodes: codes, responseText, status, conversion, resultUrl, createdAt: now, updatedAt: now } });
  }
  const match = url.pathname.match(/^\/api\/admin\/x-replies\/([^/]+)$/);
  if (req.method === "PATCH" && match) {
    const body = await readJson(req); const status = ["READY", "POSTED", "ARCHIVED"].includes(body.status) ? body.status : null;
    const responseText = typeof body.responseText === "string" ? body.responseText.trim().slice(0, 1000) : null;
    if (!status) return json(res, 400, { error: "Choose a valid reply status." });
    const result = await pool.query("UPDATE oa_x_reply_requests SET status=$1,response_text=COALESCE($2,response_text),updated_at=$3 WHERE id=$4 RETURNING id", [status, responseText, Date.now(), decodeURIComponent(match[1])]);
    if (!result.rowCount) return json(res, 404, { error: "Reply request not found." });
    return json(res, 200, { updated: true });
  }
  return json(res, 405, { error: "Method not allowed." });
}

async function adminApi(req, res, url, user) {
  if (!pool) return json(res, 503, { error: "Account storage is not configured yet." });
  if (user.role !== "ADMIN") return json(res, 403, { error: "Administrator access required." });
  if (url.pathname === "/api/admin/x-replies" || url.pathname.startsWith("/api/admin/x-replies/")) return xReplyApi(req, res, url, user);
  const now = Date.now();
  if (url.pathname === "/api/admin/overview" && req.method === "GET") {
    const [users, slips, codes, recentUsers, controls] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count FROM oa_users"),
      pool.query("SELECT COUNT(*)::int AS count FROM oa_saved_slips"),
      pool.query("SELECT COUNT(*)::int AS count FROM oa_generated_codes"),
      pool.query("SELECT email,display_name AS name,role,created_at FROM oa_users ORDER BY created_at DESC LIMIT 25"),
      pool.query("SELECT ticket_id,title_override,visible,updated_at FROM oa_ticket_controls"),
    ]);
    return json(res, 200, {
      stats: { users: users.rows[0].count, savedSlips: slips.rows[0].count, generatedCodes: codes.rows[0].count },
      users: recentUsers.rows.map((row) => ({ email: row.email, name: row.name, role: row.role, createdAt: Number(row.created_at) })),
      controls: controls.rows.map((row) => ({ ticketId: row.ticket_id, titleOverride: row.title_override, visible: row.visible, updatedAt: Number(row.updated_at) })),
      services: { passwordResetEmail: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) },
    });
  }
  if (url.pathname.startsWith("/api/admin/tickets/") && req.method === "PATCH") {
    const ticketId = decodeURIComponent(url.pathname.slice("/api/admin/tickets/".length)).slice(0, 160);
    const body = await readJson(req);
    if (!ticketId) return json(res, 400, { error: "Ticket ID is required." });
    const visible = body.visible !== false;
    const titleOverride = String(body.titleOverride || "").trim().slice(0, 80) || null;
    await pool.query("INSERT INTO oa_ticket_controls(ticket_id,visible,title_override,updated_by,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(ticket_id) DO UPDATE SET visible=EXCLUDED.visible,title_override=EXCLUDED.title_override,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at", [ticketId, visible, titleOverride, user.email, now]);
    return json(res, 200, { control: { ticketId, visible, titleOverride, updatedAt: now } });
  }
  if (url.pathname.startsWith("/api/admin/users/") && req.method === "PATCH") {
    const email = normalizeEmail(decodeURIComponent(url.pathname.slice("/api/admin/users/".length)));
    const body = await readJson(req);
    const role = body.role === "ADMIN" ? "ADMIN" : body.role === "USER" ? "USER" : null;
    if (!email || !role) return json(res, 400, { error: "Valid user and role required." });
    const fixedAdmins = new Set(String(process.env.ODDSAURA_ADMIN_EMAILS || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
    if (fixedAdmins.has(email) && role !== "ADMIN") return json(res, 400, { error: "Environment-designated admins cannot be demoted here." });
    const result = await pool.query("UPDATE oa_users SET role=$1,updated_at=$2 WHERE email=$3", [role, now, email]);
    if (!result.rowCount) return json(res, 404, { error: "User not found." });
    return json(res, 200, { user: { email, role } });
  }
  return json(res, 405, { error: "Method not allowed." });
}

async function bookmakerApi(req, res, user, provider) {
  const body = await readJson(req);
  const response = await fetch(`http://127.0.0.1:${appPort}/api/providers/${encodeURIComponent(provider)}/code`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-oddsaura-user-email": user.email, "x-oddsaura-user-name": user.name },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({ error: "The bookmaker returned an invalid response." }));
  if (response.ok && payload.code && pool) {
    const selections = { verified: payload.verified === true, verificationStatus: payload.verificationStatus, requested: Array.isArray(body.selections) ? body.selections : [], resolved: payload.resolved ?? [], unmatched: payload.unmatched ?? [] };
    await pool.query("INSERT INTO oa_generated_codes(id,user_email,provider,code,deep_link,selections_json,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)", [crypto.randomUUID(), user.email, provider, payload.code, payload.deepLink ?? null, JSON.stringify(selections), Date.now()]).catch(() => {
      payload.historySaved = false;
      payload.warning = [payload.warning, "Code created, but account history could not be saved. Copy this code now."].filter(Boolean).join(" ");
      console.error("Created booking code could not be saved to account history.");
    });
  }
  return json(res, response.status, payload);
}

async function converterApi(req, res, user) {
  if (!pool) return json(res, 503, { error: "Account storage is not configured yet." });
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." });
  const body = await readJson(req);
  const providers = new Set(["sportybet", "betpawa", "bet9ja", "betking", "betway"]);
  const source = String(body.sourceProvider || "").toLowerCase();
  const destination = String(body.destinationProvider || "").toLowerCase();
  const code = String(body.code || "").trim().toUpperCase();
  const allowPartial = body.allowPartial === true;
  if (!providers.has(source) || !providers.has(destination)) return json(res, 400, { error: "Choose valid source and destination bookmakers." });
  if (source === destination) return json(res, 400, { error: "Choose a different destination bookmaker." });
  if (!/^[A-Z0-9]{4,16}$/.test(code)) return json(res, 400, { error: "Enter a valid bookmaker code." });
  // Reload the actual source code. Account history may contain requested legs
  // omitted from a partial code and is not an authoritative conversion source.
  const upstreamPath = "/api/providers/convert";
  const upstreamBody = { sourceProvider: source, destinationProvider: destination, code, allowPartial };
  const importedFrom = "bookmaker";
  const response = await fetch(`http://127.0.0.1:${appPort}${upstreamPath}`, { method: "POST", headers: { "content-type": "application/json", "x-oddsaura-user-email": user.email, "x-oddsaura-user-name": user.name }, body: JSON.stringify(upstreamBody) });
  const payload = await response.json().catch(() => ({ error: "The bookmaker returned an invalid response." }));
  if (response.ok && payload.code) {
    const requested = Array.isArray(payload.sourceSelections) ? payload.sourceSelections : [];
    await pool.query("INSERT INTO oa_generated_codes(id,user_email,provider,code,deep_link,selections_json,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)", [crypto.randomUUID(), user.email, destination, payload.code, payload.deepLink ?? null, JSON.stringify({ verified: payload.verified === true, verificationStatus: payload.verificationStatus, requested, resolved: payload.resolved ?? [], unmatched: payload.unmatched ?? [], sourceIssues: payload.sourceIssues ?? [], convertedFrom: { provider: source, code } }), Date.now()]).catch(() => {
      payload.historySaved = false;
      payload.warning = [payload.warning, "Code created, but account history could not be saved. Copy this code now."].filter(Boolean).join(" ");
      console.error("Converted booking code could not be saved to account history.");
    });
  }
  return json(res, response.status, { sourceProvider: source, destinationProvider: destination, sourceCode: code, importedFrom, ...payload });
}

function proxy(req, res, user) {
  const headers = { ...req.headers, host: `127.0.0.1:${appPort}` };
  for (const name of Object.keys(headers)) if (name.startsWith("x-oddsaura-")) delete headers[name];
  if (user) { headers["x-oddsaura-user-email"] = user.email; headers["x-oddsaura-user-name"] = user.name; headers["x-oddsaura-user-role"] = user.role; }
  const upstream = httpRequest({ hostname: "127.0.0.1", port: appPort, path: req.url, method: req.method, headers }, (upstreamResponse) => { res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers); upstreamResponse.pipe(res); });
  upstream.on("error", () => json(res, 502, { error: "OddsAura is starting. Please retry shortly." }));
  req.pipe(upstream);
}

async function proxyEdge(req, res) {
  if (!edgeOrigin) return json(res, 503, { error: "The configured edge fallback is unavailable." });
  const target = new URL(req.url || "/", edgeOrigin);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (name === "host" || value == null || name.startsWith("x-oddsaura-")) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  headers.set("accept-encoding", "identity");
  headers.set("x-forwarded-host", req.headers.host || "");
  const init = { method: req.method, headers, redirect: "manual" };
  if (req.method !== "GET" && req.method !== "HEAD") { init.body = req; init.duplex = "half"; }
  const response = await fetch(target, init);
  const body = Buffer.from(await response.arrayBuffer());
  const responseHeaders = {};
  response.headers.forEach((value, name) => { if (name !== "content-length" && name !== "content-encoding" && name !== "set-cookie") responseHeaders[name] = value; });
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  if (cookies.length) responseHeaders["set-cookie"] = cookies;
  const location = response.headers.get("location");
  if (location) responseHeaders.location = location.startsWith(edgeOrigin) ? `https://${req.headers.host}${location.slice(edgeOrigin.length)}` : location;
  responseHeaders["content-length"] = String(body.length);
  res.writeHead(response.status, responseHeaders);
  res.end(body);
}

await ensureTables();
const vinext = spawn(resolve("node_modules/.bin/vinext"), ["start", "--port", String(appPort), "--hostname", "127.0.0.1"], { stdio: "inherit", env: { ...process.env, PORT: String(appPort) } });
vinext.on("exit", (code) => { if (code) process.exit(code); });

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `https://${req.headers.host || "oddsaura.local"}`);
    if (url.pathname === "/api/health" && req.method === "GET") return json(res, 200, { ok: true, service: "oddsaura", database: Boolean(pool), time: new Date().toISOString() });
    if (url.pathname === "/api/public/convert") return await publicConverterApi(req, res);
    if (url.pathname.startsWith("/api/public/x-results/")) return await publicXResultApi(req, res, url);
    if (!pool) {
      if (edgeOrigin) return await proxyEdge(req, res);
      const pageProtected = protectedPages.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`));
      const apiProtected = url.pathname.startsWith("/api/auth/") || protectedApis.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`));
      if (apiProtected) return json(res, 503, { error: "Account storage is not configured yet." });
      if (pageProtected) {
        const next = encodeURIComponent(`${url.pathname}${url.search}`);
        res.writeHead(302, { location: `/login?next=${next}`, "cache-control": "no-store" });
        return res.end();
      }
      return proxy(req, res, null);
    }
    if (url.pathname.startsWith("/api/auth/")) return await authApi(req, res, url);
    const pageProtected = protectedPages.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`));
    const apiProtected = protectedApis.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`));
    const user = pageProtected || apiProtected ? await identity(req) : null;
    if ((pageProtected || apiProtected) && !user) { if (apiProtected) return json(res, 401, { error: "Log in to continue." }); const next = encodeURIComponent(`${url.pathname}${url.search}`); res.writeHead(302, { location: `/login?next=${next}`, "cache-control": "no-store" }); return res.end(); }
    if ((url.pathname === "/admin" || url.pathname.startsWith("/admin/")) && user?.role !== "ADMIN") { res.writeHead(302, { location: "/dashboard", "cache-control": "no-store" }); return res.end(); }
    const providerCodeMatch = url.pathname.match(/^\/api\/providers\/(sportybet|betpawa|bet9ja|betking|betway)\/code$/);
    if (url.pathname === "/api/providers/convert") return await converterApi(req, res, user);
    if (providerCodeMatch) return await bookmakerApi(req, res, user, providerCodeMatch[1]);
    if (url.pathname === "/api/sportybet/code") return await bookmakerApi(req, res, user, "sportybet");
    if (url.pathname === "/api/account" || url.pathname === "/api/slips" || url.pathname.startsWith("/api/slips/")) return await slipsApi(req, res, url, user);
    if (url.pathname === "/api/codes") return await codesApi(req, res, user);
    if (url.pathname === "/api/ticket-controls") return await ticketControlsApi(req, res);
    if (url.pathname.startsWith("/api/admin/")) return await adminApi(req, res, url, user);
    return proxy(req, res, user);
  } catch (error) { console.error(error); return json(res, 500, { error: "OddsAura could not complete this request." }); }
}).listen(port, "0.0.0.0", () => console.log(`OddsAura listening on ${port}`));

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { vinext.kill(signal); await pool?.end(); process.exit(0); });
