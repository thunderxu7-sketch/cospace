import { spawn, spawnSync } from "node:child_process";
const render = process.argv.includes("--render");
const production = render || process.argv.includes("--production");
if (render) {
  process.env.APP_ORIGIN ||= process.env.RENDER_EXTERNAL_URL || "";
  if (!process.env.APP_ORIGIN || !process.env.DATABASE_URL)
    throw new Error(
      "The hosted pilot requires an HTTPS origin and DATABASE_URL.",
    );
  process.env.COSPACE_PUBLIC_HOST = `http://:${process.env.PORT || 10000}`;
  const migration = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/migrate.ts"],
    { stdio: "inherit" },
  );
  if (migration.status !== 0) process.exit(migration.status || 1);
}
const children = [
  spawn(
    "node",
    ["--env-file-if-exists=.env.local", "--import", "tsx", "server/index.ts"],
    { stdio: "inherit" },
  ),
  spawn(
    "node",
    [
      "node_modules/next/dist/bin/next",
      production ? "start" : "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      process.env.COSPACE_WEB_PORT || "3027",
    ],
    { stdio: "inherit" },
  ),
];
if (render) {
  children.push(
    spawn(
      "caddy",
      ["run", "--config", "deploy/Caddyfile", "--adapter", "caddyfile"],
      {
        stdio: "inherit",
      },
    ),
  );
}
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  const deadline = setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
  }, 10_000);
  deadline.unref();
  process.exitCode = code;
}
for (const child of children) {
  child.on("exit", (code) => stop(code || 0));
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
