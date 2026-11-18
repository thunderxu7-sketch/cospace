import { execFileSync, spawn } from "node:child_process";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const androidSerial = process.env.COSPACE_ANDROID_SERIAL;
const maestroDevice = process.env.COSPACE_MAESTRO_DEVICE || androidSerial;
const maestroBin = process.env.COSPACE_MAESTRO || "maestro";
const adbBin = process.env.COSPACE_ADB || "adb";
const adbTarget = androidSerial ? ["-s", androidSerial] : [];

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const artifactRoot =
  process.env.COSPACE_MOBILE_ARTIFACTS || resolve(root, ".local/mobile-e2e");

export function adb(...args) {
  return execFileSync(adbBin, [...adbTarget, ...args], { encoding: "utf8" });
}

export function startAdb(...args) {
  return spawn(adbBin, [...adbTarget, ...args], {
    stdio: ["ignore", "pipe", "inherit"],
  });
}

/** @param {number} upstreamPort */
export function reverseAndroidPort(upstreamPort) {
  const previous = adb("reverse", "--list")
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).slice(-2))
    .find(([remote]) => remote === "tcp:4027")?.[1];
  adb("reverse", "tcp:4027", `tcp:${upstreamPort}`);
  return () =>
    previous
      ? adb("reverse", "tcp:4027", previous)
      : adb("reverse", "--remove", "tcp:4027");
}

/** @param {string} flow @param {string} artifactDir @param {Record<string, string>} env */
export async function maestro(flow, artifactDir, env) {
  const args = [
    ...(maestroDevice ? ["--device", maestroDevice] : []),
    "test",
    "--test-output-dir",
    artifactDir,
    ...Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
    resolve(root, "tests/mobile", `${flow}.yaml`),
  ];
  await new Promise((resolveRun, reject) => {
    const child = spawn(maestroBin, args, {
      env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const [source, destination] of [
      [child.stdout, process.stdout],
      [child.stderr, process.stderr],
    ]) {
      const lines = createInterface({ input: source });
      lines.on("line", (input) => {
        const line = env.PAIR_CODE
          ? input.replaceAll(env.PAIR_CODE, "[pairing code]")
          : input;
        destination.write(line + "\n");
      });
    }
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolveRun()
        : reject(new Error(`Maestro ${flow} exited with ${code}`)),
    );
  });
}
