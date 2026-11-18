import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(
  new URL("../node_modules/expo/bin/cli", import.meta.url),
);
const result = spawnSync(
  process.execPath,
  ["--dns-result-order=ipv4first", cli, ...process.argv.slice(2)],
  {
    // The development build also reaches Metro through the simulator or USB loopback.
    env: { ...process.env, REACT_NATIVE_PACKAGER_HOSTNAME: "127.0.0.1" },
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
