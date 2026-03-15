// Database configuration with local Postgres fallback.
// USE_NEON_SERVERLESS=true enables Neon websocket mode.
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import pg from "pg";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import ws from "ws";
import * as schema from "@shared/schema";
import { logger } from "./logger";
const { Pool: PgPool } = pg;

const useNeon = process.env.USE_NEON_SERVERLESS === "true";
const databaseUrl = process.env.DATABASE_URL;

let pool: any;
let db: any;

if (!databaseUrl) {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }

  const missingDatabaseError = () => new Error(
    "DATABASE_URL is not configured for this test run. Provide a test database before executing database-backed code.",
  );
  pool = null;
  db = new Proxy({}, {
    get() {
      throw missingDatabaseError();
    },
  });
  logger.warn("Database driver: test stub (DATABASE_URL not set)");
} else if (useNeon) {
  neonConfig.webSocketConstructor = ws;
  pool = new NeonPool({ connectionString: databaseUrl });
  db = drizzleNeon({ client: pool, schema });
  logger.info("Database driver: Neon Serverless (websocket)");
} else {
  pool = new PgPool({
    connectionString: databaseUrl,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
  });
  db = drizzlePg({ client: pool, schema });
  logger.info("Database driver: Local Postgres (pg)");
}

export { pool, db };
