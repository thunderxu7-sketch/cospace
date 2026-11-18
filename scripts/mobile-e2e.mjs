import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import {
  artifactRoot,
  maestro,
  reverseAndroidPort,
} from "../tests/mobile/device-driver.mjs";
import {
  apiOrigin,
  demoPassword,
  mobileFixtures,
  webOrigin,
} from "../tests/mobile/fixtures.mjs";
import { startResponseDropProxy } from "../tests/mobile/response-drop.mjs";

const flags = new Set(process.argv.slice(2));
const android = flags.has("--android");
const lostResponse = flags.has("--lost-response");
const realModel = flags.has("--real-model");
if (
  [...flags].some(
    (flag) => !["--android", "--lost-response", "--real-model"].includes(flag),
  )
) {
  throw new Error(
    "Usage: node scripts/mobile-e2e.mjs [--android] [--lost-response] [--real-model]",
  );
}
if (lostResponse && !android)
  throw new Error("--lost-response requires --android for adb reverse");

const fixtures = mobileFixtures();

async function signIn(page, id) {
  const response = await page.request.post("/api/login", {
    headers: { origin: webOrigin },
    data: { id, password: demoPassword },
  });
  assert.ok(response.ok(), `Web sign-in returned ${response.status()}`);
  const cookie = (await page.context().cookies()).find(
    ({ name }) => name === "cs_session",
  );
  assert.ok(cookie, "Web sign-in did not set a session cookie");
  fixtures.trackWebSession(cookie.value);
  await page.goto("/");
}

async function recordRealModelRun(page) {
  await page
    .getByRole("navigation", { name: "项目视图" })
    .getByRole("button", { name: "文档", exact: true })
    .click();
  await expect(page.getByText("协作已连接", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "AI 工作流", exact: true }).click();
  const started = performance.now();
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/ai/generate") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "生成提取行动项", exact: true })
    .click();
  const response = await responsePromise;
  assert.ok(response.ok(), `AI generation returned ${response.status()}`);
  const events = (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const start = events.find((event) => event.type === "start");
  if (start) fixtures.trackRun(start.id);
  const failure = events.find((event) => event.type === "error");
  assert.ok(!failure, `AI generation failed: ${failure?.message}`);
  const ready = events.find((event) => event.type === "proposal");
  assert.equal(ready?.proposal?.type, "create_tasks");
  await expect(
    page.getByRole("button", { name: "确认应用", exact: true }),
  ).toBeVisible();
  return {
    id: ready.id,
    titles: ready.proposal.tasks.map(({ title }) => title),
    modelMs: Math.round(performance.now() - started),
  };
}

async function savedTasks(runId) {
  const { rows } = await fixtures.database.query(
    "SELECT id,title,version,status FROM tasks WHERE source=$1 ORDER BY title,id",
    [runId],
  );
  return rows;
}

let browser, proxy, restoreAndroidPort;
try {
  browser = await chromium.launch();
  const owner = await browser.newPage({
    baseURL: webOrigin,
    viewport: { width: 1440, height: 960 },
  });
  const observer = await browser.newPage({
    baseURL: webOrigin,
    viewport: { width: 1440, height: 960 },
  });
  await Promise.all([signIn(owner, "lin"), signIn(observer, "chen")]);
  const run = realModel
    ? await recordRealModelRun(owner)
    : await fixtures.seedRun();
  const artifactDir = resolve(artifactRoot, run.id);
  await mkdir(artifactDir, { recursive: true });
  assert.deepEqual(await savedTasks(run.id), []);
  await observer.getByRole("button", { name: /^任务 \d+$/ }).click();
  await expect(observer.getByText("实时连接", { exact: true })).toBeVisible();
  await observer.getByRole("textbox", { name: "筛选任务" }).fill(run.titles[0]);
  const firstTitle = observer.getByRole("textbox", {
    name: `任务名称 ${run.titles[0]}`,
    exact: true,
  });
  const before = await fixtures.database.query(
    "SELECT count(*)::int AS count FROM tasks WHERE title=$1",
    [run.titles[0]],
  );
  await expect(firstTitle).toHaveCount(before.rows[0].count);

  if (android) {
    proxy = await startResponseDropProxy({
      upstream: apiOrigin,
      runId: run.id,
      onPair: fixtures.trackSession,
    });
    if (!lostResponse) proxy.resume();
    restoreAndroidPort = reverseAndroidPort(proxy.port);
  }
  await owner.getByRole("button", { name: "连接手机" }).click();
  const code = owner.getByTestId("mobile-pairing-code");
  await expect(code).toHaveText(/^[A-Z0-9]{8}$/);
  const pairingCode = (await code.innerText()).trim();
  fixtures.trackPairing(pairingCode);
  const deviceEnv = { PAIR_CODE: pairingCode, RUN_ID: run.id };
  const journeyStarted = performance.now();
  await maestro(
    lostResponse ? "confirmation-interrupted" : "confirm-review",
    artifactDir,
    deviceEnv,
  );

  const original = await savedTasks(run.id);
  assert.deepEqual(
    original.map(({ title }) => title).sort(),
    [...run.titles].sort(),
  );
  const runState = await fixtures.database.query(
    "SELECT status,result FROM runs WHERE id=$1",
    [run.id],
  );
  assert.equal(runState.rows[0].status, "applied");
  assert.deepEqual(
    [...runState.rows[0].result.taskIds].sort(),
    original.map(({ id }) => id).sort(),
  );
  if (lostResponse) {
    assert.ok(
      proxy.counts().drops > 0,
      "Expected a dropped response following a real commit",
    );
    const submitted = proxy.counts().applyCalls;
    proxy.resume();
    await maestro("confirmation-recovered", artifactDir, {
      TASK_ID: original[0].id,
    });
    assert.equal(
      proxy.counts().applyCalls,
      submitted,
      "Cold launch should read the existing receipt without applying again",
    );
    assert.deepEqual(await savedTasks(run.id), original);
  }
  const journeyMs = Math.round(performance.now() - journeyStarted);
  await expect(firstTitle).toHaveCount(
    before.rows[0].count +
      run.titles.filter((title) => title === run.titles[0]).length,
  );
  await observer.screenshot({ path: resolve(artifactDir, "web-tasks.png") });

  await maestro("update-task", artifactDir, { TASK_ID: original[0].id });
  await expect
    .poll(
      async () =>
        (await savedTasks(run.id)).find(({ id }) => id === original[0].id)
          ?.status,
    )
    .toBe("doing");
  const after = await savedTasks(run.id);
  assert.deepEqual(
    after.map(({ id }) => id),
    original.map(({ id }) => id),
  );
  const updated = after.find(({ id }) => id === original[0].id);
  assert.equal(updated.status, "doing");
  assert.equal(updated.version, original[0].version + 1);
  await observer.getByRole("textbox", { name: "筛选任务" }).fill(updated.title);
  const statusCell = observer.getByRole("combobox", {
    name: `任务状态 ${updated.title}`,
    exact: true,
  });
  const existing = await fixtures.database.query(
    "SELECT count(*)::int AS count FROM tasks WHERE title=$1",
    [updated.title],
  );
  if (existing.rows[0].count === 1) {
    await expect(statusCell).toHaveValue("doing");
  }
  const report = {
    runId: run.id,
    taskIds: after.map(({ id }) => id),
    platform: android ? "android" : "ios",
    lostResponse,
    model: realModel ? "ollama" : "fixture",
    ...(realModel && { modelMs: run.modelMs }),
    maestroJourneyMs: journeyMs,
    liveWebUpdate: true,
    nativeTaskVersion: updated.version,
  };
  await writeFile(
    resolve(artifactDir, "result.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(report, artifactDir);
} finally {
  try {
    restoreAndroidPort?.();
  } finally {
    await Promise.allSettled([proxy?.close(), browser?.close()]);
    await fixtures.cleanup();
  }
}
