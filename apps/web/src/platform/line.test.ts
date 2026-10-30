import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLineSignIn, LineShareUnavailableError } from "./line.js";

const liff = vi.hoisted(() => ({
  init: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  isLoggedIn: vi.fn(() => true),
  getIDToken: vi.fn(() => "line-id-token"),
  isApiAvailable: vi.fn(() => true),
  shareTargetPicker: vi.fn((): Promise<{ status: string } | undefined> =>
    Promise.resolve({ status: "success" }),
  ),
  isInClient: vi.fn(() => true),
  closeWindow: vi.fn(),
  sendMessages: vi.fn((): Promise<void> => Promise.resolve()),
  getContext: vi.fn((): { type: string } | null => ({ type: "group" })),
  permission: {
    query: vi.fn((): Promise<{ state: string }> => Promise.resolve({ state: "granted" })),
  },
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

it("drops a stale browser LIFF login before the button starts a new one", async () => {
  liff.isInClient.mockReturnValueOnce(false);
  await createLineSignIn("liff-id").login();

  expect(liff.logout).toHaveBeenCalledTimes(1);
  expect(liff.login).toHaveBeenCalledTimes(1);
  expect(liff.logout.mock.invocationCallOrder[0]).toBeLessThan(
    liff.login.mock.invocationCallOrder[0] ?? Number.NaN,
  );
});

it("leaves the LINE app's own login alone", async () => {
  await createLineSignIn("liff-id").login();

  expect(liff.logout).not.toHaveBeenCalled();
});

it("does not log out a browser that is not logged in to LIFF", async () => {
  liff.isInClient.mockReturnValueOnce(false);
  liff.isLoggedIn.mockReturnValueOnce(false);
  await createLineSignIn("liff-id").login();

  expect(liff.logout).not.toHaveBeenCalled();
  expect(liff.login).toHaveBeenCalledTimes(1);
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

describe("posting into the current LINE chat", () => {
  const inLineApp = () => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 Line/14.0",
    });
  };
  const outsideLine = Object.getOwnPropertyDescriptor(navigator, "userAgent");
  afterEach(() => {
    if (outsideLine) Object.defineProperty(navigator, "userAgent", outsideLine);
  });

  it("is offered in a chat when the LIFF app may write there", async () => {
    inLineApp();
    await expect(createLineSignIn("liff-id").canSendToChat()).resolves.toBe(true);
  });

  it.each(["utou", "group", "room"])("works from a %s chat", async (type) => {
    inLineApp();
    liff.getContext.mockReturnValueOnce({ type });
    await expect(createLineSignIn("liff-id").canSendToChat()).resolves.toBe(true);
  });

  it("is hidden outside a chat, without the scope, and outside the LINE app", async () => {
    inLineApp();
    liff.getContext.mockReturnValueOnce({ type: "none" });
    await expect(createLineSignIn("liff-id").canSendToChat()).resolves.toBe(false);

    liff.permission.query.mockResolvedValueOnce({ state: "unavailable" });
    await expect(createLineSignIn("liff-id").canSendToChat()).resolves.toBe(false);

    Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Chrome/120" });
    await expect(createLineSignIn("liff-id").canSendToChat()).resolves.toBe(false);
    expect(liff.permission.query).toHaveBeenCalledTimes(1);
  });

  it("is hidden when LIFF cannot say, rather than failing the form", async () => {
    inLineApp();
    liff.permission.query.mockRejectedValueOnce(new Error("no permission module"));
    await expect(createLineSignIn("liff-id").canSendToChat()).resolves.toBe(false);
  });

  it("sends the messages with sendMessages", async () => {
    const message = { type: "text" as const, text: "hi" };
    await createLineSignIn("liff-id").sendToChat([message]);
    expect(liff.sendMessages).toHaveBeenCalledWith([message]);
  });

  it("shares a Flex card through the picker like a text", async () => {
    const message = { type: "text" as const, text: "card" };
    await expect(createLineSignIn("liff-id").shareMessages([message])).resolves.toBe(true);
    expect(liff.shareTargetPicker).toHaveBeenCalledWith([message]);
  });
});
