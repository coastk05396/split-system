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
  localStorage.clear();
  vi.clearAllMocks();
  liff.init.mockResolvedValue(undefined);
});

it("keeps the LINE return marker through a LIFF initialization redirect", async () => {
  await createLineSignIn("liff-id").login();
  expect(localStorage.getItem("split.lineLogin")).not.toBeNull();

  liff.init.mockRejectedValueOnce(new Error("page is redirecting"));
  await expect(createLineSignIn("liff-id").autoSignIn()).rejects.toThrow("page is redirecting");
  expect(localStorage.getItem("split.lineLogin")).not.toBeNull();

  await expect(createLineSignIn("liff-id").autoSignIn()).resolves.toBe("line-id-token");
  expect(localStorage.getItem("split.lineLogin")).toBeNull();
});

describe("coming back from LINE Login in a new tab", () => {
  const chrome = "Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36";
  beforeEach(() => {
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: chrome });
    liff.isInClient.mockReturnValue(false);
  });
  afterEach(() => {
    Reflect.deleteProperty(navigator, "userAgent");
    window.history.replaceState(null, "", "/");
    liff.isInClient.mockReturnValue(true);
  });

  it("finds the marker the login left in another tab, where sessionStorage is empty", async () => {
    await createLineSignIn("liff-id").login();
    sessionStorage.clear();

    await expect(createLineSignIn("liff-id").autoSignIn()).resolves.toBe("line-id-token");
  });

  it("recognises LIFF's own return address with no marker at all", async () => {
    window.history.replaceState(null, "", "/?liff.state=%2Fsign-in");

    await expect(createLineSignIn("liff-id").autoSignIn()).resolves.toBe("line-id-token");
  });

  it("ignores a marker from a login that never came back", async () => {
    localStorage.setItem("split.lineLogin", String(Date.now() - 11 * 60 * 1000));

    await expect(createLineSignIn("liff-id").autoSignIn()).resolves.toBeNull();
    expect(liff.init).not.toHaveBeenCalled();
  });

  it("starts LIFF on arrival only when a login is coming back", async () => {
    await createLineSignIn("liff-id").prepare();
    expect(liff.init).not.toHaveBeenCalled();

    window.history.replaceState(null, "", "/?liff.state=%2Fnew");
    await createLineSignIn("liff-id").prepare();
    expect(liff.init).toHaveBeenCalledTimes(1);
  });
});

it("starts LIFF on arrival inside the LINE app, even for a signed-in person", async () => {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: "Mozilla/5.0 Line/14.0",
  });
  try {
    await createLineSignIn("liff-id").prepare();
    expect(liff.init).toHaveBeenCalledTimes(1);
  } finally {
    Reflect.deleteProperty(navigator, "userAgent");
  }
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

it("starts LINE login before sharing a card in an external browser", async () => {
  liff.isLoggedIn.mockReturnValueOnce(false);
  liff.isInClient.mockReturnValueOnce(false);
  await expect(
    createLineSignIn("liff-id").shareMessages([{ type: "text", text: "Join" }]),
  ).resolves.toBe(false);
  expect(liff.login).toHaveBeenCalledWith({ redirectUri: window.location.href });
  expect(localStorage.getItem("split.lineLogin")).not.toBeNull();
  sessionStorage.clear();
  await createLineSignIn("liff-id").prepare();
  expect(liff.init).toHaveBeenCalledTimes(2);
  expect(liff.shareTargetPicker).not.toHaveBeenCalled();
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
