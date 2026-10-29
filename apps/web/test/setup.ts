import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// Whole-app renders over lazy routes are slow on a busy machine; wait longer than 1 s.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
});
