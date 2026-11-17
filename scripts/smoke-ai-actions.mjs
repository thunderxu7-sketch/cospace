import assert from "node:assert/strict";
const base = process.env.APP_ORIGIN || "http://127.0.0.1:3027";
let cookie = "";
async function call(path, body, signal) {
  const r = await fetch(base + "/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      origin: base,
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  });
  if (r.headers.has("set-cookie"))
    cookie = r.headers.get("set-cookie").split(";")[0];
  if (!r.ok) throw new Error(await r.text());
  return r;
}
await call("/login", { id: "lin", password: "cospace-demo-2026" });
const results = [];
for (const mode of ["tasks", "rewrite", "schedule"]) {
  const before = await (await call("/documents/launch/context")).json();
  const workspace = await (await call("/workspace")).json();
  const started = Date.now();
  const params = {
    mode,
    documentId: "launch",
    prompt:
      mode === "tasks"
        ? "只提取2个最重要任务。"
        : mode === "schedule"
          ? "只安排其中2个任务。"
          : "用一句简洁的话改写，保留产品名称。",
    ...(mode === "rewrite"
      ? {
          selectedText: before.text.split("\n")[0],
          blockIndex: 0,
          baseHash: before.hash,
        }
      : {}),
  };
  const response = await call("/ai/generate", params);
  const text = await response.text();
  const events = text.trim().split("\n").map(JSON.parse);
  const error = events.find((e) => e.type === "error");
  if (error) throw new Error(mode + ":" + error.message);
  const proposal = events.find((e) => e.type === "proposal");
  assert.ok(proposal);
  const id = proposal.id;
  let applied = false;
  try {
    await call("/runs/" + id + "/apply", {});
    applied = true;
    await call("/runs/" + id + "/apply", {});
  } finally {
    if (applied) await call("/runs/" + id + "/undo", {});
  }
  const after = await (await call("/workspace")).json();
  assert.deepEqual(
    await (await call("/documents/launch/context")).json(),
    before,
  );
  assert.deepEqual(
    after.tasks.map(({ version, ...t }) => t),
    workspace.tasks.map(({ version, ...t }) => t),
  );
  results.push({
    mode,
    elapsedMs: Date.now() - started,
    streamEvents: events.filter((e) => e.type === "delta").length,
    appliedAndUndone: true,
  });
  console.log(JSON.stringify(results.at(-1)));
}
const controller = new AbortController();
const response = await call(
  "/ai/generate",
  { mode: "summary", prompt: "详细整理讨论", documentId: "launch" },
  controller.signal,
);
const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "",
  runId;
while (!runId) {
  const r = await reader.read();
  buffer += decoder.decode(r.value, { stream: true });
  for (const line of buffer.split("\n").slice(0, -1)) {
    const e = JSON.parse(line);
    if (e.type === "start") runId = e.id;
  }
}
controller.abort();
await reader.cancel().catch(() => {});
for (let n = 0; n < 30; n++) {
  const runs = await (await call("/runs")).json();
  const status = runs.find((r) => r.id === runId)?.status;
  if (status === "cancelled") {
    console.log(
      JSON.stringify({
        mode: "cancel",
        persistedStatus: status,
        noApply: true,
      }),
    );
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 100));
}
throw new Error("Cancellation was not persisted");
