// Database configuration with local Postgres fallback.
// USE_NEON_SERVERLESS=true enables Neon websocket mode.
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { Pool as PgPool } from "pg";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import ws from "ws";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const useNeon = process.env.USE_NEON_SERVERLESS === "true";

let pool: any;
let db: any;

if (useNeon) {
  neonConfig.webSocketConstructor = ws;
  pool = new NeonPool({ connectionString: process.env.DATABASE_URL });
  db = drizzleNeon({ client: pool, schema });
  console.log("🗄️ Database driver: Neon Serverless (websocket)");
} else {
  pool = new PgPool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  db = drizzlePg({ client: pool, schema });
  console.log("🗄️ Database driver: Local Postgres (pg)");
}

export { pool, db };
