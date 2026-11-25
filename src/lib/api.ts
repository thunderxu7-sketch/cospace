export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public current?: unknown,
  ) {
    super(message);
  }
}
export function websocketUrl(path: string) {
  const url = new URL(path, window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}
export async function api<T = any>(
  path: string,
  {
    workspaceId,
    headers,
    ...options
  }: RequestInit & {
    workspaceId?: string;
  } = {},
): Promise<T> {
  const requestHeaders = new Headers(headers);
  if (options.body && !requestHeaders.has("Content-Type"))
    requestHeaders.set("Content-Type", "application/json");
  if (workspaceId) requestHeaders.set("X-CoSpace-Workspace", workspaceId);
  const response = await fetch("/api" + path, {
    ...options,
    headers: requestHeaders,
  });
  const result = await response.json();
  if (!response.ok)
    throw new ApiError(
      result.error || "请求失败",
      response.status,
      result.current,
    );
  return result;
}
export async function* readStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const r = await reader.read();
      buffer += r.done
        ? decoder.decode()
        : decoder.decode(r.value, { stream: true });
      let i;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (line) yield JSON.parse(line);
      }
      if (r.done) {
        if (buffer.trim()) yield JSON.parse(buffer);
        break;
      }
      if (buffer.length > 1000000) throw new Error("响应格式异常");
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
