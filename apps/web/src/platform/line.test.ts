import { beforeEach, expect, it, vi } from "vitest";
import { createLineSignIn } from "./line.js";

const liff = vi.hoisted(() => ({
  init: vi.fn(),
  login: vi.fn(),
  isLoggedIn: vi.fn(() => true),
  getIDToken: vi.fn(() => "line-id-token"),
}));

vi.mock("@line/liff", () => ({ default: liff }));

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  liff.init.mockResolvedValue(undefined);
});

it("keeps the LINE return marker through a LIFF initialization redirect", async () => {
  await createLineSignIn("liff-id").login();
  expect(sessionStorage.getItem("split.lineLogin")).toBe("1");

  liff.init.mockRejectedValueOnce(new Error("page is redirecting"));
  await expect(createLineSignIn("liff-id").autoSignIn()).rejects.toThrow("page is redirecting");
  expect(sessionStorage.getItem("split.lineLogin")).toBe("1");

  await expect(createLineSignIn("liff-id").autoSignIn()).resolves.toBe("line-id-token");
  expect(sessionStorage.getItem("split.lineLogin")).toBeNull();
});
