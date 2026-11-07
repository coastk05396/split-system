import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { renderApp } from "../../test/render-app.js";
import { makeUser } from "../../test/fake-api.js";

it.each(["en", "zh-TW"] as const)(
  "subscribes, lists and cancels a Web Price Watch in %s",
  async (language) => {
    let subscriptions = 0;
    const { api } = renderApp({
      path: "/travel",
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
    await screen.findByRole("heading", { name: en ? "Flight Radar" : "航班雷達" });
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
    fireEvent.click(screen.getByText(en ? "My Price Watches" : "我的降價雷達"));
    const list = screen.getByRole("region", { name: en ? "My Price Watches" : "我的降價雷達" });
    expect(await within(list).findByText(/TPE → NRT/)).toBeVisible();
    fireEvent.click(within(list).getByRole("button", { name: en ? "Cancel watch" : "取消追蹤" }));
    await waitFor(() => {
      expect(within(list).queryByText(/TPE → NRT/)).toBeNull();
    });
  },
);
