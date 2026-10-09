import { migrate } from "drizzle-orm/node-postgres/migrator";
import { resolve } from "node:path";
import { loadConfig } from "../config";
import { createDatabase } from "./client";

const config = loadConfig();
const { pool, db } = createDatabase(config);

try {
  await migrate(db, {
    migrationsFolder:
      process.env.MIGRATIONS_DIR ??
      resolve(process.cwd(), "server/db/migrations"),
  });
  console.log("Database migrations applied.");
} finally {
  await pool.end();
}
