import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, type ReactNode, use, useState } from "react";
import { AuthProvider } from "../auth/AuthProvider.js";
import type { CacheStorage } from "../groups/cache-persistence.js";
import { LocaleProvider } from "../i18n/LocaleProvider.js";
import type { GoogleSignIn } from "../platform/google.js";
import type { LineSignIn } from "../platform/line.js";

/** Everything the SPA reaches outside the browser; tests pass fakes. */
export interface AppDeps {
  fetch: typeof fetch;
  line: LineSignIn;
  google: GoogleSignIn;
  /** Shows the dev test sign-in form (local and browser tests only). */
  testSignIn: boolean;
  /** Injectable WebSocket constructor for live sync (decision 15). */
  webSocket?: typeof WebSocket;
  /** Injectable CacheStorage for query cache persistence (Ticket 10). */
  cacheStorage?: CacheStorage | undefined;
}

const DepsContext = createContext<AppDeps | null>(null);

export function useDeps(): AppDeps {
  const deps = use(DepsContext);
  if (deps === null) throw new Error("useDeps must be used inside AppProviders");
  return deps;
}

export function AppProviders({
  deps,
  queryClient: given,
  children,
}: {
  deps: AppDeps;
  /** Tests pass a client without retries. */
  queryClient?: QueryClient;
  children: ReactNode;
}) {
  const [queryClient] = useState(
    () =>
      given ?? new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );
  return (
    <DepsContext value={deps}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider fetch={deps.fetch} line={deps.line} storage={deps.cacheStorage}>
          <LocaleProvider>{children}</LocaleProvider>
        </AuthProvider>
      </QueryClientProvider>
    </DepsContext>
  );
}
