import type { MobileSession } from "@contracts";
import * as SecureStore from "expo-secure-store";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { ApiError, request, type RequestOptions } from "./transport";

const storageKey = "cospace.account.v1";
const storageOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const expiredMessage = "连接已失效，请用网页上生成的新配对码重新连接。";

type PendingReview = { id: string };
type Account = { session: MobileSession; pendingReview: PendingReview | null };

type SessionContextValue = {
  account: Account | null;
  restoring: boolean;
  notice: string;
  connect: (code: string) => Promise<void>;
  disconnect: () => Promise<void>;
  call: <T>(route: string, options?: RequestOptions) => Promise<T>;
  rememberReview: (id: string) => Promise<void>;
  clearReview: (id: string) => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

async function writeAccount(account: Account | null) {
  if (account) {
    await SecureStore.setItemAsync(
      storageKey,
      JSON.stringify(account),
      storageOptions,
    );
    return;
  }
  try {
    await SecureStore.deleteItemAsync(storageKey, storageOptions);
  } catch {
    await SecureStore.setItemAsync(storageKey, "null", storageOptions);
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [notice, setNotice] = useState("");
  const current = useRef<Account | null>(null);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const session = account?.session;

  const update = useCallback(
    (getNext: (before: Account | null) => Account | null) => {
      const write = writes.current.then(async () => {
        const next = getNext(current.current);
        if (next === current.current) return false;
        try {
          await writeAccount(next);
        } catch {
          if (next) throw new Error("手机安全存储不可用，请解锁手机后重试。");
        }
        current.current = next;
        setAccount(next);
        return true;
      });
      writes.current = write.then(
        () => undefined,
        () => undefined,
      );
      return write;
    },
    [],
  );

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const raw = await SecureStore.getItemAsync(storageKey, storageOptions);
        if (!mounted || !raw) return;
        const saved: Account | null = JSON.parse(raw);
        if (!saved) return;
        if (
          !saved.session?.token ||
          !(Date.parse(saved.session.expiresAt) > Date.now())
        ) {
          await writeAccount(null);
          if (mounted) setNotice(expiredMessage);
          return;
        }
        current.current = saved;
        setAccount(saved);
      } catch {
        if (mounted) setNotice("未能恢复手机上的连接，请重新配对。");
      } finally {
        if (mounted) setRestoring(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const forget = useCallback(
    async (token: string, message: string) => {
      const changed = await update((before) =>
        before?.session.token === token ? null : before,
      );
      if (changed) setNotice(message);
    },
    [update],
  );

  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(
      () => void forget(session.token, expiredMessage),
      Math.max(0, Date.parse(session.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [forget, session]);

  const connect = useCallback(
    async (code: string) => {
      const next = await request<MobileSession>("/mobile/session", {
        method: "POST",
        body: { code },
      });
      try {
        await update(() => ({ session: next, pendingReview: null }));
        setNotice("");
      } catch (error) {
        void request("/mobile/session", { method: "DELETE" }, next.token).catch(
          () => undefined,
        );
        throw error;
      }
    },
    [update],
  );

  const disconnect = useCallback(async () => {
    if (!session) return;
    await forget(session.token, "");
    // Clear the phone session even when the server is out of reach.
    void request("/mobile/session", { method: "DELETE" }, session.token).catch(
      () => undefined,
    );
  }, [forget, session]);

  const call = useCallback(
    async <T,>(route: string, options?: RequestOptions) => {
      if (!session || current.current?.session.token !== session.token) {
        throw new ApiError(expiredMessage, 401);
      }
      try {
        return await request<T>(route, options, session.token);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await forget(session.token, expiredMessage);
        }
        throw error;
      }
    },
    [forget, session],
  );

  const rememberReview = useCallback(
    async (id: string) => {
      await update((before) => {
        if (!before || before.session.token !== session?.token) {
          throw new ApiError(expiredMessage, 401);
        }
        if (before.pendingReview && before.pendingReview.id !== id) {
          throw new Error("还有一条操作待核对，请先查看它的结果。");
        }
        return { ...before, pendingReview: { id } };
      });
    },
    [session, update],
  );

  const clearReview = useCallback(
    async (id: string) => {
      await update((before) =>
        before &&
        before.session.token === session?.token &&
        before.pendingReview?.id === id
          ? { ...before, pendingReview: null }
          : before,
      );
    },
    [session, update],
  );

  return (
    <SessionContext.Provider
      value={{
        account,
        restoring,
        notice,
        connect,
        disconnect,
        call,
        rememberReview,
        clearReview,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("Missing SessionProvider.");
  return context;
}
