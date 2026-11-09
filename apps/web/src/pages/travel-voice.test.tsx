import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { createFakeRecorder } from "../../test/fake-recorder.js";
import { renderApp } from "../../test/render-app.js";

const searchKey = () =>
  within(screen.getByRole("navigation", { name: "底部導覽" })).getByRole("button", {
    name: "搜尋",
  });
const voicePanel = () => screen.findByRole("dialog", { name: "語音搜尋" });

/** Presses the Search key and holds until the recording has started. */
async function hold(clientY = 500) {
  fireEvent.pointerDown(searchKey(), { button: 0, pointerId: 1, clientY });
  await voicePanel();
}

async function start(options: { denied?: boolean } = {}) {
  const fake = createFakeRecorder(options);
  const app = renderApp({
    path: "/travel",
    cookieUser: makeUser("Rick"),
    recorder: fake.recorder,
  });
  await screen.findByRole("heading", { name: "下一站，沖繩！" });
  return { ...fake, ...app };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("語音搜尋: long-press the Search key", () => {
  it("records while held and, on release, searches what was said", async () => {
    const { api, log } = await start();
    api.voiceText = "台北到沖繩，12 月 4 號到 7 號";
    await hold();
    expect(within(await voicePanel()).getByLabelText("聆聽中")).toBeVisible();
    expect(log.open).toBe(1);
    fireEvent.pointerUp(searchKey(), { pointerId: 1 });
    await waitFor(() => {
      expect(api.flightSearchRequests).toEqual([
        expect.objectContaining({ prompt: "台北到沖繩，12 月 4 號到 7 號" }),
      ]);
    });
    expect(api.voiceRequests).toEqual([{ type: "audio/webm", bytes: 5 }]);
    expect(log.stopped).toBe(1);
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "語音搜尋" })).toBeNull();
    });
    expect(await screen.findByRole("link", { name: /Example Air/ })).toBeVisible();
  });

  it("opens the search sheet on a tap and never starts the microphone", async () => {
    const { api, log } = await start();
    fireEvent.pointerDown(searchKey(), { button: 0, pointerId: 1 });
    fireEvent.pointerUp(searchKey(), { pointerId: 1 });
    expect(await screen.findByRole("dialog", { name: "搜尋面板" })).toBeVisible();
    expect(log.started).toBe(0);
    expect(api.voiceRequests).toHaveLength(0);
  });

  it("opens the search sheet from the keyboard", async () => {
    await start();
    fireEvent.click(searchKey());
    expect(await screen.findByRole("dialog", { name: "搜尋面板" })).toBeVisible();
  });

  it("throws the recording away when the finger slides up before release", async () => {
    const { api, log } = await start();
    api.voiceText = "不該被搜尋";
    await hold(500);
    fireEvent.pointerMove(searchKey(), { pointerId: 1, clientY: 400 });
    expect(await screen.findByText("放開即取消")).toBeVisible();
    fireEvent.pointerUp(searchKey(), { pointerId: 1 });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "語音搜尋" })).toBeNull();
    });
    expect(log.cancelled).toBe(1);
    expect(api.voiceRequests).toHaveLength(0);
    expect(api.flightSearchRequests).toHaveLength(0);
  });

  it("sends the recording by itself at 15 seconds", async () => {
    const { api } = await start();
    api.voiceText = "東京";
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    fireEvent.pointerDown(searchKey(), { button: 0, pointerId: 1, clientY: 500 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(screen.getByRole("dialog", { name: "語音搜尋" })).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(api.voiceRequests).toHaveLength(1);
  });

  it("opens the search sheet with a hint, not an error, when the microphone is denied", async () => {
    const { api } = await start({ denied: true });
    fireEvent.pointerDown(searchKey(), { button: 0, pointerId: 1, clientY: 500 });
    const sheet = await screen.findByRole("dialog", { name: "搜尋面板" });
    expect(within(sheet).getByText(/這裡不能用麥克風/)).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(api.voiceRequests).toHaveLength(0);
  });

  it("asks to try again, and does not search, when nothing was heard", async () => {
    const { api } = await start();
    api.voiceText = "";
    await hold();
    fireEvent.pointerUp(searchKey(), { pointerId: 1 });
    expect(await screen.findByText("沒聽清楚，再長按說一次")).toBeVisible();
    expect(screen.queryByRole("button", { name: "重試" })).toBeNull();
    expect(api.flightSearchRequests).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "關閉" }));
    expect(screen.queryByRole("dialog", { name: "語音搜尋" })).toBeNull();
  });

  it("offers a retry that resends the same recording when the request fails", async () => {
    const { api } = await start();
    api.voiceText = "fails";
    await hold();
    fireEvent.pointerUp(searchKey(), { pointerId: 1 });
    const retry = await screen.findByRole("button", { name: "重試" });
    expect(screen.getByText("沒聽清楚，再長按說一次")).toBeVisible();
    api.voiceText = "大阪";
    fireEvent.click(retry);
    await waitFor(() => {
      expect(api.flightSearchRequests).toEqual([expect.objectContaining({ prompt: "大阪" })]);
    });
    expect(api.voiceRequests).toHaveLength(2);
  });
});
