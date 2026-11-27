import { afterEach, expect, it, vi } from "vitest";
import {
  configuredEmail,
  deliverEmail,
  emailConfig,
} from "../../server/email-delivery";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const message = {
  id: "test-id",
  to: "member@example.org",
  subject: "登录 CoSpace",
  text: "https://pilot.example.org/#login=example",
};
function configure(endpoint: string, headers: Record<string, string> = {}) {
  vi.stubEnv("COSPACE_EMAIL_API_URL", endpoint);
  vi.stubEnv("COSPACE_EMAIL_FROM", "pilot@example.org");
  vi.stubEnv("COSPACE_EMAIL_API_KEY", "test-key");
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(null, { status: 202, headers }));
  vi.stubGlobal("fetch", send);
  return send;
}

it("sends plain authentication links with MailerSend tracking disabled", async () => {
  const send = configure("https://api.mailersend.com/v1/email", {
    "x-message-id": "queued",
  });
  await deliverEmail(emailConfig(), message);
  const options = send.mock.calls[0][1]!;
  expect(JSON.parse(String(options.body))).toEqual({
    from: { email: "pilot@example.org", name: "CoSpace" },
    to: [{ email: message.to }],
    subject: message.subject,
    text: message.text,
    settings: { track_clicks: false, track_opens: false, track_content: false },
  });
});
it.each([{}, { "x-send-paused": "true", "x-message-id": "queued" }])(
  "reports suppressed or paused MailerSend messages",
  async (headers) => {
    configure(
      "https://api.mailersend.com/v1/email",
      headers as Record<string, string>,
    );
    await expect(deliverEmail(emailConfig(), message)).rejects.toThrow();
  },
);
it("preserves Resend recipients and idempotency", async () => {
  const send = configure("https://api.resend.com/emails");
  await deliverEmail(emailConfig(), message);
  const options = send.mock.calls[0][1]!;
  expect(new Headers(options.headers).get("Idempotency-Key")).toBe(message.id);
  expect(JSON.parse(String(options.body))).toEqual({
    from: "pilot@example.org",
    to: [message.to],
    subject: message.subject,
    text: message.text,
  });
});

it("allows provisioning without mail but rejects an incomplete sender configuration", () => {
  vi.stubEnv("COSPACE_EMAIL_FROM", "");
  vi.stubEnv("COSPACE_EMAIL_API_KEY", "");
  expect(configuredEmail()).toBeNull();
  expect(() => emailConfig()).toThrow();
  vi.stubEnv("COSPACE_EMAIL_API_KEY", "test-key");
  expect(() => configuredEmail()).toThrow();
  vi.stubEnv("COSPACE_EMAIL_FROM", "pilot@example.org");
  expect(configuredEmail()).toEqual(emailConfig());
});
