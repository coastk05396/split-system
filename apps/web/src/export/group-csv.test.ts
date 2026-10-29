import { describe, expect, it } from "vitest";
import { type GroupCsvInput, groupCsv, groupCsvFilename } from "./group-csv.js";

const members = [
  { id: "m-yu", name: "小宇" },
  { id: "m-ya", name: "阿芽" },
  { id: "m-lin", name: '林, "Lin"' },
];

function rows(csv: string): string[] {
  return csv.replace(/^﻿/, "").split("\r\n");
}

const header = "類型,日期,時間,說明,類別,原幣金額,原幣幣別,匯率,結算金額,結算幣別,付款人,分攤,狀態";

describe("groupCsv", () => {
  it("writes a UTF-8 BOM, a zh-TW header and CRLF lines so Excel opens it", () => {
    const csv = groupCsv({ settlementCurrency: "TWD", members, expenses: [], settlements: [] });

    expect(csv.startsWith("﻿")).toBe(true);
    expect(rows(csv)).toEqual([header, ""]);
  });

  it("writes an Expense with its amounts in plain decimals, payers and split", () => {
    const input: GroupCsvInput = {
      settlementCurrency: "TWD",
      members,
      expenses: [
        {
          date: "2026-10-03",
          time: "19:30",
          description: "燒肉晚餐",
          category: "餐飲",
          originalAmount: 6_000,
          originalCurrency: "USD",
          fxRateScaled: 32_150_000,
          settlementAmount: 1_929,
          payers: [{ memberId: "m-yu", settlementAmount: 1_929 }],
          splits: [
            { memberId: "m-yu", settlementAmount: 643 },
            { memberId: "m-ya", settlementAmount: 643 },
            { memberId: "m-lin", settlementAmount: 643 },
          ],
        },
      ],
      settlements: [],
    };

    expect(rows(groupCsv(input))[1]).toBe(
      '支出,2026-10-03,19:30,燒肉晚餐,餐飲,60.00,USD,32.15,1929,TWD,小宇 1929,"小宇 643; 阿芽 643; 林, ""Lin"" 643",',
    );
  });

  it("writes Settlements with their status, ordered with Expenses by date", () => {
    const input: GroupCsvInput = {
      settlementCurrency: "USD",
      members,
      expenses: [
        {
          date: "2026-10-05",
          time: null,
          description: "車票",
          category: "交通",
          originalAmount: 1_250,
          originalCurrency: "USD",
          fxRateScaled: 1_000_000,
          settlementAmount: 1_250,
          payers: [{ memberId: "m-ya", settlementAmount: 1_250 }],
          splits: [{ memberId: "m-yu", settlementAmount: 1_250 }],
        },
      ],
      settlements: [
        {
          date: "2026-10-04",
          payerMemberId: "m-yu",
          receiverMemberId: "m-ya",
          amount: 505,
          status: "confirmed",
        },
        {
          date: "2026-10-06",
          payerMemberId: "m-yu",
          receiverMemberId: "m-ya",
          amount: 1_250,
          status: "pending",
        },
      ],
    };

    expect(rows(groupCsv(input)).slice(1, 4)).toEqual([
      "結算,2026-10-04,,小宇 付給 阿芽,,5.05,USD,1,5.05,USD,小宇 5.05,阿芽 5.05,已確認",
      "支出,2026-10-05,,車票,交通,12.50,USD,1,12.50,USD,阿芽 12.50,小宇 12.50,",
      "結算,2026-10-06,,小宇 付給 阿芽,,12.50,USD,1,12.50,USD,小宇 12.50,阿芽 12.50,待確認",
    ]);
  });

  it("defuses text a spreadsheet would run as a formula", () => {
    const csv = groupCsv({
      settlementCurrency: "TWD",
      members: [{ id: "m-x", name: "@evil" }],
      expenses: [
        {
          date: "2026-10-03",
          time: null,
          description: '=HYPERLINK("http://x","y")',
          category: "+其他",
          originalAmount: 100,
          originalCurrency: "TWD",
          fxRateScaled: 1_000_000,
          settlementAmount: 100,
          payers: [{ memberId: "m-x", settlementAmount: 100 }],
          splits: [{ memberId: "m-x", settlementAmount: 100 }],
        },
      ],
      settlements: [],
    });

    expect(rows(csv)[1]).toBe(
      '支出,2026-10-03,,"\'=HYPERLINK(""http://x"",""y"")",\'+其他,100,TWD,1,100,TWD,\'@evil 100,\'@evil 100,',
    );
  });

  it("names a Member it cannot find as 未知成員 rather than failing", () => {
    const csv = groupCsv({
      settlementCurrency: "TWD",
      members: [],
      expenses: [],
      settlements: [
        {
          date: "2026-10-04",
          payerMemberId: "gone",
          receiverMemberId: "gone",
          amount: 1,
          status: "undone",
        },
      ],
    });

    expect(rows(csv)[1]).toBe(
      "結算,2026-10-04,,未知成員 付給 未知成員,,1,TWD,1,1,TWD,未知成員 1,未知成員 1,已撤銷",
    );
  });
});

describe("groupCsvFilename", () => {
  it("names the file after the Group and day, without characters filesystems reject", () => {
    expect(groupCsvFilename('東京/大阪: "五天"', "2026-10-29")).toBe(
      "小芽分帳-東京-大阪-五天-2026-10-29.csv",
    );
  });
});
