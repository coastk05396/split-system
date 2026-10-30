import { type CurrencyCode, minorToDecimal } from "@split/shared";
import { localName } from "../i18n/format.js";
import { categoryLabel } from "../expenses/categories.js";
import { type MessageId, t } from "../i18n/messages.js";

/**
 * The per-Group "匯出 CSV" (decision 26): built in the browser from data the Group page
 * has already loaded, so the Worker does no extra work. Amounts are integer minor units
 * in, plain decimals out ("12.50", no symbol or grouping) so spreadsheets read numbers.
 */

export interface CsvMember {
  id: string;
  /** What the Group shows: the LINE or Google name, a placeholder name, or "已刪除的使用者". */
  name: string;
}

export interface CsvLine {
  memberId: string;
  /** Minor units of the Settlement currency. */
  settlementAmount: number;
}

export interface CsvExpense {
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm, or null when the Expense has no time. */
  time: string | null;
  description: string;
  category: string;
  /** Minor units of the Expense currency. */
  originalAmount: number;
  originalCurrency: CurrencyCode;
  /** FX rate x 1,000,000, as stored. */
  fxRateScaled: number;
  /** Minor units of the Settlement currency. */
  settlementAmount: number;
  payers: CsvLine[];
  splits: CsvLine[];
}

export type CsvSettlementStatus = "pending" | "confirmed" | "cancelled" | "undone";

export interface CsvSettlement {
  /** YYYY-MM-DD in the viewer's time zone (confirmed day, else created day). */
  date: string;
  payerMemberId: string;
  receiverMemberId: string;
  /** Minor units of the Settlement currency. */
  amount: number;
  status: CsvSettlementStatus;
}

export interface GroupCsvInput {
  settlementCurrency: CurrencyCode;
  members: CsvMember[];
  expenses: CsvExpense[];
  settlements: CsvSettlement[];
}

/** The header row, in the app's language. */
const header = (): string[] => [
  t("csv.type"),
  t("csv.date"),
  t("csv.time"),
  t("csv.description"),
  t("csv.category"),
  t("csv.originalAmount"),
  t("csv.originalCurrency"),
  t("csv.rate"),
  t("csv.settlementAmount"),
  t("csv.settlementCurrency"),
  t("csv.payers"),
  t("csv.split"),
  t("csv.status"),
];

const STATUS_LABEL: Record<CsvSettlementStatus, MessageId> = {
  pending: "settle.status.pending",
  confirmed: "settle.status.confirmed",
  cancelled: "settle.status.cancelled",
  undone: "settle.status.undone",
};

const RATE_SCALE = 1_000_000;

/** Builds the CSV text, BOM first so Excel reads UTF-8. */
export function groupCsv(input: GroupCsvInput): string {
  const { settlementCurrency } = input;
  const names = new Map(input.members.map((member) => [member.id, localName(member.name)]));
  const nameOf = (id: string) => names.get(id) ?? t("marker.unknownMember");
  const amount = (minor: number) => minorToDecimal(minor, settlementCurrency);
  const lines = (list: CsvLine[]) =>
    list.map((line) => `${nameOf(line.memberId)} ${amount(line.settlementAmount)}`).join("; ");

  const dated: { date: string; time: string; cells: string[] }[] = [
    ...input.expenses.map((expense) => ({
      date: expense.date,
      time: expense.time ?? "",
      cells: [
        t("csv.expense"),
        expense.date,
        expense.time ?? "",
        expense.description,
        categoryLabel(expense.category),
        minorToDecimal(expense.originalAmount, expense.originalCurrency),
        expense.originalCurrency,
        rate(expense.fxRateScaled),
        amount(expense.settlementAmount),
        settlementCurrency,
        lines(expense.payers),
        lines(expense.splits),
        "",
      ],
    })),
    ...input.settlements.map((settlement) => {
      const payer = nameOf(settlement.payerMemberId);
      const receiver = nameOf(settlement.receiverMemberId);
      const value = amount(settlement.amount);
      return {
        date: settlement.date,
        time: "",
        cells: [
          t("csv.settlement"),
          settlement.date,
          "",
          t("csv.pays", { payer, receiver }),
          "",
          value,
          settlementCurrency,
          "1",
          value,
          settlementCurrency,
          `${payer} ${value}`,
          `${receiver} ${value}`,
          t(STATUS_LABEL[settlement.status]),
        ],
      };
    }),
  ];
  // Stable sort: same-day rows keep Expenses before Settlements, each in the given order.
  dated.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  const body = [header(), ...dated.map((row) => row.cells)]
    .map((cells) => cells.map(cell).join(","))
    .join("\r\n");
  return `\uFEFF${body}\r\n`;
}

/** "<app name>-<Group name>-<day>.csv" with characters file systems reject replaced. */
export function groupCsvFilename(groupName: string, day: string): string {
  const safe = groupName
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${t("app.name")}-${safe}-${day}.csv`;
}

function rate(scaled: number): string {
  const whole = Math.floor(scaled / RATE_SCALE);
  const fraction = String(scaled % RATE_SCALE)
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction === "" ? String(whole) : `${whole}.${fraction}`;
}

/**
 * One CSV cell: text starting with a formula character gets a leading apostrophe so a
 * spreadsheet shows it instead of running it; quotes, commas and line breaks are quoted.
 */
function cell(value: string): string {
  const defused = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(defused) ? `"${defused.replace(/"/g, '""')}"` : defused;
}
