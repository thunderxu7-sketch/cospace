import { validateRuntime } from "../server/config";
import { pool } from "../server/db";
import { bootstrapWorkspace } from "../server/email-auth";
import { requireMigrations } from "../server/migrate";

try {
  validateRuntime();
  const [, , name, email] = process.argv;
  if (!name || !email)
    throw new Error(
      "Usage: npm run pilot:bootstrap -- <workspace-name> <owner-email>",
    );
  await requireMigrations(pool);
  console.log("工作区邀请已发送", await bootstrapWorkspace(name, email));
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Workspace bootstrap failed",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
