import { test, expect, type APIRequestContext } from "@playwright/test";
import pg from "pg";
import { randomUUID } from "node:crypto";
const origin = "http://127.0.0.1:3027";
const db = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgres://cospace:cospace_local_only@127.0.0.1:55437/cospace",
});
const taskIds: string[] = [],
  messageIds: string[] = [],
  runIds: string[] = [],
  clientIds: string[] = [];
async function login(request: APIRequestContext, id = "lin") {
  const r = await request.post("/api/login", {
    headers: { origin },
    data: { id, password: "cospace-demo-2026" },
  });
  expect(r.ok()).toBe(true);
}
async function create(
  request: APIRequestContext,
  title = "[test] isolated task",
) {
  const clientId = randomUUID();
  clientIds.push(clientId);
  const r = await request.post("/api/tasks", {
    headers: { origin },
    data: { title, clientId },
  });
  expect(r.ok()).toBe(true);
  const t = await r.json();
  taskIds.push(t.id);
  return { ...t, clientId };
}
async function proposal(op: unknown) {
  const id = randomUUID();
  runIds.push(id);
  await db.query(
    "INSERT INTO runs(id,user_id,mode,status,proposal) VALUES($1,'lin','tasks','ready',$2)",
    [id, JSON.stringify(op)],
  );
  return id;
}
test.afterAll(async () => {
  await db.query("DELETE FROM messages WHERE id=ANY($1::uuid[])", [messageIds]);
  await db.query(
    "DELETE FROM tasks WHERE id=ANY($1::uuid[]) OR source=ANY($2::text[])",
    [taskIds, runIds],
  );
  await db.query("DELETE FROM runs WHERE id=ANY($1::uuid[])", [runIds]);
  await db.query("DELETE FROM mutations WHERE client_id=ANY($1::text[])", [
    clientIds,
  ]);
  await db.end();
});
test("authentication, origin and viewer write boundary", async ({
  request,
}) => {
  expect((await request.get("/api/workspace")).status()).toBe(401);
  await login(request, "guest");
  expect(
    (
      await request.post("/api/tasks", {
        headers: { origin },
        data: { title: "blocked", clientId: randomUUID() },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/collab/token", {
        headers: { origin: "https://example.invalid" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (await request.post("/api/collab/token", { headers: { origin } })).ok(),
  ).toBe(true);
});
test("message acknowledgements and task creation are idempotent", async ({
  request,
}) => {
  await login(request);
  const clientId = randomUUID();
  const data = { body: "[test] idempotent message", clientId };
  const responses = await Promise.all([
    request.post("/api/messages", { headers: { origin }, data }),
    request.post("/api/messages", { headers: { origin }, data }),
  ]);
  const [a, b] = await Promise.all(responses.map((r) => r.json()));
  messageIds.push(a.id);
  expect(a.id).toBe(b.id);
  const task = await create(request);
  const again = await request.post("/api/tasks", {
    headers: { origin },
    data: { title: task.title, clientId: task.clientId },
  });
  expect((await again.json()).id).toBe(task.id);
});
test("concurrent task writes accept one version and reject a stale edit", async ({
  request,
}) => {
  await login(request);
  const task = await create(request);
  const edits = await Promise.all(
    ["doing", "done"].map((status) =>
      request.patch("/api/tasks/" + task.id, {
        headers: { origin },
        data: { version: 1, status },
      }),
    ),
  );
  expect(edits.map((r) => r.status()).sort()).toEqual([200, 409]);
  const conflict = await edits.find((r) => r.status() === 409)!.json();
  expect(conflict.current.version).toBe(2);
  expect(
    (
      await request.patch("/api/tasks/" + task.id, {
        headers: { origin },
        data: { version: 2, start_at: "2026-11-23T09:00:00+08:00" },
      })
    ).status(),
  ).toBe(400);
});
test("AI task apply is atomic, idempotent and safely reversible", async ({
  request,
}) => {
  await login(request);
  const id = await proposal({
    type: "create_tasks",
    tasks: [{ title: "[test] AI action", assignee: "lin", due_at: null }],
  });
  const first = await request.post("/api/runs/" + id + "/apply", {
    headers: { origin },
  });
  expect(first.ok()).toBe(true);
  const second = await request.post("/api/runs/" + id + "/apply", {
    headers: { origin },
  });
  expect(await second.json()).toEqual(await first.json());
  expect(
    (
      await request.post("/api/runs/" + id + "/undo", { headers: { origin } })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.post("/api/runs/" + id + "/undo", { headers: { origin } })
    ).ok(),
  ).toBe(true);
  expect(
    (await db.query("SELECT count(*) FROM tasks WHERE source=$1", [id])).rows[0]
      .count,
  ).toBe("0");
});
test("AI undo refuses to remove a task changed by a collaborator", async ({
  request,
}) => {
  await login(request);
  const id = await proposal({
    type: "create_tasks",
    tasks: [{ title: "[test] protected action", assignee: "lin" }],
  });
  const applied = await (
    await request.post("/api/runs/" + id + "/apply", { headers: { origin } })
  ).json();
  await request.patch("/api/tasks/" + applied.result.taskIds[0], {
    headers: { origin },
    data: { version: 1, status: "doing" },
  });
  expect(
    (
      await request.post("/api/runs/" + id + "/undo", { headers: { origin } })
    ).status(),
  ).toBe(409);
});
test("document proposals reject stale context, retry once, and undo without losing original formatting", async ({
  request,
}) => {
  await login(request);
  const before = await (
    await request.get("/api/documents/notes/context")
  ).json();
  const id = await proposal({
    type: "append_document",
    documentId: "notes",
    baseHash: before.hash,
    text: "[test] guarded document proposal",
  });
  const stale = await proposal({
    type: "append_document",
    documentId: "notes",
    baseHash: before.hash,
    text: "[test] must never overwrite",
  });
  try {
    expect(
      (
        await request.post("/api/runs/" + id + "/apply", {
          headers: { origin },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await request.post("/api/runs/" + id + "/apply", {
          headers: { origin },
        })
      ).ok(),
    ).toBe(true);
    const current = await (
      await request.get("/api/documents/notes/context")
    ).json();
    expect(current.text.split("[test] guarded document proposal").length).toBe(
      2,
    );
    expect(
      (
        await request.post("/api/runs/" + stale + "/apply", {
          headers: { origin },
        })
      ).status(),
    ).toBe(409);
  } finally {
    expect(
      (
        await request.post("/api/runs/" + id + "/undo", { headers: { origin } })
      ).ok(),
    ).toBe(true);
  }
  expect(
    await (await request.get("/api/documents/notes/context")).json(),
  ).toEqual(before);
});
test("schedule conflict rejects the whole batch and a valid schedule can be undone", async ({
  request,
}) => {
  await login(request);
  const a = await create(request),
    b = await create(request);
  const slot = {
    version: 1,
    start_at: "2030-01-07T01:00:00Z",
    end_at: "2030-01-07T02:00:00Z",
  };
  const conflict = await proposal({
    type: "schedule_tasks",
    schedules: [
      { id: a.id, ...slot },
      { id: b.id, ...slot },
    ],
  });
  expect(
    (
      await request.post("/api/runs/" + conflict + "/apply", {
        headers: { origin },
      })
    ).status(),
  ).toBe(409);
  expect(
    (await db.query("SELECT start_at FROM tasks WHERE id=$1", [a.id])).rows[0]
      .start_at,
  ).toBeNull();
  const valid = await proposal({
    type: "schedule_tasks",
    schedules: [{ id: a.id, ...slot }],
  });
  expect(
    (
      await request.post("/api/runs/" + valid + "/apply", {
        headers: { origin },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.post("/api/runs/" + valid + "/undo", {
        headers: { origin },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (await db.query("SELECT start_at,version FROM tasks WHERE id=$1", [a.id]))
      .rows[0],
  ).toEqual({ start_at: null, version: 3 });
});
test("budget optimistic version check preserves newer snapshot", async ({
  request,
}) => {
  await login(request);
  const before = await (await request.get("/api/budget")).json();
  // Re-save the original snapshot to exercise compare-and-swap without changing its contents.
  const snapshot = before.snapshot || {
    id: "budget",
    name: "test fixture",
    sheetOrder: [],
    sheets: {},
  };
  try {
    expect(
      (
        await request.put("/api/budget", {
          headers: { origin },
          data: { version: before.version, snapshot },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await request.put("/api/budget", {
          headers: { origin },
          data: { version: before.version, snapshot: { id: "stale" } },
        })
      ).status(),
    ).toBe(409);
    expect((await (await request.get("/api/budget")).json()).snapshot).toEqual(
      snapshot,
    );
  } finally {
    if (!before.snapshot)
      await db.query(
        "UPDATE sheets SET snapshot=null WHERE id='budget' AND version=$1",
        [before.version + 1],
      );
  }
});
