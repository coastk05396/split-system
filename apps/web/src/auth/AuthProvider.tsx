import type { Me, Provider, TestSignInRequest } from "@split/shared";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, use, useEffect, useMemo, useState } from "react";
import { ApiFailure, type ErrorCode } from "../api/errors.js";
import {
  type CacheStorage,
  clearCache,
  restoreCache,
  saveCache,
} from "../groups/cache-persistence.js";
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
  signIn: (provider: Provider, idToken: string) => Promise<void>;
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
  const session = useMemo(
    () =>
      createSession({
        fetch,
        onSignedOut: () => {
          queryClient.clear();
          setState({ status: "signedOut", error: "UNAUTHORIZED" });
        },
      }),
    [fetch, queryClient],
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
  useEffect(() => {
    if (state.status !== "signedIn") return;
    const userId = state.user.id;
    restoreCache(queryClient, userId, storage);

    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "success") {
        saveCache(queryClient, userId, storage);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [state.status, state.status === "signedIn" ? state.user.id : null, queryClient, storage]);

  const auth = useMemo<Auth>(() => {
    async function enter(attempt: Promise<Me>) {
      try {
        setState({ status: "signedIn", user: await attempt });
      } catch (error) {
        setState({ status: "signedOut", error: failureCode(error) });
      }
    }
    return {
      state,
      session,
      signIn: (provider, idToken) => enter(session.signIn(provider, idToken)),
      testSignIn: (request) => enter(session.testSignIn(request)),
      async signOut() {
        if (state.status === "signedIn") {
          clearCache(state.user.id, storage);
        }
        queryClient.clear();
        await session.signOut();
        setState({ status: "signedOut", error: null, byChoice: true });
      },
      updateUser(user) {
        setState({ status: "signedIn", user });
      },
    };
  }, [state, session, queryClient, storage]);

  return <AuthContext value={auth}>{children}</AuthContext>;
}

export function useAuth(): Auth {
  const auth = use(AuthContext);
  if (auth === null) throw new Error("useAuth must be used inside AuthProvider");
  return auth;
}
