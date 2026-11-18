import { once } from "node:events";
import { createServer, request } from "node:http";

/**
 * Forward to the real local server. On success from this run's apply route,
 * consume the response upstream and disconnect the caller before sending a byte.
 * During the uncertainty window the caller cannot reconcile that run's detail.
 * @param {{upstream: string, runId: string, port?: number, onPair?: (token: string) => void}} config
 */
export async function startResponseDropProxy({
  upstream,
  runId,
  port = 0,
  onPair,
}) {
  const target = new URL(upstream);
  if (target.protocol !== "http:")
    throw new Error("The response-drop fixture needs a local HTTP upstream");

  const detailPath = `/api/runs/${runId}`;
  let dropApplyResponses = true;
  let holdReads = false;
  let drops = 0;
  let applyCalls = 0;
  const server = createServer((incoming, outgoing) => {
    const path = (incoming.url || "/").split("?")[0];
    const isApply =
      incoming.method === "POST" && path === `${detailPath}/apply`;
    if (isApply) applyCalls++;
    if (holdReads && incoming.method === "GET" && path === detailPath) {
      outgoing.destroy();
      return;
    }

    const proxied = request(
      {
        hostname: target.hostname,
        port: target.port || 80,
        path: incoming.url,
        method: incoming.method,
        headers: { ...incoming.headers, host: target.host },
      },
      (response) => {
        const successful =
          response.statusCode >= 200 && response.statusCode < 300;
        response.on("error", (error) => outgoing.destroy(error));
        if (isApply && dropApplyResponses && successful) {
          response.resume();
          response.once("end", () => {
            drops++;
            holdReads = true;
            outgoing.destroy();
          });
          return;
        }
        if (
          onPair &&
          incoming.method === "POST" &&
          path === "/api/mobile/session" &&
          successful
        ) {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => {
            const { token } = JSON.parse(Buffer.concat(chunks).toString());
            if (typeof token === "string") onPair(token);
          });
        }
        outgoing.writeHead(response.statusCode || 502, response.headers);
        response.pipe(outgoing);
      },
    );
    proxied.on("error", (error) => outgoing.destroy(error));
    incoming.on("error", (error) => proxied.destroy(error));
    incoming.pipe(proxied);
  });
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Proxy has no TCP port");
  return {
    port: address.port,
    origin: `http://127.0.0.1:${address.port}`,
    counts: () => ({ drops, applyCalls }),
    resume() {
      dropApplyResponses = false;
      holdReads = false;
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
