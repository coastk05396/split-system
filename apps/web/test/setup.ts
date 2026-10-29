import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Whole-app renders over lazy routes are slow on a busy machine; wait longer than 1 s.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
});

// jsdom has no Web Worker: run the Payment plan Worker's message handler in-thread, async.
vi.mock("../src/settlements/plan-worker.js", async () => {
  const { handlePaymentPlanMessage } = await import("@split/shared");
  return {
    startPlanWorker: () => {
      const worker = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        onerror: null,
        postMessage(data: unknown) {
          setTimeout(() => worker.onmessage?.({ data: handlePaymentPlanMessage(data) }), 0);
        },
        terminate() {
          worker.onmessage = null;
        },
      };
      return worker;
    },
  };
});
