import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { SplitEditor } from "./SplitEditor.js";
import { newSplitDraft, type SplitDraft } from "./split-draft.js";

const members = [
  { id: "m-1", displayName: "ty" },
  { id: "m-2", displayName: "Yizhen" },
  { id: "m-3", displayName: "Gulu" },
];

function Harness({ amountMinor }: { amountMinor: number | null }) {
  const [draft, setDraft] = useState<SplitDraft>(() => newSplitDraft(members.map((m) => m.id)));
  return (
    <SplitEditor
      members={members}
      amountMinor={amountMinor}
      currency="TWD"
      payerIds={["m-1"]}
      value={draft}
      onChange={setDraft}
    />
  );
}

const row = (name: string) => within(screen.getByRole("listitem", { name }));

describe("split editor", () => {
  it("splits equally among everyone by default, the payer taking the leftover", () => {
    render(<Harness amountMinor={100} />);

    expect(screen.getByText("已勾選 3 / 3 人")).toBeVisible();
    expect(row("ty").getByText("NT$ 34")).toBeVisible();
    expect(row("Yizhen").getByText("NT$ 33")).toBeVisible();
    expect(row("Gulu").getByText("NT$ 33")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("金額已分配完畢");
  });

  it("leaves an unchecked Member out and 全選 brings everyone back", async () => {
    const user = userEvent.setup();
    render(<Harness amountMinor={100} />);

    await user.click(row("Gulu").getByRole("checkbox"));
    expect(screen.getByText("已勾選 2 / 3 人")).toBeVisible();
    expect(row("ty").getByText("NT$ 50")).toBeVisible();
    expect(row("Gulu").getByText("不參與")).toBeVisible();

    await user.click(row("ty").getByRole("checkbox"));
    await user.click(row("Yizhen").getByRole("checkbox"));
    expect(screen.getByRole("status")).toHaveTextContent("至少要有一人分攤");

    await user.click(screen.getByRole("button", { name: "全選" }));
    expect(screen.getByText("已勾選 3 / 3 人")).toBeVisible();
  });

  it("shows the remaining amount while exact amounts do not add up", async () => {
    const user = userEvent.setup();
    render(<Harness amountMinor={100} />);

    await user.click(screen.getByRole("radio", { name: /實際金額/ }));
    expect(screen.getByRole("status")).toHaveTextContent("還差 NT$ 100");
    await user.type(row("ty").getByLabelText("ty 的金額"), "60");
    await user.type(row("Yizhen").getByLabelText("Yizhen 的金額"), "50");
    expect(screen.getByRole("status")).toHaveTextContent("超過 NT$ 10");
    await user.clear(row("Yizhen").getByLabelText("Yizhen 的金額"));
    await user.type(row("Yizhen").getByLabelText("Yizhen 的金額"), "30");
    await user.type(row("Gulu").getByLabelText("Gulu 的金額"), "10");
    expect(screen.getByRole("status")).toHaveTextContent("金額已分配完畢");
  });

  it("divides by Shares", async () => {
    const user = userEvent.setup();
    render(<Harness amountMinor={100} />);

    await user.click(screen.getByRole("radio", { name: /份數/ }));
    const shares = row("ty").getByLabelText("ty 的份數");
    await user.clear(shares);
    await user.type(shares, "2");
    expect(row("ty").getByText("NT$ 50")).toBeVisible();
    expect(row("Gulu").getByText("NT$ 25")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("金額已分配完畢");

    await user.clear(shares);
    await user.type(shares, "120");
    expect(screen.getByRole("status")).toHaveTextContent("份數需介於 1 到 99");
  });

  it("waits for an amount before showing what each Member owes", () => {
    render(<Harness amountMinor={null} />);

    expect(row("ty").queryByText(/NT\$/)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("先輸入金額");
  });
});
