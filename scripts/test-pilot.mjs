import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import pg from "pg";

const databaseUrl = process.env.COSPACE_PILOT_TEST_DATABASE_URL;
const caddy = process.env.COSPACE_PILOT_TEST_CADDY;
if (!databaseUrl)
  throw new Error(
    "Set COSPACE_PILOT_TEST_DATABASE_URL to an empty disposable PostgreSQL database.",
  );
const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  const {
    rows: [{ empty }],
  } = await pool.query(
    "SELECT NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public') AS empty",
  );
  if (!empty)
    throw new Error("Pilot acceptance tests require an empty database.");
} finally {
  await pool.end();
}

const mailbox = new Map();
const literalEvidence = "更新上线方案";
const provider = createServer(async (req, res) => {
  if (req.method === "GET" && req.url.startsWith("/test/mail/")) {
    const text = mailbox.get(
      decodeURIComponent(req.url.slice("/test/mail/".length)),
    );
    res.writeHead(text ? 200 : 404, { "Content-Type": "text/plain" });
    return res.end(text);
  }
  if (req.method !== "POST") {
    res.writeHead(405);
    return res.end();
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (req.url === "/emails") {
    mailbox.set(body.to[0], body.text);
    res.writeHead(201, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ id: "test-email" }));
  }
  if (req.url !== "/api/chat") {
    res.writeHead(404);
    return res.end();
  }
  const { document } = JSON.parse(body.messages[1].content);
  if (!document.includes(literalEvidence)) {
    res.writeHead(422);
    return res.end();
  }
  res.writeHead(200, { "Content-Type": "application/x-ndjson" });
  res.end(
    JSON.stringify({
      message: {
        content: JSON.stringify({
          tasks: [
            {
              title: literalEvidence,
              evidence: literalEvidence,
              assignee: null,
              due_at: null,
            },
            {
              title: "记录验收结果",
              evidence: "记录验收结果",
              assignee: null,
              due_at: null,
            },
          ],
        }),
      },
      done: true,
    }) + "\n",
  );
});

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

const ports = [createServer(), createServer(), createServer()];
if (caddy) ports.push(createServer());
const [web, api, collab, https] = await Promise.all(ports.map(listen));
await Promise.all(
  ports.map((server) => new Promise((resolve) => server.close(resolve))),
);
const providerOrigin = `http://127.0.0.1:${await listen(provider)}`;
const webOrigin = `http://127.0.0.1:${web}`;
const origin = caddy ? `https://127.0.0.1:${https}` : webOrigin;
const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  APP_ORIGIN: origin,
  COSPACE_MODE: "pilot",
  COSPACE_WEB_PORT: String(web),
  COSPACE_API_PORT: String(api),
  COSPACE_COLLAB_PORT: String(collab),
  COSPACE_EMAIL_API_URL: providerOrigin + "/emails",
  COSPACE_EMAIL_API_KEY: "local-test-mail",
  COSPACE_EMAIL_FROM: "CoSpace <noreply@example.test>",
  OLLAMA_URL: process.env.COSPACE_PILOT_TEST_OLLAMA_URL || providerOrigin,
  OLLAMA_MODEL: process.env.COSPACE_PILOT_TEST_OLLAMA_MODEL || "qwen3:14b",
  COSPACE_PILOT_TEST_ORIGIN: origin,
  COSPACE_PILOT_TEST_MAIL_ORIGIN: providerOrigin,
  NEXT_TELEMETRY_DISABLED: "1",
};

function node(args) {
  return spawn(process.execPath, args, { env, stdio: "inherit" });
}
async function run(args) {
  const [code] = await once(node(args), "exit");
  if (code !== 0) throw new Error(`Failed: node ${args[0]}`);
}
async function stop(child) {
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
}
async function ready(url) {
  return fetch(url, { method: "HEAD", signal: AbortSignal.timeout(1500) })
    .then((response) => response.ok)
    .catch(() => false);
}

let application;
let proxy;
let proxyDirectory;
try {
  if (caddy) {
    proxyDirectory = await mkdtemp(join(tmpdir(), "cospace-pilot-caddy-"));
    const template = await readFile("deploy/Caddyfile.example", "utf8");
    const config = join(proxyDirectory, "Caddyfile");
    await writeFile(
      config,
      "{\n\tadmin off\n\tauto_https disable_redirects\n\tdefault_bind 127.0.0.1\n\tlocal_certs\n\tskip_install_trust\n}\n\n" +
        template,
    );
    proxy = spawn(caddy, ["run", "--config", config], {
      env: {
        ...env,
        COSPACE_PUBLIC_HOST: new URL(origin).host,
        XDG_CONFIG_HOME: proxyDirectory,
        XDG_DATA_HOME: proxyDirectory,
      },
      stdio: "inherit",
    });
    await once(proxy, "spawn");
  }
  await run(["--import", "tsx", "scripts/migrate.ts"]);
  for (const name of ["Alpha", "Beta"]) {
    await run([
      "--import",
      "tsx",
      "scripts/bootstrap-workspace.ts",
      name,
      "owner@example.test",
    ]);
    if (name === "Alpha") {
      // Keep the first link at a distinct test inbox address.
      mailbox.set("alpha-owner", mailbox.get("owner@example.test"));
    }
  }
  await run(["node_modules/next/dist/bin/next", "build"]);
  application = node(["scripts/dev.mjs", "--production"]);
  const deadline = Date.now() + 30_000;
  while (true) {
    if (
      application.exitCode !== null ||
      (proxy && proxy.exitCode !== null) ||
      Date.now() > deadline
    )
      throw new Error("Pilot server did not become ready.");
    const [webReady, apiReady] = await Promise.all([
      ready(webOrigin),
      ready(`http://127.0.0.1:${api}/api/ready`),
    ]);
    if (webReady && apiReady) break;
    await setTimeout(250);
  }
  await run([
    "node_modules/@playwright/test/cli.js",
    "test",
    "--config",
    "playwright.pilot.config.ts",
  ]);
} finally {
  await stop(proxy);
  await stop(application);
  provider.close();
  if (proxyDirectory)
    await rm(proxyDirectory, { recursive: true, force: true });
}
