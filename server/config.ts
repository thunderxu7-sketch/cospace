export const pilot = process.env.COSPACE_MODE === "pilot";
export const appOrigin = process.env.APP_ORIGIN || "http://127.0.0.1:3027";
export const apiPort = Number(process.env.COSPACE_API_PORT || 4027);
export const collabPort = Number(process.env.COSPACE_COLLAB_PORT || 4028);
export const demoWorkspace = "demo";

export function validateRuntime() {
  const origin = new URL(appOrigin);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    origin.hostname,
  );
  if (
    origin.origin !== appOrigin ||
    !["https:", "http:"].includes(origin.protocol)
  )
    throw new Error("APP_ORIGIN must be an HTTP(S) origin without a path.");
  if (!loopback && (!pilot || origin.protocol !== "https:"))
    throw new Error(
      "A public APP_ORIGIN requires COSPACE_MODE=pilot and HTTPS.",
    );
  if (pilot && !process.env.DATABASE_URL)
    throw new Error("Pilot mode requires an explicit DATABASE_URL.");
}
