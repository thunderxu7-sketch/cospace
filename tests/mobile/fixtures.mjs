import { createHash, randomUUID } from "node:crypto";
import pg from "pg";

export const webOrigin = process.env.APP_ORIGIN || "http://127.0.0.1:3027";
export const apiOrigin =
  process.env.COSPACE_TEST_API_ORIGIN || "http://127.0.0.1:4027";
export const demoPassword = "cospace-demo-2026";

/** @param {string} secret */
export const digest = (secret) =>
  createHash("sha256").update(secret).digest("hex");

export function mobileFixtures() {
  const database = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ||
      "postgres://cospace:cospace_local_only@127.0.0.1:55437/cospace",
  });
  const namespace = randomUUID();
  /** @type {string[]} */
  const runIds = [];
  /** @type {string[]} */
  const pairingHashes = [];
  /** @type {string[]} */
  const sessionHashes = [];
  /** @type {string[]} */
  const webSessionHashes = [];

  async function seedRun({
    owner = "lin",
    mode = "tasks",
    status = "ready",
    createdAt = new Date().toISOString(),
  } = {}) {
    const id = randomUUID();
    const suffix = id.slice(0, 8);
    const snapshot = `验收快照 ${suffix} 包含两项发布事项`;
    const titles = [
      `验收 ${suffix} 核对发布说明`,
      `验收 ${suffix} 核对复盘清单`,
    ];
    const proposal =
      mode === "tasks"
        ? {
            type: "create_tasks",
            tasks: [
              { title: titles[0], assignee: "lin", due_at: null },
              {
                title: titles[1],
                assignee: "chen",
                due_at: "2030-11-20T10:00:00Z",
              },
            ],
          }
        : { type: "append_document", documentId: "notes", text: snapshot };
    runIds.push(id);
    await database.query(
      `INSERT INTO runs(id,user_id,mode,status,proposal,sources,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        owner,
        mode,
        status,
        JSON.stringify(proposal),
        JSON.stringify([{ id: "notes", text: snapshot }]),
        createdAt,
      ],
    );
    return { id, titles, snapshot };
  }

  async function seedTasks({
    count = 1,
    assignee = "lin",
    createdAt = new Date().toISOString(),
  } = {}) {
    const { rows } = await database.query(
      `INSERT INTO tasks(id,title,assignee,source,created_at)
       SELECT gen_random_uuid(),$1 || ' task ' || n,$2,$3,$4
       FROM generate_series(1,$5) n RETURNING id`,
      [`[seed ${namespace}]`, assignee, namespace, createdAt, count],
    );
    return rows.map(({ id }) => String(id));
  }

  /** @param {string} id */
  function trackRun(id) {
    runIds.push(id);
  }

  /** @param {string} code */
  function trackPairing(code) {
    pairingHashes.push(digest(code));
  }

  /** @param {string} token */
  function trackSession(token) {
    sessionHashes.push(digest(token));
  }

  /** @param {string} token */
  function trackWebSession(token) {
    webSessionHashes.push(digest(token));
  }

  async function cleanup() {
    let client;
    try {
      client = await database.connect();
      await client.query("BEGIN");
      // A device can disconnect before the server's transaction finishes.
      await client.query(
        "SELECT id FROM runs WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
        [runIds],
      );
      await client.query("DELETE FROM tasks WHERE source=ANY($1::text[])", [
        [namespace, ...runIds],
      ]);
      await client.query("DELETE FROM runs WHERE id=ANY($1::uuid[])", [runIds]);
      if (pairingHashes.length)
        await client.query(
          "DELETE FROM mobile_pairings WHERE code_hash=ANY($1::text[])",
          [pairingHashes],
        );
      if (sessionHashes.length)
        await client.query(
          "DELETE FROM mobile_sessions WHERE token_hash=ANY($1::text[])",
          [sessionHashes],
        );
      if (webSessionHashes.length)
        await client.query("DELETE FROM sessions WHERE token=ANY($1::text[])", [
          webSessionHashes,
        ]);
      await client.query("COMMIT");
    } catch (error) {
      await client?.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client?.release();
      await database.end();
    }
  }

  return {
    database,
    namespace,
    seedRun,
    seedTasks,
    trackRun,
    trackPairing,
    trackSession,
    trackWebSession,
    cleanup,
  };
}
