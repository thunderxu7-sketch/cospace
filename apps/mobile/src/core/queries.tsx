import type { MobileIdentity, Page } from "@contracts";
import NetInfo from "@react-native-community/netinfo";
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { useIsFocused } from "@react-navigation/native";
import { useFocusEffect } from "expo-router";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { AppState } from "react-native";
import { useSession } from "./session";
import { ApiError, ConnectionError } from "./transport";

const subscribeOnline = (notify: () => void) => onlineManager.subscribe(notify);
const isOnline = () => onlineManager.isOnline();
const subscribeForeground = (notify: () => void) =>
  focusManager.subscribe(notify);
const isForeground = () => focusManager.isFocused();

export function useConnected() {
  return useSyncExternalStore(subscribeOnline, isOnline);
}

export function useForeground() {
  return useSyncExternalStore(subscribeForeground, isForeground);
}

export function WorkspaceQueries({ children }: { children: ReactNode }) {
  const { account } = useSession();
  const token = account?.session.token;
  const client = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 0,
            retry: false,
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
          },
        },
      }),
    // Use a separate cache for each session, including after same-account re-pairing.
    [token],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      focusManager.setFocused(state === "active");
      if (state === "active") {
        void NetInfo.refresh().catch(() => undefined);
      }
    });
    focusManager.setFocused(AppState.currentState !== "background");
    const unsubscribe = NetInfo.addEventListener(({ isConnected }) => {
      onlineManager.setOnline(isConnected !== false);
    });
    return () => {
      subscription.remove();
      unsubscribe();
    };
  }, []);

  useEffect(
    () => () => {
      void client.cancelQueries();
      client.clear();
    },
    [client],
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function useIdentity() {
  const { account, call } = useSession();
  const query = useQuery({
    queryKey: ["identity"],
    queryFn: ({ signal }) => call<MobileIdentity>("/mobile/me", { signal }),
    enabled: !!account,
    staleTime: 60_000,
  });
  const user = query.data?.user ?? account?.session.user ?? null;
  return {
    user,
    members: query.data?.members ?? (user ? [user] : []),
  };
}

export const reviewKeys = {
  list: ["reviews"] as const,
  detail: (id: string) => ["review", id] as const,
};

export const taskKeys = {
  list: ["tasks"] as const,
  detail: (id: string) => ["task", id] as const,
};

export function useRefreshOnFocus(
  refetch: (options?: { cancelRefetch?: boolean }) => Promise<unknown>,
  enabled = true,
) {
  useFocusEffect(
    useCallback(() => {
      if (enabled && onlineManager.isOnline())
        void refetch({ cancelRefetch: false });
    }, [enabled, refetch]),
  );
}

export function useFeed<Item extends { id: string }>(options: {
  route: string;
  queryKey: readonly string[];
  pollInterval?: number;
}) {
  const { call } = useSession();
  const visible = useIsFocused();
  const foreground = useForeground();
  const query = useInfiniteQuery({
    queryKey: options.queryKey,
    queryFn: ({ pageParam, signal }) => {
      const separator = options.route.includes("?") ? "&" : "?";
      const cursor = pageParam
        ? `&cursor=${encodeURIComponent(pageParam)}`
        : "";
      return call<Page<Item>>(`${options.route}${separator}limit=30${cursor}`, {
        signal,
      });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchInterval:
      visible && foreground ? (options.pollInterval ?? false) : false,
  });
  useRefreshOnFocus(query.refetch);

  const items = useMemo(() => {
    const byId = new Map<string, Item>();
    for (const page of query.data?.pages ?? []) {
      for (const item of page.items) {
        if (!byId.has(item.id)) byId.set(item.id, item);
      }
    }
    return [...byId.values()];
  }, [query.data]);
  return { ...query, items };
}

export function isUncertain(error: unknown) {
  return (
    error instanceof ConnectionError ||
    (error instanceof ApiError && error.status >= 500)
  );
}
