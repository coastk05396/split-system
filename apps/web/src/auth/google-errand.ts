import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate, type NavigateFunction } from "react-router";
import { ApiFailure, type ErrorCode } from "../api/errors.js";
import { useDeps } from "../app/AppProviders.js";
import { safeNext } from "../app/routes.js";
import type { GoogleErrand, GoogleSignIn } from "../platform/google.js";
import type { LineSignIn } from "../platform/line.js";
import { useAuth, type Auth } from "./AuthProvider.js";

type ErrandAuth = Pick<Auth, "state" | "signIn" | "redeemLinkCode" | "link" | "createLinkCode">;
type Arrival = GoogleErrand | "return" | "settings" | null;
type Snapshot = {
  purpose: GoogleErrand["purpose"] | null;
  phase: "ready" | "leaving";
  error: ErrorCode | null;
};

function origin(errand: GoogleErrand): string {
  if (errand.purpose === "signIn")
    return `/sign-in?next=${encodeURIComponent(safeNext(errand.next))}`;
  if (errand.purpose === "link") return "/settings";
  return `/link?code=${encodeURIComponent(errand.code)}`;
}

/** Owns the Google round trip; the platform still owns state/nonce validation and once storage. */
export function createGoogleErrand(
  {
    google,
    line,
    auth,
    navigate,
  }: {
    google: GoogleSignIn;
    line: LineSignIn;
    auth: () => ErrandAuth;
    navigate: NavigateFunction;
  },
  arrival: Arrival = null,
) {
  function waiting(errand: GoogleErrand): boolean {
    return (
      !line.isInClient() &&
      google.available &&
      (errand.purpose !== "linkCode" || auth().state.status === "signedOut")
    );
  }
  const answer = arrival === "return" ? google.takeRedirectResult() : undefined;
  let snapshot: Snapshot = {
    purpose: answer?.errand.purpose ?? null,
    phase:
      arrival === "return" || (typeof arrival === "object" && arrival !== null && waiting(arrival))
        ? "leaving"
        : "ready",
    error: null,
  };
  const listeners = new Set<() => void>();
  function change(phase: Snapshot["phase"], error: ErrorCode | null = null) {
    snapshot = { ...snapshot, phase, error };
    listeners.forEach((notify) => {
      notify();
    });
  }
  let resumed = false;
  let finished = false;
  return {
    getSnapshot: () => snapshot,
    clearError: () => {
      change(snapshot.phase);
    },
    subscribe: (notify: () => void) => {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    start: async (errand: GoogleErrand) => {
      change("leaving", snapshot.error);
      try {
        if (!line.isInClient()) {
          // An explicit tap keeps its spinner until departure or a bfcache restore.
          google.redirect(errand);
          return;
        }
        let target = window.location.href;
        if (errand.purpose === "link") {
          const code = await auth().createLinkCode();
          target = `${window.location.origin}/link?code=${code}`;
        } else if (errand.purpose === "signIn") {
          const url = new URL(target);
          url.searchParams.set("google", "1");
          target = url.toString();
        }
        await line.openExternal(target);
        change("ready", snapshot.error);
      } catch (error) {
        change("ready", error instanceof ApiFailure ? error.code : "INTERNAL");
      }
    },
    resume(errand: GoogleErrand | null) {
      if (errand === null || !waiting(errand) || resumed) return;
      resumed = true;
      change("leaving");
      if (
        (errand.purpose === "linkCode" && errand.code === "") ||
        !google.redirect(errand, { once: true })
      )
        change("ready");
    },
    restore(persisted: boolean) {
      if (persisted) change("ready", snapshot.error);
    },
    async finish(isActive: () => boolean = () => true) {
      if (auth().state.status === "loading" || finished) return;
      finished = true;
      const result = answer === undefined ? google.takeRedirectResult() : answer;
      if (result === null) {
        void navigate("/sign-in", { replace: true });
        return;
      }
      const { errand, idToken } = result;
      if (
        idToken === null ||
        (errand.purpose === "linkCode" && auth().state.status === "signedIn")
      ) {
        void navigate(origin(errand), { replace: true });
        return;
      }
      const linked = { replace: true, state: { linked: "google" } };
      try {
        let succeeded = true;
        if (errand.purpose === "signIn") await auth().signIn("google", idToken);
        else if (errand.purpose === "linkCode")
          succeeded = await auth().redeemLinkCode(errand.code, idToken);
        else await auth().link("google", idToken);
        if (!isActive()) return;
        if (errand.purpose === "link" || (errand.purpose === "linkCode" && succeeded)) {
          void navigate("/settings", linked);
        } else void navigate(origin(errand), { replace: true });
      } catch (error) {
        if (isActive()) change("ready", error instanceof ApiFailure ? error.code : "INTERNAL");
      }
    },
  };
}

/** React only supplies the current auth and browser lifecycle; pages render the snapshot. */
export function useGoogleErrand(arrival: Arrival = null) {
  const { google, line } = useDeps();
  const auth = useAuth();
  const navigate = useNavigate();
  const current = useRef(auth);
  const mounted = useRef(true);
  useEffect(() => {
    current.current = auth;
  });
  const [errand] = useState(() =>
    createGoogleErrand({ google, line, auth: () => current.current, navigate }, arrival),
  );
  const snapshot = useSyncExternalStore(errand.subscribe, errand.getSnapshot);
  useEffect(() => {
    mounted.current = true;
    const show = (event: PageTransitionEvent) => {
      errand.restore(event.persisted);
    };
    window.addEventListener("pageshow", show);
    return () => {
      mounted.current = false;
      window.removeEventListener("pageshow", show);
    };
  }, [errand]);
  useEffect(() => {
    if (arrival === "return") void errand.finish(() => mounted.current);
    else if (arrival !== "settings") errand.resume(arrival);
  }, [arrival, auth.state.status, errand]);
  useEffect(() => {
    if (arrival !== "settings" || auth.state.status !== "signedIn") return;
    const controller = new AbortController();
    const visible = () => {
      if (document.visibilityState === "visible")
        void current.current.refreshIdentities(controller.signal);
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      controller.abort();
      document.removeEventListener("visibilitychange", visible);
    };
  }, [arrival, auth.state.status]);
  return { ...snapshot, start: errand.start, clearError: errand.clearError };
}
