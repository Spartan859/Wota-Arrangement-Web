import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { AppConfig } from "../config";
import * as schema from "./schema";

export function createDatabase(config: Pick<AppConfig, "DATABASE_URL">) {
  const pool = new Pool({ connectionString: config.DATABASE_URL });
  const db = drizzle(pool, { schema });
  return { pool, db };
}

export type Database = ReturnType<typeof createDatabase>["db"];
