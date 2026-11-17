import { spawn } from "node:child_process";
const production = process.argv.includes("--production");
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
      "3027",
    ],
    { stdio: "inherit" },
  ),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 1500).unref();
}
for (const child of children) child.on("exit", (code) => stop(code || 0));
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
