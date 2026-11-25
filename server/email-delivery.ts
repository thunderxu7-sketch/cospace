import { z } from "zod";

export function emailConfig() {
  const apiKey = process.env.COSPACE_EMAIL_API_KEY;
  const from = process.env.COSPACE_EMAIL_FROM;
  const endpoint = new URL(
    process.env.COSPACE_EMAIL_API_URL || "https://api.resend.com/emails",
  );
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname);
  if (
    !apiKey ||
    !from ||
    (endpoint.protocol !== "https:" &&
      !(local && endpoint.protocol === "http:"))
  )
    throw new Error(
      "Pilot mode requires COSPACE_EMAIL_API_KEY, COSPACE_EMAIL_FROM and an HTTPS email endpoint.",
    );
  const sender =
    endpoint.origin === "https://api.mailersend.com"
      ? { email: z.email().parse(from.trim()), name: "CoSpace" }
      : from;
  return { apiKey, sender, endpoint };
}

type Message = { id: string; to: string; subject: string; text: string };

export async function deliverEmail(
  { apiKey, sender, endpoint }: ReturnType<typeof emailConfig>,
  { id, to, subject, text }: Message,
) {
  const mailerSend = typeof sender !== "string";
  const headers = new Headers({
    Authorization: "Bearer " + apiKey,
    "Content-Type": "application/json",
  });
  if (!mailerSend) headers.set("Idempotency-Key", id);
  const body = mailerSend
    ? {
        from: sender,
        to: [{ email: to }],
        settings: {
          track_clicks: false,
          track_opens: false,
          track_content: false,
        },
      }
    : { from: sender, to: [to] };
  const response = await fetch(endpoint, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers,
    body: JSON.stringify({ ...body, subject, text }),
  });
  if (
    !response.ok ||
    (mailerSend &&
      (!response.headers.get("x-message-id") ||
        response.headers.get("x-send-paused") === "true"))
  )
    throw new Error("Email provider did not accept the message for sending");
}
