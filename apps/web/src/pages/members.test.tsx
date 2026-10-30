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
  it("lists Members with roles and Placeholders while hiding Former Members", async () => {
    membersOf({
      name: "台南",
      others: [
        { name: "宜庭" },
        { name: "阿哲", status: "placeholder" },
        { name: "Gulu", status: "former" },
      ],
    });

    expect(await screen.findByRole("heading", { name: "成員與邀請" })).toBeVisible();
    expect((await rows()).map((li) => li.textContent)).toEqual([
      expect.stringMatching(/小宇（你）.*管理員/),
      expect.stringMatching(/宜庭.*成員/),
      expect.stringMatching(/阿哲（未加入）/),
    ]);
    expect(screen.queryByText("Gulu")).toBeNull();
  });

  it("lets an Admin promote, demote and remove with the role pill and trash button", async () => {
    const user = userEvent.setup();
    const { api, id } = membersOf({ name: "台南", others: [{ name: "宜庭" }, { name: "阿哲" }] });

    await user.click(await screen.findByRole("button", { name: "宜庭 的角色" }));
    await user.click(await screen.findByRole("menuitem", { name: "管理員" }));
    await user.click(await screen.findByRole("button", { name: "設為管理員" }));
    await waitFor(async () => expect((await rows())[1]).toHaveTextContent("管理員"));

    await user.click(screen.getByRole("button", { name: "宜庭 的角色" }));
    await user.click(await screen.findByRole("menuitem", { name: "成員" }));
    await waitFor(async () => expect((await rows())[1]).toHaveTextContent("成員"));

    await user.click(screen.getByRole("button", { name: "移除 阿哲" }));
    expect(await screen.findByRole("heading", { name: "移除 阿哲？" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "移除" }));
    await waitFor(async () => {
      expect(await rows()).toHaveLength(2);
    });
    expect(screen.queryByText("阿哲")).toBeNull();
    expect(api.groups.members(id()).find((m) => m.name === "阿哲")?.status).toBe("former");
  });

  it("asks before removing and leaves the Member when cancelled", async () => {
    const user = userEvent.setup();
    const { api, id } = membersOf({ name: "台南", others: [{ name: "阿哲" }] });

    await user.click(await screen.findByRole("button", { name: "移除 阿哲" }));
    await user.click(await screen.findByRole("button", { name: "取消" }));

    expect(api.groups.members(id()).find((m) => m.name === "阿哲")?.status).toBe("active");
  });

  it("blocks removing a Member whose Balance is not zero without asking", async () => {
    const user = userEvent.setup();
    membersOf({ name: "台南", others: [{ name: "宜庭", balance: -320 }] });

    await user.click(await screen.findByRole("button", { name: "移除 宜庭" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "宜庭 尚有 -NT$ 320 待結算，結清後才能移除。",
    );
    expect(screen.queryByRole("heading", { name: "移除 宜庭？" })).toBeNull();
  });

  it("lets a member rename a Placeholder", async () => {
    const user = userEvent.setup();
    membersOf({ name: "台南", others: [{ name: "成員1", status: "placeholder" }] });

    await rows();
    expect(screen.getByRole("button", { name: "移除 成員1" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "成員1 的角色" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "修改 成員1 的名稱" }));
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("button", { name: "修改 成員1 的名稱" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "修改 成員1 的名稱" }));
    await user.clear(screen.getByLabelText("成員名稱"));
    await user.type(screen.getByLabelText("成員名稱"), "小明");
    await user.click(screen.getByRole("button", { name: "儲存" }));
    await waitFor(async () => expect((await rows())[1]).toHaveTextContent("小明（未加入）"));
  });

  it("lets a plain Member rename a Placeholder without allowing removal", async () => {
    const user = userEvent.setup();
    membersOf({ name: "台南", role: "member", others: [{ name: "成員1", status: "placeholder" }] });
    await user.click(await screen.findByRole("button", { name: "修改 成員1 的名稱" }));
    await user.clear(screen.getByLabelText("成員名稱"));
    await user.type(screen.getByLabelText("成員名稱"), "小明");
    await user.click(screen.getByRole("button", { name: "儲存" }));
    await waitFor(async () => expect((await rows())[1]).toHaveTextContent("小明（未加入）"));
    expect(screen.queryByRole("button", { name: "移除 小明" })).toBeNull();
  });

  it("gives a plain Member no controls on others", async () => {
    membersOf({ name: "台南", role: "member", others: [{ name: "ty", role: "admin" }] });

    await rows();
    expect(screen.queryByRole("button", { name: "ty 的角色" })).toBeNull();
    expect(screen.queryByRole("button", { name: "移除 ty" })).toBeNull();
  });

  it("offers no way to rename myself: Members go by their LINE or Google name", async () => {
    membersOf({ name: "台南" });

    expect((await rows())[0]).toHaveTextContent("小宇（你）");
    expect(screen.queryByLabelText("我在這個群組的暱稱")).toBeNull();
    expect(screen.queryByRole("button", { name: "儲存暱稱" })).toBeNull();
  });

  it("adds numbered Placeholder Members with one tap", async () => {
    const user = userEvent.setup();
    membersOf({ name: "台南", others: [{ name: "成員1" }] });

    await user.click(await screen.findByRole("button", { name: "新增成員" }));
    await waitFor(async () => expect((await rows())[2]).toHaveTextContent("成員2（未加入）"));

    await user.click(screen.getByRole("button", { name: "新增成員" }));
    await waitFor(async () => expect((await rows())[3]).toHaveTextContent("成員3（未加入）"));
  });
});
