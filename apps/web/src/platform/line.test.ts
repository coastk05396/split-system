import { beforeEach, expect, it, vi } from "vitest";
import { createLineSignIn, LineShareUnavailableError } from "./line.js";

const liff = vi.hoisted(() => ({
  init: vi.fn(),
  login: vi.fn(),
  isLoggedIn: vi.fn(() => true),
  getIDToken: vi.fn(() => "line-id-token"),
  isApiAvailable: vi.fn(() => true),
  shareTargetPicker: vi.fn((): Promise<{ status: string } | undefined> =>
    Promise.resolve({ status: "success" }),
  ),
  isInClient: vi.fn(() => true),
  closeWindow: vi.fn(),
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

it("initializes LIFF once when signing in and sharing on the same page", async () => {
  const line = createLineSignIn("liff-id");
  await line.login();
  await line.autoSignIn();
  await expect(line.share("Join us")).resolves.toBe(true);

  expect(liff.init).toHaveBeenCalledTimes(1);
  expect(liff.shareTargetPicker).toHaveBeenCalledWith([{ type: "text", text: "Join us" }]);
  expect(liff.closeWindow).toHaveBeenCalledTimes(1);
});

it("reports when LINE cannot show the recipient picker", async () => {
  liff.isApiAvailable.mockReturnValueOnce(false);
  await expect(createLineSignIn("liff-id").share("Join us")).rejects.toBeInstanceOf(
    LineShareUnavailableError,
  );
  expect(liff.shareTargetPicker).not.toHaveBeenCalled();
  expect(liff.closeWindow).not.toHaveBeenCalled();
});

it("stays in the app when recipient selection is canceled", async () => {
  liff.shareTargetPicker.mockResolvedValueOnce(undefined);
  await expect(createLineSignIn("liff-id").share("Join us")).resolves.toBe(false);
  expect(liff.closeWindow).not.toHaveBeenCalled();
});
