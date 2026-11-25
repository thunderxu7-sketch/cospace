import { readFile } from "node:fs/promises";
import type { Pool } from "pg";

const versions = ["001-demo-schema.sql", "002-workspaces.sql"];

export async function migrate(db: Pool) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(93867201)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY)",
    );
    const { rows } = await client.query<{ version: string }>(
      "SELECT version FROM schema_migrations",
    );
    const applied = new Set(rows.map((row) => row.version));
    for (const version of versions) {
      if (applied.has(version)) continue;
      await client.query(
        await readFile(
          new URL(`./migrations/${version}`, import.meta.url),
          "utf8",
        ),
      );
      await client.query("INSERT INTO schema_migrations VALUES ($1)", [
        version,
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function requireMigrations(db: Pool) {
  const { rows } = await db.query<{ version: string }>(
    "SELECT version FROM schema_migrations",
  );
  const applied = new Set(rows.map((row) => row.version));
  if (versions.some((version) => !applied.has(version)))
    throw new Error("CoSpace schema is out of date. Run npm run db:migrate.");
}
