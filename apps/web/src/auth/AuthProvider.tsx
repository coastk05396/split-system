import type { Me, Provider, TestSignInRequest } from "@split/shared";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ApiFailure, type ErrorCode } from "../api/errors.js";
import {
  type CacheStorage,
  clearCache,
  clearAllCaches,
  restoreCache,
  startCachePersistence,
} from "../groups/cache-persistence.js";
import { voidMutationsInFlight } from "./void-mutations.js";
import { clearExpenseWrites } from "../expenses/writes.js";
import { cancelStatsInvalidation } from "../groups/data.js";
import type { LineSignIn } from "../platform/line.js";
import { createSession, type Session } from "./session.js";

export type AuthState =
  | { status: "loading" }
  /** `byChoice`: the person signed out (or deleted the account) here, so the app returns to `/`. */
  | { status: "signedOut"; error: ErrorCode | null; byChoice?: true }
  | { status: "signedIn"; user: Me };

export interface Auth {
  state: AuthState;
  session: Session;
  signIn: (provider: Provider, idToken: string) => Promise<boolean>;
  redeemLinkCode: (code: string, idToken: string) => Promise<boolean>;
  link: (provider: Provider, idToken: string) => Promise<void>;
  unlink: (provider: Provider) => Promise<void>;
  createLinkCode: () => Promise<string>;
  refreshIdentities: (signal: AbortSignal) => Promise<void>;
  testSignIn: (request: TestSignInRequest) => Promise<void>;
  signOut: () => Promise<void>;
  /** Replaces the signed-in User after the server changed them (Identity link or unlink). */
  updateUser: (user: Me) => void;
}

const AuthContext = createContext<Auth | null>(null);

function failureCode(error: unknown): ErrorCode {
  return error instanceof ApiFailure ? error.code : "INTERNAL";
}

/**
 * Owns the session. On start it tries the refresh cookie, then LIFF's ID token when
 * the app is inside LINE, before settling on signed in or signed out.
 */
export function AuthProvider({
  fetch,
  line,
  storage,
  children,
}: {
  fetch: typeof globalThis.fetch;
  line: LineSignIn;
  storage?: CacheStorage | undefined;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const stopPersistence = useRef<(() => void) | null>(null);
  const forgetUser = useCallback(
    (userId: string | null) => {
      clearExpenseWrites();
      cancelStatsInvalidation(queryClient);
      stopPersistence.current?.();
      // Before clear(), which forgets the writes it should void.
      voidMutationsInFlight(queryClient);
      queryClient.clear();
      if (userId === null) clearAllCaches(storage);
      else clearCache(userId, storage);
    },
    [queryClient, storage],
  );
  const session = useMemo(
    () =>
      createSession({
        fetch,
        onSignedOut: () => {
          forgetUser(null);
          setState({ status: "signedOut", error: "UNAUTHORIZED" });
        },
      }),
    [fetch, forgetUser],
  );

  useEffect(
    () => () => {
      cancelStatsInvalidation(queryClient);
    },
    [queryClient],
  );

  useEffect(() => {
    let cancelled = false;
    const settle = (next: AuthState) => {
      if (!cancelled) setState(next);
    };
    // Started now, not after the session check: LIFF's own redirects must run on arrival, and a
    // person who is already signed in never gets as far as `autoSignIn`.
    void line.prepare().catch(() => undefined);
    void (async () => {
      try {
        const restored = await session.restore();
        if (restored !== null) {
          settle({ status: "signedIn", user: restored });
          return;
        }
        const lineToken = await line.autoSignIn();
        settle(
          lineToken === null
            ? { status: "signedOut", error: null }
            : { status: "signedIn", user: await session.signIn("line", lineToken) },
        );
      } catch (error) {
        settle({ status: "signedOut", error: failureCode(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, line]);

  // Persist and restore cache for the signed-in user
  const userId = state.status === "signedIn" ? state.user.id : null;
  useEffect(() => {
    if (userId === null) return;
    restoreCache(queryClient, userId, storage);

    const stop = startCachePersistence(queryClient, userId, storage);
    stopPersistence.current = stop;
    return stop;
  }, [userId, queryClient, storage]);

  const auth = useMemo<Auth>(() => {
    async function leave() {
      forgetUser(state.status === "signedIn" ? state.user.id : null);
      await session.signOut();
      setState({ status: "signedOut", error: null, byChoice: true });
    }

    async function enter(attempt: Promise<Me>) {
      try {
        setState({ status: "signedIn", user: await attempt });
        return true;
      } catch (error) {
        setState({ status: "signedOut", error: failureCode(error) });
        return false;
      }
    }
    function updateUser(user: Me) {
      // Never brings back someone who signed out while a request was in flight.
      setState((current) =>
        current.status === "signedIn" ? { status: "signedIn", user } : current,
      );
    }
    return {
      state,
      session,
      signIn: (provider, idToken) => enter(session.signIn(provider, idToken)),
      redeemLinkCode: (code, idToken) => enter(session.redeemLinkCode(code, idToken)),
      link: async (provider, idToken) => {
        updateUser(await session.link(provider, idToken));
      },
      unlink: async (provider) => {
        updateUser(await session.unlink(provider));
      },
      createLinkCode: () => session.createLinkCode(),
      async refreshIdentities(signal) {
        if (state.status !== "signedIn") return;
        const before = state.user.identities;
        try {
          const { identities } = await session.getMe();
          if (signal.aborted) return;
          setState((current) =>
            current.status === "signedIn" && current.user.identities === before
              ? { status: "signedIn", user: { ...current.user, identities } }
              : current,
          );
        } catch {
          // Offline or signed out meanwhile: the next switch back tries again.
        }
      },
      testSignIn: async (request) => {
        await enter(session.testSignIn(request));
      },
      signOut: leave,
      updateUser,
    };
  }, [state, session, forgetUser]);

  return <AuthContext value={auth}>{children}</AuthContext>;
}

export function useAuth(): Auth {
  const auth = use(AuthContext);
  if (auth === null) throw new Error("useAuth must be used inside AuthProvider");
  return auth;
}
