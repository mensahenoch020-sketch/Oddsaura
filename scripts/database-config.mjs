const firstPresent = (env, names) => {
  for (const name of names) {
    const value = String(env[name] || "").trim();
    if (value) return value;
  }
  return null;
};

export function resolveDatabaseUrl(env = process.env) {
  const direct = firstPresent(env, [
    "DATABASE_URL",
    "DATABASE_PRIVATE_URL",
    "DATABASE_PUBLIC_URL",
    "POSTGRES_URL",
    "POSTGRESQL_URL",
  ]);
  if (direct) return direct;

  const host = String(env.PGHOST || "").trim();
  const port = String(env.PGPORT || "5432").trim();
  const user = String(env.PGUSER || "").trim();
  const password = String(env.PGPASSWORD || "");
  const database = String(env.PGDATABASE || "").trim();
  if (!host || !port || !user || !password || !database) return null;

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
}
