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

  beforeEach(() => {
    liff.getContext.mockReset();
    liff.getContext.mockReturnValue({ type: "group" });
    liff.permission.query.mockReset();
    liff.permission.query.mockResolvedValue({ state: "granted" });
  });
  // jsdom's userAgent is a getter on the prototype: drop the override we put on the instance.
  afterEach(() => {
    Reflect.deleteProperty(navigator, "userAgent");
  });

  it.each(["utou", "group", "room"])(
    "is offered in a %s chat when the scope is there",
    async (type) => {
      inLineApp();
      liff.getContext.mockReturnValue({ type });
      await expect(createLineSignIn("liff-id").canSendToChat()).resolves.toBe(true);
    },
  );

  it("is hidden when the app was not opened from a chat", async () => {
    inLineApp();
    liff.getContext.mockReturnValue({ type: "none" });
    await expect(createLineSignIn("liff-id").canSendToChat()).resolves.toBe(false);
  });

  it("is hidden when the LIFF app lacks the chat_message.write scope", async () => {
    inLineApp();
    liff.permission.query.mockResolvedValue({ state: "unavailable" });
    await expect(createLineSignIn("liff-id").canSendToChat()).resolves.toBe(false);
  });

  it("is hidden outside the LINE app without asking LIFF anything", async () => {
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Chrome/120" });
    await expect(createLineSignIn("liff-id").canSendToChat()).resolves.toBe(false);
    expect(liff.permission.query).not.toHaveBeenCalled();
  });

  it("is hidden when LIFF cannot say, rather than failing the form", async () => {
    inLineApp();
    liff.permission.query.mockRejectedValue(new Error("no access token"));
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
