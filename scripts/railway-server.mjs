import { createServer, request as httpRequest } from "node:http";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { timingSafeEqual } from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const port = Number(process.env.PORT || 3000);
const appPort = Number(process.env.INTERNAL_APP_PORT || (port === 3001 ? 3002 : 3001));
const cookieName = "oa_session";
const sessionSeconds = 60 * 60 * 24 * 30;
const passwordIterations = 100_000;
const encoder = new TextEncoder();
const protectedPages = ["/dashboard", "/matches", "/builder", "/results", "/account", "/admin"];
const protectedApis = ["/api/sportybet/code", "/api/account", "/api/slips"];
const edgeOrigin = (process.env.ODDSAURA_EDGE_ORIGIN || "https://oddsaura.chipsofrio.chatgpt.site").replace(/\/$/, "");

const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;

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
  await pool.query(`CREATE TABLE IF NOT EXISTS oa_users (email TEXT PRIMARY KEY, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS oa_sessions (token_hash TEXT PRIMARY KEY, user_email TEXT NOT NULL REFERENCES oa_users(email) ON DELETE CASCADE, expires_at BIGINT NOT NULL, created_at BIGINT NOT NULL)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS oa_sessions_user_expires_idx ON oa_sessions(user_email, expires_at)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS oa_password_resets (token_hash TEXT PRIMARY KEY, user_email TEXT NOT NULL REFERENCES oa_users(email) ON DELETE CASCADE, expires_at BIGINT NOT NULL, used_at BIGINT, created_at BIGINT NOT NULL)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS oa_saved_slips (id TEXT PRIMARY KEY, user_email TEXT NOT NULL REFERENCES oa_users(email) ON DELETE CASCADE, name TEXT NOT NULL, picks_json TEXT NOT NULL, created_at BIGINT NOT NULL)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS oa_saved_slips_user_created_idx ON oa_saved_slips(user_email, created_at DESC)`);
}

async function createSession(email, maxAge = sessionSeconds) { const token = randomToken(); const now = Date.now(); await pool.query("INSERT INTO oa_sessions(token_hash,user_email,expires_at,created_at) VALUES($1,$2,$3,$4)", [await digest(token), email, now + maxAge * 1000, now]); return token; }
async function identity(req) { if (!pool) return null; const token = parseCookies(req.headers.cookie)[cookieName]; if (!token) return null; const result = await pool.query("SELECT u.email,u.display_name AS name FROM oa_sessions s JOIN oa_users u ON u.email=s.user_email WHERE s.token_hash=$1 AND s.expires_at>$2 LIMIT 1", [await digest(token), Date.now()]); return result.rows[0] || null; }

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

function proxy(req, res, user) {
  const headers = { ...req.headers, host: `127.0.0.1:${appPort}` };
  for (const name of Object.keys(headers)) if (name.startsWith("x-oddsaura-")) delete headers[name];
  if (user) { headers["x-oddsaura-user-email"] = user.email; headers["x-oddsaura-user-name"] = user.name; }
  const upstream = httpRequest({ hostname: "127.0.0.1", port: appPort, path: req.url, method: req.method, headers }, (upstreamResponse) => { res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers); upstreamResponse.pipe(res); });
  upstream.on("error", () => json(res, 502, { error: "OddsAura is starting. Please retry shortly." }));
  req.pipe(upstream);
}

async function proxyEdge(req, res) {
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
    if (!pool) return await proxyEdge(req, res);
    const url = new URL(req.url || "/", `https://${req.headers.host || "oddsaura.local"}`);
    if (url.pathname.startsWith("/api/auth/")) return await authApi(req, res, url);
    const pageProtected = protectedPages.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`));
    const apiProtected = protectedApis.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`));
    const user = pageProtected || apiProtected ? await identity(req) : null;
    if ((pageProtected || apiProtected) && !user) { if (apiProtected) return json(res, 401, { error: "Log in to continue." }); const next = encodeURIComponent(`${url.pathname}${url.search}`); res.writeHead(302, { location: `/login?next=${next}`, "cache-control": "no-store" }); return res.end(); }
    if (url.pathname === "/api/account" || url.pathname === "/api/slips" || url.pathname.startsWith("/api/slips/")) return await slipsApi(req, res, url, user);
    return proxy(req, res, user);
  } catch (error) { console.error(error); return json(res, 500, { error: "OddsAura could not complete this request." }); }
}).listen(port, "0.0.0.0", () => console.log(`OddsAura listening on ${port}`));

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { vinext.kill(signal); await pool?.end(); process.exit(0); });
