import { validateRuntime } from "../server/config";
import { pool } from "../server/db";
import { migrate } from "../server/migrate";

try {
  validateRuntime();
  await migrate(pool);
} finally {
  await pool.end();
}
