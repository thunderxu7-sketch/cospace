"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import WorkspaceApp from "@/components/workspace";
export default function Page() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            refetchOnWindowFocus: true,
            staleTime: 10000,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <WorkspaceApp />
    </QueryClientProvider>
  );
}
