import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "../../test/render-app.js";
import { makeUser } from "../../test/fake-api.js";
import { openSearchPanel } from "../../test/flight-panel.js";

it.each(["en", "zh-TW"] as const)(
  "subscribes, lists and cancels a Web Price Watch in %s",
  async (language) => {
    let subscriptions = 0;
    const { api } = renderApp({
      path: "/travel/flights",
      cookieUser: { ...makeUser("Watcher"), language },
      webPush: {
        subscribe: () => {
          subscriptions++;
          return Promise.resolve({
            endpoint: "https://fcm.googleapis.com/test",
            keys: { p256dh: "test", auth: "test" },
          });
        },
      },
    });
    const en = language === "en";
    await screen.findByRole("heading", { name: en ? "Next stop, Okinawa!" : "下一站，沖繩！" });
    await openSearchPanel();
    fireEvent.change(screen.getByLabelText(en ? "Destination airport" : "目的地機場"), {
      target: { value: "NRT" },
    });
    fireEvent.change(screen.getByLabelText(en ? "Departure date" : "出發日期"), {
      target: { value: "2027-01-08" },
    });
    fireEvent.change(screen.getByLabelText(en ? "Return date" : "回程日期"), {
      target: { value: "2027-01-11" },
    });
    fireEvent.click(screen.getByRole("button", { name: en ? "Search flights" : "搜尋航班" }));
    fireEvent.click(await screen.findByRole("button", { name: en ? "Price Watch" : "降價叫醒我" }));
    const drawer = await screen.findByRole("dialog", { name: en ? "Price Watch" : "降價叫醒我" });
    fireEvent.change(within(drawer).getByLabelText(en ? "Target fare" : "目標票價"), {
      target: { value: "18000" },
    });
    fireEvent.click(
      within(drawer).getByRole("button", { name: en ? "Enable browser alert" : "開啟瀏覽器通知" }),
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(subscriptions).toBe(1);
    expect(api.requests.find((r) => r.route === "POST /api/v1/flights/watches")?.body).toContain(
      '"targetFare":18000',
    );
    await openSearchPanel(); // the bell now sits in the ticket card's trip row
    fireEvent.click(screen.getByRole("link", { name: en ? "Price Watch radar" : "降價雷達" }));
    const list = await screen.findByRole("region", {
      name: en ? "My Price Watches" : "我的降價雷達",
    });
    expect(await within(list).findByText(/TPE → NRT/)).toBeVisible();
    expect(within(list).getByText(en ? "Jan 8 – Jan 11" : "1/8（五）– 1/11（一）")).toBeVisible();
    expect(within(list).queryByText(/2027-01/)).toBeNull();
    fireEvent.click(within(list).getByRole("button", { name: en ? "Cancel watch" : "取消追蹤" }));
    await waitFor(() => {
      expect(within(list).queryByText(/TPE → NRT/)).toBeNull();
    });
  },
);

async function searchNrt() {
  await screen.findByRole("heading", { name: "下一站，沖繩！" });
  await openSearchPanel();
  fireEvent.change(screen.getByLabelText("目的地機場"), { target: { value: "NRT" } });
  fireEvent.change(screen.getByLabelText("出發日期"), { target: { value: "2027-01-08" } });
  fireEvent.change(screen.getByLabelText("回程日期"), { target: { value: "2027-01-11" } });
  fireEvent.click(screen.getByRole("button", { name: "搜尋航班" }));
  fireEvent.click(await screen.findByRole("button", { name: "降價叫醒我" }));
  return screen.findByRole("dialog", { name: "降價叫醒我" });
}

describe("Price Watch inside LIFF", () => {
  it("defaults to a LINE alert, without browser push, when the monthly quota permits", async () => {
    const { api } = renderApp({
      path: "/travel/flights",
      cookieUser: makeUser("Rick"),
      insideLine: { idToken: null },
    });
    const drawer = await searchNrt();

    fireEvent.click(await within(drawer).findByRole("button", { name: "開啟 LINE 提醒" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    const posted = api.requests.find((r) => r.route === "POST /api/v1/flights/watches");
    expect(JSON.parse(posted?.body ?? "{}")).toMatchObject({ channel: "line_push" });
    expect(api.requests.some((r) => r.route.includes("push-subscriptions"))).toBe(false);
  });

  it("guides to the phone's external browser for free Web Push when LINE alerts are unavailable", async () => {
    const { api, lineExternalOpens } = renderApp({
      path: "/travel/flights",
      cookieUser: makeUser("Rick"),
      insideLine: { idToken: null },
    });
    api.linePushAvailable = false;
    const drawer = await searchNrt();

    fireEvent.click(await within(drawer).findByRole("button", { name: "用手機瀏覽器開啟" }));

    await waitFor(() => {
      expect(lineExternalOpens).toHaveLength(1);
    });
    expect(lineExternalOpens[0]).toContain("/travel?origin=TPE&destination=NRT");
    expect(within(drawer).queryByRole("button", { name: "開啟 LINE 提醒" })).toBeNull();
    expect(api.requests.some((r) => r.route === "POST /api/v1/flights/watches")).toBe(false);
  });

  it("creates the LINE watch from the chat link only after an explicit confirm tap", async () => {
    const { api } = renderApp({
      path: "/travel?origin=TPE&destination=OKA&departureDate=2027-01-08&returnDate=2027-01-11&currency=TWD&excludeRedEye=0&directOnly=0&watch=line&fare=7000",
      insideLine: { idToken: "fake|line-1|阿芽" },
    });

    // Arriving through a link must not create anything by itself.
    await screen.findByRole("region", { name: "搜尋結果" });
    const confirm = await screen.findByRole("button", { name: "確認設定 LINE 降價提醒" });
    expect(api.requests.some((r) => r.route === "POST /api/v1/flights/watches")).toBe(false);
    fireEvent.click(confirm);

    expect(await screen.findByText("已設定降價提醒，會用 LINE 通知你一次。")).toBeVisible();
    const posted = api.requests.find((r) => r.route === "POST /api/v1/flights/watches");
    expect(JSON.parse(posted?.body ?? "{}")).toMatchObject({
      channel: "line_push",
      baselineFare: 7000,
      targetFare: 5950,
      intent: { destination: "OKA" },
    });
    await openSearchPanel();
    fireEvent.click(screen.getByRole("link", { name: "降價雷達" }));
    const list = await screen.findByRole("region", { name: "我的降價雷達" });
    expect(await within(list).findByText(/TPE → OKA/)).toBeVisible();
  });
});
