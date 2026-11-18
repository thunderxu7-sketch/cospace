import {
  expect,
  test as base,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";
import type {
  CreateTasksResult,
  MobileIdentity,
  MobilePairing,
  MobileReviewSummary,
  MobileSession,
  Page,
  RunDetail,
  Task,
} from "../../packages/contracts/src";
import {
  apiOrigin,
  demoPassword,
  digest,
  mobileFixtures,
  webOrigin,
} from "../mobile/fixtures.mjs";
import { startResponseDropProxy } from "../mobile/response-drop.mjs";

type MobileFixtures = ReturnType<typeof mobileFixtures>;
type Role = "lin" | "chen" | "guest";
type WebStorage = Awaited<ReturnType<APIRequestContext["storageState"]>>;

const test = base.extend<
  {
    fixtures: MobileFixtures;
    mobile: APIRequestContext;
    web: (id?: Role) => Promise<APIRequestContext>;
  },
  { webSessions: Record<Role, WebStorage> }
>({
  webSessions: [
    async ({ playwright }, use) => {
      const shared = mobileFixtures();
      async function login(id: Role) {
        const client = await playwright.request.newContext({
          baseURL: webOrigin,
        });
        try {
          return await webLogin(client, shared, id);
        } finally {
          await client.dispose();
        }
      }
      try {
        // A full browser run also exercises the demo server's Web sign-in limit.
        await use({
          lin: await login("lin"),
          chen: await login("chen"),
          guest: await login("guest"),
        });
      } finally {
        await shared.cleanup();
      }
    },
    { scope: "worker" },
  ],
  fixtures: async ({}, use) => {
    const fixtures = mobileFixtures();
    try {
      await use(fixtures);
    } finally {
      await fixtures.cleanup();
    }
  },
  mobile: async ({ playwright }, use) => {
    // Browser and native cookie jars must stay separate even on different ports.
    const mobile = await playwright.request.newContext({ baseURL: apiOrigin });
    try {
      await use(mobile);
    } finally {
      await mobile.dispose();
    }
  },
  web: async ({ playwright, webSessions }, use) => {
    const contexts: APIRequestContext[] = [];
    try {
      await use(async (id = "lin") => {
        const context = await playwright.request.newContext({
          baseURL: webOrigin,
          storageState: webSessions[id],
        });
        contexts.push(context);
        return context;
      });
    } finally {
      await Promise.all(contexts.map((context) => context.dispose()));
    }
  },
});

const webHeaders = { origin: webOrigin };
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const detail = (id: string) => `/api/runs/${id}`;
const taskUrl = (id: string) => `/api/tasks/${id}`;

async function json<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), `${response.status()} ${response.url()}`).toBe(true);
  return (await response.json()) as T;
}

async function webLogin(
  web: APIRequestContext,
  fixtures: MobileFixtures,
  id: Role,
) {
  const response = await web.post("/api/login", {
    headers: webHeaders,
    data: { id, password: demoPassword },
  });
  expect(
    response.ok(),
    `POST /api/login for ${id} returned ${response.status()}`,
  ).toBe(true);
  const storage = await web.storageState();
  const cookie = storage.cookies.find((item) => item.name === "cs_session");
  expect(cookie).toBeDefined();
  fixtures.trackWebSession(cookie!.value);
  return storage;
}

async function issuePairing(web: APIRequestContext, fixtures: MobileFixtures) {
  const pairing = await json<MobilePairing>(
    await web.post("/api/mobile/pairings", { headers: webHeaders }),
  );
  fixtures.trackPairing(pairing.code);
  return pairing;
}

async function exchange(
  mobile: APIRequestContext,
  fixtures: MobileFixtures,
  code: string,
) {
  const session = await json<MobileSession>(
    await mobile.post("/api/mobile/session", { data: { code } }),
  );
  fixtures.trackSession(session.token);
  return session;
}

async function connectMobile(
  web: APIRequestContext,
  mobile: APIRequestContext,
  fixtures: MobileFixtures,
) {
  const { code } = await issuePairing(web, fixtures);
  return bearer((await exchange(mobile, fixtures, code)).token);
}

test("web pairing UI and mobile confirmation update another user's open task table", async ({
  browser,
  page,
  fixtures,
  mobile,
  webSessions,
}) => {
  const other = await browser.newContext();
  try {
    const run = await fixtures.seedRun({
      createdAt: new Date(Date.now() + 30_000).toISOString(),
    });
    await page.context().addCookies(webSessions.lin.cookies);
    await other.addCookies(webSessions.chen.cookies);
    const observer = await other.newPage();
    await observer.goto("/");
    await observer.getByRole("button", { name: /^任务 \d+$/ }).click();
    await expect(observer.getByText("实时连接", { exact: true })).toBeVisible();
    await observer
      .getByRole("textbox", { name: "筛选任务" })
      .fill(run.id.slice(0, 8));
    const taskRow = (title: string) =>
      observer.getByRole("textbox", { name: `任务名称 ${title}`, exact: true });
    for (const title of run.titles) await expect(taskRow(title)).toHaveCount(0);

    await page.goto("/");
    await page.getByRole("button", { name: "连接手机" }).click();
    const code = page.getByTestId("mobile-pairing-code");
    await expect(code).toHaveText(/^[A-Z0-9]{8}$/);
    const value = (await code.innerText()).trim();
    fixtures.trackPairing(value);
    const headers = bearer((await exchange(mobile, fixtures, value)).token);
    const pending = await json<RunDetail>(
      await mobile.get(detail(run.id), { headers }),
    );
    expect(pending).toMatchObject({
      status: "ready",
      documentTitle: "团队随手记",
      sources: [{ id: "notes", text: run.snapshot }],
    });
    await page.getByRole("button", { name: "关闭手机配对" }).click();
    await page.getByRole("button", { name: "AI 工作流", exact: true }).click();
    await page.getByRole("button", { name: "查看我的运行记录" }).click();
    await page.locator(".run-history button").first().click();
    await expect(page.getByText(run.titles[0], { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "确认应用", exact: true }),
    ).toBeVisible();

    const applied = await json<{ ok: true; result: CreateTasksResult }>(
      await mobile.post(`${detail(run.id)}/apply`, { headers }),
    );
    for (const title of run.titles) await expect(taskRow(title)).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      page.getByText("已应用到工作区", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "确认应用", exact: true }),
    ).toHaveCount(0);
    const { rows } = await fixtures.database.query<{
      id: string;
      title: string;
    }>("SELECT id,title FROM tasks WHERE source=$1 ORDER BY title", [run.id]);
    expect(rows.map((row) => row.id).sort()).toEqual(
      [...applied.result.taskIds].sort(),
    );
    expect(rows.map((row) => row.title).sort()).toEqual([...run.titles].sort());
  } finally {
    await other.close();
  }
});

test("pairing codes expire and can be consumed only once, and mobile sessions can be revoked", async ({
  web,
  mobile,
  fixtures,
}) => {
  expect((await mobile.get("/api/mobile/me")).status()).toBe(401);
  const request = await web();
  expect(
    (
      await request.post("/api/mobile/pairings", {
        headers: { origin: "https://example.invalid" },
      })
    ).status(),
  ).toBe(403);
  const expired = await issuePairing(request, fixtures);
  await fixtures.database.query(
    "UPDATE mobile_pairings SET expires_at=now()-interval '1 second' WHERE code_hash=$1",
    [digest(expired.code)],
  );
  expect(
    (
      await mobile.post("/api/mobile/session", { data: { code: expired.code } })
    ).status(),
  ).toBe(401);

  const pairing = await issuePairing(request, fixtures);
  expect(Date.parse(pairing.expiresAt)).toBeGreaterThan(Date.now());
  const responses = await Promise.all(
    [0, 1].map(() =>
      mobile.post("/api/mobile/session", { data: { code: pairing.code } }),
    ),
  );
  const successful = responses.filter((response) => response.ok());
  for (const response of successful)
    fixtures.trackSession((await response.json()).token);
  expect(successful).toHaveLength(1);
  expect(responses.find((response) => !response.ok())?.status()).toBe(401);
  const session = await json<MobileSession>(successful[0]);
  const headers = bearer(session.token);
  const identity = await json<MobileIdentity>(
    await mobile.get("/api/mobile/me", { headers }),
  );
  expect(identity.user).toMatchObject({ id: "lin", role: "editor" });
  expect(identity.members.map((member) => member.id).sort()).toEqual([
    "chen",
    "guest",
    "lin",
  ]);
  expect((await mobile.get("/api/workspace", { headers })).status()).toBe(403);
  expect((await request.get("/api/mobile/me", { headers })).status()).toBe(400);
  expect((await mobile.delete("/api/mobile/session", { headers })).ok()).toBe(
    true,
  );
  expect((await mobile.get("/api/mobile/me", { headers })).status()).toBe(401);
  expect((await request.get("/api/workspace")).ok()).toBe(true);

  const another = await issuePairing(request, fixtures);
  const expiredSession = await exchange(mobile, fixtures, another.code);
  await fixtures.database.query(
    "UPDATE mobile_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
    [digest(expiredSession.token)],
  );
  expect(
    (
      await mobile.get("/api/tasks", { headers: bearer(expiredSession.token) })
    ).status(),
  ).toBe(401);
});

test("native writes honor run ownership, operation type and viewer permissions", async ({
  web,
  mobile,
  fixtures,
}) => {
  const owned = await fixtures.seedRun();
  const foreign = await fixtures.seedRun({ owner: "chen" });
  const summary = await fixtures.seedRun({ mode: "summary" });
  const [taskId] = await fixtures.seedTasks();
  const request = await web();
  const headers = await connectMobile(request, mobile, fixtures);
  for (const id of [foreign.id, summary.id]) {
    expect((await mobile.get(detail(id), { headers })).status()).toBe(404);
    expect(
      (await mobile.post(`${detail(id)}/apply`, { headers })).status(),
    ).toBe(404);
    expect(
      (await mobile.post(`${detail(id)}/reject`, { headers })).status(),
    ).toBe(404);
  }
  expect((await request.get(detail(summary.id))).ok()).toBe(true);
  expect(
    (await mobile.post(`${detail(owned.id)}/undo`, { headers })).status(),
  ).toBe(403);
  expect(
    (
      await mobile.patch(taskUrl(taskId), {
        headers,
        data: { version: 1, status: "doing", title: "unexpected edit" },
      })
    ).status(),
  ).toBe(400);

  const guest = await connectMobile(await web("guest"), mobile, fixtures);
  expect((await mobile.get(taskUrl(taskId), { headers: guest })).ok()).toBe(
    true,
  );
  expect(
    (
      await mobile.patch(taskUrl(taskId), {
        headers: guest,
        data: { version: 1, status: "done" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await mobile.post(`${detail(owned.id)}/apply`, { headers: guest })
    ).status(),
  ).toBe(403);
  const { rows } = await fixtures.database.query(
    "SELECT id FROM tasks WHERE source=ANY($1::text[])",
    [[owned.id, foreign.id, summary.id]],
  );
  expect(rows).toEqual([]);
});

test("inbox filters before pagination and keeps rows with equal timestamps", async ({
  web,
  mobile,
  fixtures,
}) => {
  const createdAt = new Date(Date.now() + 45_000).toISOString();
  const runs = [];
  for (let i = 0; i < 3; i++) runs.push(await fixtures.seedRun({ createdAt }));
  await fixtures.seedRun({ createdAt, owner: "chen" });
  await fixtures.seedRun({ createdAt, status: "applied" });
  const newer = new Date(Date.parse(createdAt) + 1000).toISOString();
  for (let i = 0; i < 21; i++)
    await fixtures.seedRun({ mode: "summary", createdAt: newer });
  const headers = await connectMobile(await web(), mobile, fixtures);
  const first = await json<Page<MobileReviewSummary>>(
    await mobile.get("/api/mobile/reviews?limit=2", { headers }),
  );
  expect(first.items).toHaveLength(2);
  expect(first.nextCursor).toBeTruthy();
  const second = await json<Page<MobileReviewSummary>>(
    await mobile.get("/api/mobile/reviews", {
      headers,
      params: { limit: 2, cursor: first.nextCursor! },
    }),
  );
  const items = [...first.items, ...second.items].slice(0, 3);
  expect(items.map((item) => item.id)).toEqual(
    runs
      .map((run) => run.id)
      .sort()
      .reverse(),
  );
  for (const item of items)
    expect(item).toMatchObject({ documentTitle: "团队随手记", taskCount: 2 });
});

test("two devices confirming concurrently receive one batch of task IDs", async ({
  web,
  mobile,
  fixtures,
}) => {
  const run = await fixtures.seedRun();
  const request = await web();
  const headers = await connectMobile(request, mobile, fixtures);
  const path = `${detail(run.id)}/apply`;
  const responses = await Promise.all([
    mobile.post(path, { headers }),
    request.post(path, { headers: webHeaders }),
  ]);
  const [nativeResult, webResult] = await Promise.all(
    responses.map(json<{ ok: true; result: CreateTasksResult }>),
  );
  expect(nativeResult).toEqual(webResult);
  expect(nativeResult.result.taskIds).toHaveLength(2);
  const { rows } = await fixtures.database.query<{ id: string }>(
    "SELECT id FROM tasks WHERE source=$1",
    [run.id],
  );
  expect(rows.map(({ id }) => id).sort()).toEqual(
    [...nativeResult.result.taskIds].sort(),
  );
  expect(
    (await mobile.post(`${detail(run.id)}/reject`, { headers })).status(),
  ).toBe(409);
});

test("a committed confirmation with a lost HTTP response recovers the original receipt", async ({
  web,
  mobile,
  fixtures,
}) => {
  const run = await fixtures.seedRun();
  const headers = await connectMobile(await web(), mobile, fixtures);
  const proxy = await startResponseDropProxy({
    upstream: apiOrigin,
    runId: run.id,
  });
  try {
    await expect(
      fetch(`${proxy.origin}${detail(run.id)}/apply`, {
        method: "POST",
        headers,
      }),
    ).rejects.toThrow();
    expect(proxy.counts().drops).toBeGreaterThan(0);
    await expect(
      fetch(`${proxy.origin}${detail(run.id)}`, { headers }),
    ).rejects.toThrow();
    const { rows } = await fixtures.database.query<{ id: string }>(
      "SELECT id FROM tasks WHERE source=$1",
      [run.id],
    );
    expect(rows).toHaveLength(2);
    proxy.resume();
    const recovered = await fetch(`${proxy.origin}${detail(run.id)}`, {
      headers,
    });
    expect(recovered.ok).toBe(true);
    const receipt: RunDetail = await recovered.json();
    expect(receipt.status).toBe("applied");
    expect([...(receipt.result as CreateTasksResult).taskIds].sort()).toEqual(
      rows.map(({ id }) => id).sort(),
    );
    const retry = await json<{ ok: true; result: CreateTasksResult }>(
      await mobile.post(`${detail(run.id)}/apply`, { headers }),
    );
    expect(retry.result).toEqual(receipt.result);
  } finally {
    await proxy.close();
  }
});

test("rejected suggestions create nothing and a stale task write exposes the new version", async ({
  web,
  mobile,
  fixtures,
}) => {
  const run = await fixtures.seedRun();
  const request = await web();
  const headers = await connectMobile(request, mobile, fixtures);
  expect(
    (await mobile.post(`${detail(run.id)}/reject`, { headers })).ok(),
  ).toBe(true);
  expect(
    (
      await request.post(`${detail(run.id)}/apply`, { headers: webHeaders })
    ).status(),
  ).toBe(409);
  expect(
    await json<RunDetail>(await mobile.get(detail(run.id), { headers })),
  ).toMatchObject({ status: "rejected" });
  expect(
    (
      await fixtures.database.query("SELECT id FROM tasks WHERE source=$1", [
        run.id,
      ])
    ).rows,
  ).toEqual([]);

  const [id] = await fixtures.seedTasks();
  const stale = await json<Task>(await mobile.get(taskUrl(id), { headers }));
  const anotherEditor = await web("chen");
  const current = await json<Task>(
    await anotherEditor.patch(taskUrl(id), {
      headers: webHeaders,
      data: { version: stale.version, status: "done" },
    }),
  );
  const conflict = await mobile.patch(taskUrl(id), {
    headers,
    data: { version: stale.version, status: "doing" },
  });
  expect(conflict.status()).toBe(409);
  expect((await conflict.json()).current).toMatchObject({
    id,
    status: "done",
    version: current.version,
  });
  const updated = await json<Task>(
    await mobile.patch(taskUrl(id), {
      headers,
      data: { version: current.version, status: "doing" },
    }),
  );
  expect(updated).toMatchObject({
    id,
    status: "doing",
    version: current.version + 1,
  });
});

test("a 10,000-row task list fetches 30 at a time, preserving timestamp ties and precision", async ({
  web,
  mobile,
  fixtures,
}) => {
  const headers = await connectMobile(await web(), mobile, fixtures);
  const start = new Date(Date.now() + 45_000).toISOString();
  const exactTime = (fraction: string) => start.replace(/Z$/, `${fraction}Z`);
  await fixtures.seedTasks({ count: 9995, createdAt: exactTime("000") });
  await fixtures.seedTasks({ count: 4, createdAt: exactTime("002") });
  await fixtures.seedTasks({ assignee: "chen", createdAt: exactTime("001") });
  const { rows } = await fixtures.database.query<{ id: string }>(
    "SELECT id FROM tasks WHERE source=$1 AND assignee='lin' ORDER BY created_at DESC,id DESC LIMIT 60",
    [fixtures.namespace],
  );
  const first = await json<Page<Task>>(
    await mobile.get("/api/tasks?assignee=me", { headers }),
  );
  expect(first.items).toHaveLength(30);
  expect(first.nextCursor).toBeTruthy();
  const second = await json<Page<Task>>(
    await mobile.get("/api/tasks", {
      headers,
      params: { assignee: "me", cursor: first.nextCursor! },
    }),
  );
  expect([...first.items, ...second.items].map(({ id }) => id)).toEqual(
    rows.map(({ id }) => id),
  );
  const top = await json<Page<Task>>(
    await mobile.get("/api/tasks?assignee=all&limit=4", { headers }),
  );
  const next = await json<Page<Task>>(
    await mobile.get("/api/tasks", {
      headers,
      params: { assignee: "all", limit: 4, cursor: top.nextCursor! },
    }),
  );
  expect(top.items.map(({ assignee }) => assignee)).toEqual([
    "lin",
    "lin",
    "lin",
    "lin",
  ]);
  expect(next.items[0].assignee).toBe("chen");
  expect(
    (await mobile.get("/api/tasks?cursor=invalid", { headers })).status(),
  ).toBe(400);
});
