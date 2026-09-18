import assert from "node:assert/strict";
import test from "node:test";
import { resolveDatabaseUrl } from "../scripts/database-config.mjs";

test("Railway database configuration prefers the private application URL", () => {
  assert.equal(resolveDatabaseUrl({
    DATABASE_URL: "postgresql://private",
    DATABASE_PUBLIC_URL: "postgresql://public",
  }), "postgresql://private");
});

test("Railway database configuration accepts its public URL fallback", () => {
  assert.equal(resolveDatabaseUrl({
    DATABASE_PUBLIC_URL: "postgresql://public",
  }), "postgresql://public");
});

test("Railway database configuration builds a URL from referenced PG variables", () => {
  assert.equal(resolveDatabaseUrl({
    PGHOST: "postgres.railway.internal",
    PGPORT: "5432",
    PGUSER: "postgres",
    PGPASSWORD: "p@ss word",
    PGDATABASE: "railway",
  }), "postgresql://postgres:p%40ss%20word@postgres.railway.internal:5432/railway");
});

test("Railway database configuration remains disabled when no complete connection is exposed", () => {
  assert.equal(resolveDatabaseUrl({ PGHOST: "postgres.railway.internal" }), null);
});
