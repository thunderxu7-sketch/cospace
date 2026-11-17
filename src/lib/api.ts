export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public current?: unknown,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch("/api" + path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
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
