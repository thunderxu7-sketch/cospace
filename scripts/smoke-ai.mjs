// Live local-model check. It applies and undoes one summary, leaving the document unchanged.
import assert from "node:assert/strict";
const base = process.env.APP_ORIGIN || "http://127.0.0.1:3027";
let cookie = "";
async function call(path, body) {
  const r = await fetch(base + "/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      origin: base,
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (r.headers.has("set-cookie"))
    cookie = r.headers.get("set-cookie").split(";")[0];
  if (!r.ok) throw new Error(await r.text());
  return r;
}
await call("/login", { id: "lin", password: "cospace-demo-2026" });
const before = await (await call("/documents/launch/context")).json();
const started = Date.now();
const response = await call("/ai/generate", {
  mode: "summary",
  documentId: "launch",
  prompt: "总共不超过120字，保留消息来源编号。",
});
const reader = response.body.getReader(),
  decoder = new TextDecoder();
let buffer = "",
  id,
  proposal,
  firstToken = 0,
  count = 0,
  output = "";
function consume(line) {
  if (!line.trim()) return;
  const e = JSON.parse(line);
  if (e.type === "start") id = e.id;
  if (e.type === "delta") {
    if (!firstToken) firstToken = Date.now() - started;
    count++;
    output += e.text;
  }
  if (e.type === "proposal") proposal = e.proposal;
  if (e.type === "error") throw new Error(e.message);
}
while (true) {
  const r = await reader.read();
  buffer += r.done
    ? decoder.decode()
    : decoder.decode(r.value, { stream: true });
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    consume(buffer.slice(0, index));
    buffer = buffer.slice(index + 1);
  }
  if (r.done) {
    consume(buffer);
    break;
  }
}
assert.ok(id && proposal);
assert.ok(count > 1);
assert.equal(proposal.type, "append_document");
const readyTime = Date.now() - started;
const unchanged = await (await call("/documents/launch/context")).json();
assert.deepEqual(unchanged, before);
try {
  await call("/runs/" + id + "/apply", {});
  await call("/runs/" + id + "/apply", {});
  const after = await (await call("/documents/launch/context")).json();
  assert.notEqual(after.hash, before.hash);
} finally {
  await call("/runs/" + id + "/undo", {});
}
assert.deepEqual(
  await (await call("/documents/launch/context")).json(),
  before,
);
console.log(
  JSON.stringify(
    {
      model: process.env.OLLAMA_MODEL || "qwen3:14b",
      firstTokenMs: firstToken,
      readyMs: readyTime,
      streamEvents: count,
      characters: output.length,
      previewOnlyBeforeConfirmation: true,
      idempotentApply: true,
      undoRestoredDocument: true,
      runId: id,
    },
    null,
    2,
  ),
);
