import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import type { SeedGroup } from "../../test/fake-groups.js";
import { renderApp } from "../../test/render-app.js";

const me = makeUser("小宇");
const tainan = { destination: "台南", startDate: "2026-06-12", endDate: "2026-06-14" };

function openTrip(seed: SeedGroup, query = "") {
  let id = "";
  const app = renderApp({
    cookieUser: me,
    seed: (groups) => {
      id = groups.add(me, { isTrip: true, others: [{ name: "宜庭" }], ...seed });
    },
    pathFor: () => `/groups/${id}?tab=trip${query}`,
  });
  return { ...app, id: () => id };
}

function stopTitles(day: string): string[] {
  const list = screen.getByRole("list", { name: `${day}的行程` });
  return within(list)
    .getAllByRole("heading", { level: 3 })
    .map((h) => h.textContent);
}

describe("Trip itinerary", () => {
  it("lists a day's Stops by start time, untimed Stops last in the order added", async () => {
    const user = userEvent.setup();
    openTrip({
      name: "週末台南小旅行",
      trip: tainan,
      stops: [
        { dayDate: "2026-06-13", title: "神農街散步" },
        { dayDate: "2026-06-13", title: "安平老街", startTime: "16:00" },
        { dayDate: "2026-06-12", title: "抵達台南", startTime: "10:00" },
        { dayDate: "2026-06-13", title: "赤崁樓", startTime: "09:30", endTime: "11:00" },
        { dayDate: "2026-06-13", title: "買伴手禮" },
      ],
    });

    expect(await screen.findByRole("heading", { level: 3, name: "抵達台南" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: /6月13日/ }));

    expect(await screen.findByRole("heading", { level: 3, name: "赤崁樓" })).toBeVisible();
    expect(stopTitles("6月13日")).toEqual(["赤崁樓", "安平老街", "神農街散步", "買伴手禮"]);
    expect(screen.getByText("09:30 – 11:00")).toBeVisible();
  });

  it("asks an Admin to set the Trip dates when nothing is planned yet", async () => {
    const { id } = openTrip({ name: "說走就走" });

    expect(await screen.findByRole("heading", { name: "還沒有行程" })).toBeVisible();
    expect(screen.getByText("還沒設定目的地")).toBeVisible();
    expect(screen.getByText(/先設定出發和回程日期/)).toBeVisible();
    for (const link of screen.getAllByRole("link", { name: /旅程設定/ })) {
      expect(link).toHaveAttribute("href", `/groups/${id()}/trip`);
    }
    expect(screen.queryByRole("link", { name: /加入景點或活動/ })).toBeNull();
  });

  it("tells a Member the Admin sets the dates, without a settings link", async () => {
    openTrip({ name: "說走就走", role: "member", others: [{ name: "宜庭", role: "admin" }] });

    expect(await screen.findByText(/管理員設定旅程日期後/)).toBeVisible();
    expect(screen.queryByRole("link", { name: /旅程設定/ })).toBeNull();
  });

  it("shows an empty day with a link to add its first Stop", async () => {
    const { id } = openTrip(
      {
        name: "週末台南小旅行",
        trip: tainan,
        stops: [{ dayDate: "2026-06-12", title: "抵達台南" }],
      },
      "&day=2026-06-14",
    );

    expect(await screen.findByText(/這天還沒有安排/)).toBeVisible();
    expect(screen.getByRole("heading", { name: "DAY 03 · 6月14日 週日" })).toBeVisible();
    expect(screen.queryByRole("list", { name: "6月14日的行程" })).toBeNull();
    expect(screen.getByRole("link", { name: /加入景點或活動/ })).toHaveAttribute(
      "href",
      `/groups/${id()}/stops/new?day=2026-06-14`,
    );
  });
});

describe("edit a Stop and its Expenses", () => {
  const plan: SeedGroup = {
    name: "週末台南小旅行",
    trip: tainan,
    stops: [
      { dayDate: "2026-06-13", title: "赤崁樓", startTime: "09:30" },
      { dayDate: "2026-06-13", title: "度小月", startTime: "12:30", category: "餐飲" },
    ],
    expenses: [
      { description: "擔仔麵", amount: 1200, stop: "度小月" },
      { description: "布丁", amount: 300, stop: "度小月" },
      { description: "計程車", amount: 250 },
    ],
  };

  it("tags each Stop with the Expenses linked to it", async () => {
    openTrip(plan, "&day=2026-06-13");

    expect(await screen.findByText("已附加 2 筆開銷 · NT$ 1,500")).toBeVisible();
    const first = screen.getByRole("heading", { level: 3, name: "赤崁樓" }).closest("li");
    expect(within(first as HTMLElement).queryByText(/已附加/)).toBeNull();
  });

  it("moves a Stop to a new time, which re-sorts the day", async () => {
    const user = userEvent.setup();
    openTrip(plan, "&day=2026-06-13");

    await user.click(await screen.findByRole("heading", { level: 3, name: "赤崁樓" }));
    expect(await screen.findByRole("heading", { level: 1, name: "編輯這一站" })).toBeVisible();
    expect(screen.getByLabelText("站點名稱")).toHaveValue("赤崁樓");
    await user.clear(screen.getByLabelText("開始時間"));
    await user.type(screen.getByLabelText("開始時間"), "15:00");
    await user.click(screen.getByRole("button", { name: "儲存" }));

    expect(await screen.findByText("15:00")).toBeVisible();
    expect(stopTitles("6月13日")).toEqual(["度小月", "赤崁樓"]);
  });

  it("deletes a Stop and keeps its Expenses", async () => {
    const user = userEvent.setup();
    const { api, id } = openTrip(plan, "&day=2026-06-13");

    await user.click(await screen.findByRole("heading", { level: 3, name: "度小月" }));
    await user.click(await screen.findByRole("button", { name: "刪除這一站" }));
    const dialog = await screen.findByRole("dialog", { name: "刪除「度小月」？" });
    expect(within(dialog).getByText(/開銷會保留/)).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "刪除" }));

    expect(await screen.findByRole("heading", { level: 3, name: "赤崁樓" })).toBeVisible();
    expect(screen.queryByRole("heading", { level: 3, name: "度小月" })).toBeNull();
    expect(api.groups.stops(id()).map((s) => s.title)).toEqual(["赤崁樓"]);
  });
});

describe("Trip settings", () => {
  it("lets an Admin set the destination, dates and notes, then shows the days", async () => {
    const user = userEvent.setup();
    const { api, router, id } = openTrip({ name: "週末台南小旅行" });

    await user.click((await screen.findAllByRole("link", { name: /旅程設定/ }))[0] as HTMLElement);
    expect(await screen.findByRole("heading", { level: 1, name: "旅程設定" })).toBeVisible();
    await user.type(screen.getByLabelText("目的地"), "台南");
    await user.type(screen.getByLabelText("出發日期"), "2026-06-12");
    await user.type(screen.getByLabelText("回程日期"), "2026-06-14");
    await user.type(screen.getByLabelText("旅程備忘"), "早上九點台南車站集合");
    await user.click(screen.getByRole("button", { name: "儲存旅程設定" }));

    expect(await screen.findByText("6月12日 – 6月14日")).toBeVisible();
    expect(router.state.location.pathname).toBe(`/groups/${id()}`);
    expect(screen.getByText("早上九點台南車站集合")).toBeVisible();
    const days = within(screen.getByRole("group", { name: "旅程日期" }));
    expect(days.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "6月12日 週五",
      "6月13日 週六",
      "6月14日 週日",
    ]);
    expect(api.groups.trip(id())).toEqual({
      tripDestination: "台南",
      tripStartDate: "2026-06-12",
      tripEndDate: "2026-06-14",
      tripNotes: "早上九點台南車站集合",
    });
  });

  it("refuses a Trip longer than 31 days", async () => {
    const user = userEvent.setup();
    let id = "";
    const { api } = renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, { name: "長假", isTrip: true });
      },
      pathFor: () => `/groups/${id}/trip`,
    });

    await user.type(await screen.findByLabelText("出發日期"), "2026-07-01");
    await user.type(screen.getByLabelText("回程日期"), "2026-08-01");
    await user.click(screen.getByRole("button", { name: "儲存旅程設定" }));

    expect(await screen.findByText(/旅程最多 31 天/)).toBeVisible();
    expect(api.calls).not.toContain(`PATCH /api/v1/groups/${id}`);
  });

  it("shows a Member the settings read-only", async () => {
    let id = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, {
          name: "週末台南小旅行",
          isTrip: true,
          role: "member",
          others: [{ name: "宜庭", role: "admin" }],
          trip: tainan,
        });
      },
      pathFor: () => `/groups/${id}/trip`,
    });

    expect(await screen.findByText("只有管理員可以修改旅程設定。")).toBeVisible();
    expect(screen.getByLabelText("目的地")).toHaveValue("台南");
    expect(screen.getByLabelText("目的地")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "儲存旅程設定" })).toBeNull();
  });
});

describe("add a Stop", () => {
  it("adds a Stop with a text location and a Google Maps link to the chosen day", async () => {
    const user = userEvent.setup();
    const { api, router, id } = openTrip(
      { name: "週末台南小旅行", trip: tainan },
      "&day=2026-06-13",
    );

    await user.click(await screen.findByRole("link", { name: /加入景點或活動/ }));
    expect(await screen.findByRole("heading", { level: 1, name: "加入一站" })).toBeVisible();
    expect(screen.getByLabelText("日期")).toHaveValue("2026-06-13");

    await user.type(screen.getByLabelText("站點名稱"), "赤崁樓");
    await user.type(screen.getByLabelText("開始時間"), "09:30");
    await user.selectOptions(screen.getByLabelText("類別"), "景點");
    await user.type(screen.getByLabelText("地點"), "台南 赤崁樓");
    expect(screen.getByRole("link", { name: "在地圖開啟「台南 赤崁樓」" })).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=%E5%8F%B0%E5%8D%97%20%E8%B5%A4%E5%B4%81%E6%A8%93",
    );
    await user.click(screen.getByRole("button", { name: "加入這天的行程" }));

    expect(await screen.findByRole("heading", { level: 3, name: "赤崁樓" })).toBeVisible();
    expect(router.state.location.pathname).toBe(`/groups/${id()}`);
    expect(api.groups.stops(id())).toMatchObject([
      {
        dayDate: "2026-06-13",
        title: "赤崁樓",
        startTime: "09:30",
        endTime: null,
        category: "景點",
        locationName: "台南 赤崁樓",
        notes: null,
      },
    ]);
  });

  it("keeps a Stop inside the Trip dates with a forward time range", async () => {
    const user = userEvent.setup();
    let id = "";
    const { api } = renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, { name: "週末台南小旅行", isTrip: true, trip: tainan });
      },
      pathFor: () => `/groups/${id}/stops/new?day=2026-06-12`,
    });

    await user.type(await screen.findByLabelText("站點名稱"), "安平老街");
    await user.type(screen.getByLabelText("開始時間"), "16:00");
    await user.type(screen.getByLabelText("結束時間"), "15:00");
    await user.clear(screen.getByLabelText("日期"));
    await user.type(screen.getByLabelText("日期"), "2026-06-20");
    await user.click(screen.getByRole("button", { name: "加入這天的行程" }));

    expect(await screen.findByText("結束時間不能早於開始時間。")).toBeVisible();
    expect(screen.getByText("日期要在旅程期間內（6月12日 – 6月14日）。")).toBeVisible();
    expect(api.calls).not.toContain(`POST /api/v1/groups/${id}/stops`);
  });
});
