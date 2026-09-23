import { auditLogs } from "../db/schema";
import { loadConfig } from "../config";
import { createDatabase } from "../db/client";
import { KeycloakAdminService } from "../services/keycloak-admin";
import { upsertProvisionedUser } from "../services/users";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const email = argument("--email")?.trim();
const name = argument("--name")?.trim() || email;
if (!email || !name) {
  console.error(
    'Usage: npm run admin:create -- --email <email> --name "<display name>"',
  );
  process.exit(2);
}

const config = loadConfig();
const { db, pool } = createDatabase(config);
const keycloak = new KeycloakAdminService(config);

try {
  const provisioned = await keycloak.provisionUser({
    email,
    name,
    isAdmin: true,
  });
  const user = await upsertProvisionedUser(db, config, {
    ...provisioned,
    isAdmin: true,
  });
  await db.insert(auditLogs).values({
    action: "bootstrap_admin",
    targetType: "user",
    targetId: user.id,
    details: { email: user.email, source: "server-script" },
  });
  console.log(`Admin provisioned: ${user.email}`);
} finally {
  await pool.end();
}
