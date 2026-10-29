import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { setLocale } from "../src/i18n/messages.js";

// Whole-app renders over lazy routes are slow on a busy machine; wait longer than 1 s.
configure({ asyncUtilTimeout: 5000 });

// jsdom has no matchMedia. The unit tests run as a user who asked for reduced motion, so every
// count-up and slide is at its end state; the motion itself is tested in shell/motion.test.tsx.
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  writable: true,
  value: vi.fn().mockImplementation((media: string) => ({
    matches: media.includes("prefers-reduced-motion"),
    media,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

afterEach(() => {
  cleanup();
  // A test that switches to English must not leave the next one in it.
  setLocale("zh-TW");
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
