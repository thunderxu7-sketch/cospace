const defaultOrigin = "http://127.0.0.1:4027";

function apiOrigin() {
  const value = (process.env.EXPO_PUBLIC_API_URL || defaultOrigin).trim();
  const url = new URL(value);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("请将 API 地址设为 HTTPS 或本机回环地址。");
  }
  return url.origin;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly current?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class ConnectionError extends Error {
  constructor() {
    super("暂时无法连接工作区，请检查网络后重试。");
    this.name = "ConnectionError";
  }
}

export function friendlyError(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请重试。";
}

export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
};

export async function request<T>(
  route: string,
  options: RequestOptions = {},
  token?: string,
): Promise<T> {
  const origin = apiOrigin();
  const abort = new AbortController();
  const cancel = () => abort.abort();
  if (options.signal?.aborted) cancel();
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, 8000);

  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body !== undefined)
      headers["Content-Type"] = "application/json";
    const response = await fetch(`${origin}/api${route}`, {
      method: options.method ?? "GET",
      credentials: "omit",
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: abort.signal,
    });
    const raw = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new ApiError(
        "工作区返回了无法读取的数据。",
        response.ok ? 502 : response.status,
      );
    }
    if (!response.ok) {
      const problem = payload as { error?: unknown; current?: unknown } | null;
      throw new ApiError(
        typeof problem?.error === "string"
          ? problem.error
          : "工作区暂时无法完成请求。",
        response.status,
        problem?.current,
      );
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError || options.signal?.aborted) throw error;
    throw new ConnectionError();
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}
