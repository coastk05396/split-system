import {
  type CurrencyCode,
  type ExpenseInput,
  MAX_SHARES,
  MIN_SHARES,
  parseAmount,
  type SplitLine,
  type SplitMethod,
  splitEqual,
  splitShares,
} from "@split/shared";
import { minorToText } from "./money.js";

/**
 * What the split editor holds while someone types (decision 23, screens 15, 17, 30 as
 * amended): who takes part, the Split method, and the typed exact amounts and Shares.
 */
export interface SplitDraft {
  method: SplitMethod;
  /** Members taking part, whatever the method. */
  included: readonly string[];
  /** Typed exact amounts in the Expense currency, by Member. */
  exact: Readonly<Record<string, string>>;
  /** Typed Shares, by Member; an untouched Member has 1. */
  shares: Readonly<Record<string, string>>;
}

export type SplitInput = ExpenseInput["split"];

export type SplitStatus =
  | { kind: "needAmount" }
  | { kind: "noParticipants" }
  | { kind: "amountInvalid" }
  | { kind: "sharesInvalid" }
  | { kind: "remaining"; amountMinor: number }
  | { kind: "over"; amountMinor: number }
  | { kind: "balanced" };

export interface SplitEvaluation {
  /** Each taking-part Member's amount in the Expense currency, once it can be worked out. */
  amounts: ReadonlyMap<string, number>;
  status: SplitStatus;
  /** The request's `split`, only when the split balances. */
  input: SplitInput | null;
}

/** Everyone takes part, equally: the default (decision 23). */
export function newSplitDraft(memberIds: readonly string[]): SplitDraft {
  return { method: "equal", included: [...memberIds], exact: {}, shares: {} };
}

/** A draft that reproduces a saved Expense's split, for editing. */
export function splitDraftFrom(
  method: SplitMethod,
  lines: readonly { memberId: string; shares: number | null; amountMinor: number }[],
  currency: CurrencyCode,
): SplitDraft {
  return {
    method,
    included: lines.map((l) => l.memberId),
    exact: Object.fromEntries(lines.map((l) => [l.memberId, minorToText(l.amountMinor, currency)])),
    shares: Object.fromEntries(lines.map((l) => [l.memberId, String(l.shares ?? 1)])),
  };
}

const sharesOf = (draft: SplitDraft, memberId: string): string => draft.shares[memberId] ?? "1";

function parseShares(text: string): number | null {
  if (!/^\d{1,3}$/.test(text)) return null;
  const n = Number(text);
  return n >= MIN_SHARES && n <= MAX_SHARES ? n : null;
}

const toMap = (lines: readonly SplitLine[]) =>
  new Map(lines.map((l) => [l.memberId, l.amountMinor]));

/**
 * Works out each Member's amount with the shared leftover rule and whether the split balances.
 * `memberOrder` is the Group's fixed Member order; `payerIds` take leftover units first.
 */
export function evaluateSplit(
  draft: SplitDraft,
  amountMinor: number | null,
  currency: CurrencyCode,
  memberOrder: readonly string[],
  payerIds: readonly string[],
): SplitEvaluation {
  const none = new Map<string, number>();
  const included = memberOrder.filter((id) => draft.included.includes(id));
  if (included.length === 0)
    return { amounts: none, status: { kind: "noParticipants" }, input: null };

  if (draft.method === "exact") {
    const lines: SplitLine[] = [];
    for (const memberId of included) {
      const text = draft.exact[memberId] ?? "";
      const parsed = text === "" ? { ok: true as const, value: 0 } : parseAmount(text, currency);
      if (!parsed.ok) return { amounts: none, status: { kind: "amountInvalid" }, input: null };
      lines.push({ memberId, amountMinor: parsed.value });
    }
    const amounts = toMap(lines);
    if (amountMinor === null) return { amounts, status: { kind: "needAmount" }, input: null };
    const sum = lines.reduce((s, l) => s + l.amountMinor, 0);
    if (sum < amountMinor) {
      return {
        amounts,
        status: { kind: "remaining", amountMinor: amountMinor - sum },
        input: null,
      };
    }
    if (sum > amountMinor) {
      return { amounts, status: { kind: "over", amountMinor: sum - amountMinor }, input: null };
    }
    return { amounts, status: { kind: "balanced" }, input: { method: "exact", lines } };
  }

  if (draft.method === "shares") {
    const weights: { memberId: string; shares: number }[] = [];
    for (const memberId of included) {
      const shares = parseShares(sharesOf(draft, memberId));
      if (shares === null) return { amounts: none, status: { kind: "sharesInvalid" }, input: null };
      weights.push({ memberId, shares });
    }
    if (amountMinor === null) return { amounts: none, status: { kind: "needAmount" }, input: null };
    const lines = splitShares(amountMinor, weights, payerIds);
    if (!lines.ok) return { amounts: none, status: { kind: "amountInvalid" }, input: null };
    return {
      amounts: toMap(lines.value),
      status: { kind: "balanced" },
      input: { method: "shares", lines: weights },
    };
  }

  if (amountMinor === null) return { amounts: none, status: { kind: "needAmount" }, input: null };
  const lines = splitEqual(amountMinor, included, payerIds);
  if (!lines.ok) return { amounts: none, status: { kind: "amountInvalid" }, input: null };
  return {
    amounts: toMap(lines.value),
    status: { kind: "balanced" },
    input: { method: "equal", participants: included },
  };
}
