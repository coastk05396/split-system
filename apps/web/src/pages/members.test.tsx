import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import type { SeedGroup } from "../../test/fake-groups.js";
import { renderApp } from "../../test/render-app.js";

const me = makeUser("小宇");

function membersOf(seed: SeedGroup) {
  let id = "";
  const rendered = renderApp({
    cookieUser: me,
    seed: (groups) => {
      id = groups.add(me, seed);
    },
    pathFor: () => `/groups/${id}/members`,
  });
  return { ...rendered, id: () => id };
}

const rows = async () =>
  within(await screen.findByRole("list", { name: "群組成員" })).getAllByRole("listitem");

describe("members", () => {
  it("lists Members with roles, Nicknames, Placeholders and Former Members", async () => {
    membersOf({
      name: "台南",
      others: [
        { name: "Yizhen", nickname: "宜庭" },
        { name: "阿哲", status: "placeholder" },
        { name: "Gulu", status: "former" },
      ],
    });

    expect(await screen.findByText("台南 · 3 位成員")).toBeVisible();
    expect((await rows()).map((li) => li.textContent)).toEqual([
      expect.stringMatching(/小宇（你）.*管理員/),
      expect.stringMatching(/宜庭.*成員/),
      expect.stringMatching(/阿哲（未加入）/),
    ]);
    const former = within(screen.getByRole("list", { name: "已離開的成員" }));
    expect(former.getByText("Gulu")).toBeVisible();
    expect(screen.getByText("群組最多 30 位成員")).toBeVisible();
  });

  it("lets an Admin promote, demote and remove from the … menu", async () => {
    const user = userEvent.setup();
    const { api, id } = membersOf({ name: "台南", others: [{ name: "宜庭" }, { name: "阿哲" }] });

    await user.click(await screen.findByRole("button", { name: "宜庭 的操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "設為管理員" }));
    expect((await rows())[1]).toHaveTextContent(/宜庭.*管理員/);
    await screen.findByRole("button", { name: "宜庭 的操作" });

    await user.click(screen.getByRole("button", { name: "宜庭 的操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "改為一般成員" }));
    await waitFor(async () => {
      expect((await rows())[1]).not.toHaveTextContent("管理員");
    });

    await user.click(screen.getByRole("button", { name: "阿哲 的操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "移除成員" }));
    const former = await screen.findByRole("list", { name: "已離開的成員" });
    expect(within(former).getByText("阿哲")).toBeVisible();
    expect(api.groups.members(id()).find((m) => m.name === "阿哲")?.status).toBe("former");
  });

  it("blocks removing a Member whose Balance is not zero", async () => {
    const user = userEvent.setup();
    membersOf({ name: "台南", others: [{ name: "宜庭", balance: -320 }] });

    await user.click(await screen.findByRole("button", { name: "宜庭 的操作" }));
    await user.click(await screen.findByRole("menuitem", { name: "移除成員" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "宜庭 尚有 -NT$ 320 待結算，結清後才能移除。",
    );
  });

  it("gives a plain Member no … menu on others", async () => {
    membersOf({ name: "台南", role: "member", others: [{ name: "ty", role: "admin" }] });

    await rows();
    expect(screen.queryByRole("button", { name: "ty 的操作" })).toBeNull();
  });

  it("sets my own Nickname for this Group", async () => {
    const user = userEvent.setup();
    membersOf({ name: "台南" });

    const field = await screen.findByLabelText("我在這個群組的暱稱");
    expect(field).toHaveValue("小宇");
    await user.clear(field);
    await user.type(field, "宇宇");
    await user.click(screen.getByRole("button", { name: "儲存暱稱" }));

    expect(await screen.findByRole("status")).toHaveTextContent("暱稱已更新");
    expect((await rows())[0]).toHaveTextContent("宇宇（你）");
  });

  it("adds a Placeholder Member by name and explains a taken name", async () => {
    const user = userEvent.setup();
    membersOf({ name: "台南", others: [{ name: "宜庭" }] });

    await user.type(await screen.findByLabelText("名字"), "阿哲");
    await user.click(screen.getByRole("button", { name: "新增" }));
    expect((await rows())[2]).toHaveTextContent("阿哲（未加入）");
    expect(screen.getByLabelText("名字")).toHaveValue("");

    await user.type(screen.getByLabelText("名字"), "宜庭");
    await user.click(screen.getByRole("button", { name: "新增" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("群組裡已經有同名的成員了。");
  });
});
