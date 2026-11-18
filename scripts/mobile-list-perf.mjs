import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import {
  adb,
  artifactRoot,
  maestro,
  reverseAndroidPort,
  startAdb,
} from "../tests/mobile/device-driver.mjs";
import {
  apiOrigin,
  demoPassword,
  mobileFixtures,
  webOrigin,
} from "../tests/mobile/fixtures.mjs";
import { startResponseDropProxy } from "../tests/mobile/response-drop.mjs";

const fixtures = mobileFixtures();
const artifactDir = resolve(artifactRoot, `task-list-${fixtures.namespace}`);

async function webPost(path, payload, cookie) {
  const response = await fetch(new URL(path, webOrigin), {
    method: "POST",
    headers: {
      origin: webOrigin,
      ...(cookie && { cookie }),
      ...(payload && { "content-type": "application/json" }),
    },
    body: payload && JSON.stringify(payload),
  });
  assert.ok(response.ok, `${path} returned ${response.status}`);
  return response;
}

function deviceProperty(name) {
  return adb("shell", "getprop", name).trim();
}

let proxy, restoreAndroidPort, logcat, logcatExit;
try {
  await mkdir(artifactDir, { recursive: true });
  const login = await webPost("/api/login", {
    id: "lin",
    password: demoPassword,
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.match(cookie, /^cs_session=.+$/);
  fixtures.trackWebSession(cookie.slice("cs_session=".length));
  const data = await fixtures.seedTasks({
    count: 10_000,
    createdAt: new Date(Date.now() + 600_000).toISOString(),
  });
  assert.equal(data.length, 10_000);
  const firstTaskId = data.sort().at(-1);

  proxy = await startResponseDropProxy({
    upstream: apiOrigin,
    runId: fixtures.namespace,
    onPair: fixtures.trackSession,
  });
  proxy.resume();
  restoreAndroidPort = reverseAndroidPort(proxy.port);
  const { code } = await (
    await webPost("/api/mobile/pairings", undefined, cookie)
  ).json();
  fixtures.trackPairing(code);

  const samplesMs = [];
  const captureAfter = Number(adb("shell", "date", "+%s").trim()) + 1;
  logcat = startAdb(
    "logcat",
    "-v",
    "epoch",
    "-T",
    "1",
    "ReactNativeJS:I",
    "*:S",
  );
  logcatExit = once(logcat, "close");
  logcatExit.catch(() => {});
  const output = createInterface({ input: logcat.stdout });
  output.on("line", (line) => {
    const match = line.match(
      /^\s*(\d+\.\d+).*\bCOSPACE_TASK_LIST_READY[ =]+(\d+(?:\.\d+)?)/,
    );
    if (match && Number(match[1]) >= captureAfter)
      samplesMs.push(Number(match[2]));
  });
  await once(logcat, "spawn");
  await maestro("measure-task-list", artifactDir, {
    PAIR_CODE: code,
    FIRST_TASK_ID: firstTaskId,
  });
  await writeFile(
    resolve(artifactDir, "samples.json"),
    JSON.stringify(samplesMs, null, 2) + "\n",
  );
  assert.equal(
    samplesMs.length,
    30,
    "Expected exactly 30 on-device row-layout markers from an instrumented build",
  );
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const report = {
    taskFixtures: data.length,
    device: deviceProperty("ro.product.model"),
    androidVersion: deviceProperty("ro.build.version.release"),
    apiLevel: deviceProperty("ro.build.version.sdk"),
    emulator: deviceProperty("ro.kernel.qemu") === "1",
    build:
      process.env.COSPACE_MOBILE_BUILD ||
      "operator-provided instrumented build",
    metric:
      "tasks tab press to first row layout, cold JS cache and warm local API",
    sampleCount: samplesMs.length,
    p50Ms: sorted[Math.ceil(0.5 * sorted.length) - 1],
    p95Ms: sorted[Math.ceil(0.95 * sorted.length) - 1],
  };
  await writeFile(
    resolve(artifactDir, "result.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(report, artifactDir);
} finally {
  if (logcat) {
    logcat.kill();
    await logcatExit.catch(() => {});
  }
  try {
    restoreAndroidPort?.();
  } finally {
    await Promise.allSettled([proxy?.close()]);
    await fixtures.cleanup();
  }
}
