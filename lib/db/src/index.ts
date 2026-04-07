import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Supabase session pooler (PgBouncer) compatible settings:
// - max: keep small — free tier has limited server connections; pooler multiplexes them
// - idleTimeoutMillis: release idle connections quickly to free pooler slots
// - connectionTimeoutMillis: fail fast rather than queue indefinitely
// SSL is handled via ?sslmode=require in the Supabase connection string itself.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX ?? "5", 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (err) => {
  console.error("[db] Unexpected pool error:", err.message);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
