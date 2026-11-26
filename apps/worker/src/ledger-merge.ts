import {
  expenseSchema,
  settlementSchema,
  type Expense,
  type MemberRole,
  type MemberStatus,
  type Settlement,
} from "@split/shared";

interface MergeMemberRow extends Record<string, SqlStorageValue> {
  id: string;
  user_id: string | null;
  role: MemberRole;
  status: MemberStatus;
  net_balance: number;
}

export interface MergeLedgerOutcome {
  changed: boolean;
  dirty?: string[] | undefined;
  leaving?: string | undefined;
}

function mergePayers(
  payers: Expense["payers"],
  keptId: string,
  otherId: string,
): Expense["payers"] {
  const hasKept = payers.some((p) => p.memberId === keptId);
  const otherPayer = payers.find((p) => p.memberId === otherId);
  if (otherPayer === undefined) return payers;
  if (!hasKept) {
    return payers.map((p) => (p.memberId === otherId ? { ...p, memberId: keptId } : p));
  }
  return payers.flatMap((p) => {
    if (p.memberId === otherId) return [];
    if (p.memberId === keptId) {
      return [
        {
          memberId: keptId,
          amountMinor: p.amountMinor + otherPayer.amountMinor,
          settlementAmount: p.settlementAmount + otherPayer.settlementAmount,
        },
      ];
    }
    return [p];
  });
}

function mergeSplits(
  splitMethod: Expense["splitMethod"],
  splits: Expense["splits"],
  keptId: string,
  otherId: string,
): { splitMethod: Expense["splitMethod"]; splits: Expense["splits"] } {
  const hasKept = splits.some((s) => s.memberId === keptId);
  const otherSplit = splits.find((s) => s.memberId === otherId);
  if (otherSplit === undefined) return { splitMethod, splits };
  if (!hasKept) {
    return {
      splitMethod,
      splits: splits.map((s) => (s.memberId === otherId ? { ...s, memberId: keptId } : s)),
    };
  }
  return {
    splitMethod: "exact",
    splits: splits.flatMap((s) => {
      if (s.memberId === otherId) return [];
      if (s.memberId === keptId) {
        return [
          {
            memberId: keptId,
            shares: null,
            amountMinor: s.amountMinor + otherSplit.amountMinor,
            settlementAmount: s.settlementAmount + otherSplit.settlementAmount,
          },
        ];
      }
      return [{ ...s, shares: null }];
    }),
  };
}

function repointMemberId(id: string | null, keptId: string, otherId: string): string | null {
  return id === otherId ? keptId : id;
}

function mergeSettlements(sql: SqlStorage, keptId: string, otherId: string): void {
  const rows = sql
    .exec<{ id: string; data: string }>("SELECT id, data FROM ledger_settlements")
    .toArray();
  for (const row of rows) {
    const settlement = settlementSchema.parse(JSON.parse(row.data) as unknown);
    const betweenBoth =
      (settlement.payerMemberId === keptId && settlement.receiverMemberId === otherId) ||
      (settlement.payerMemberId === otherId && settlement.receiverMemberId === keptId);
    if (betweenBoth) {
      sql.exec("DELETE FROM ledger_settlements WHERE id=?", row.id);
      continue;
    }
    const next: Settlement = {
      ...settlement,
      payerMemberId: settlement.payerMemberId === otherId ? keptId : settlement.payerMemberId,
      receiverMemberId:
        settlement.receiverMemberId === otherId ? keptId : settlement.receiverMemberId,
      createdByMemberId: repointMemberId(settlement.createdByMemberId, keptId, otherId),
      confirmedByMemberId: repointMemberId(settlement.confirmedByMemberId, keptId, otherId),
      undoneByMemberId: repointMemberId(settlement.undoneByMemberId, keptId, otherId),
    };
    if (
      next.payerMemberId !== settlement.payerMemberId ||
      next.receiverMemberId !== settlement.receiverMemberId ||
      next.createdByMemberId !== settlement.createdByMemberId ||
      next.confirmedByMemberId !== settlement.confirmedByMemberId ||
      next.undoneByMemberId !== settlement.undoneByMemberId
    ) {
      sql.exec("UPDATE ledger_settlements SET data=? WHERE id=?", JSON.stringify(next), row.id);
    }
  }
}

interface MergeExpenseRow extends Record<string, SqlStorageValue> {
  id: string;
  creator_member_id: string;
  idempotency_key: string;
  data: string;
  deleted: number;
}

function nextUniqueKey(usedKeys: Set<string>, baseKey: string, expenseId: string): string {
  if (!usedKeys.has(baseKey)) {
    usedKeys.add(baseKey);
    return baseKey;
  }
  let candidate = `${baseKey}:merged:${expenseId}`;
  let suffix = 1;
  while (usedKeys.has(candidate)) {
    candidate = `${baseKey}:merged:${expenseId}:${String(suffix)}`;
    suffix += 1;
  }
  usedKeys.add(candidate);
  return candidate;
}

function mergeExpenses(
  sql: SqlStorage,
  keptId: string,
  otherId: string,
  reactivatedKept: boolean,
): string[] {
  const usedKeys = new Set(
    sql
      .exec<{ idempotency_key: string }>(
        "SELECT idempotency_key FROM ledger_expenses WHERE creator_member_id=?",
        keptId,
      )
      .toArray()
      .map((r) => r.idempotency_key),
  );
  const dirty: string[] = [];
  const rows = sql
    .exec<MergeExpenseRow>(
      "SELECT id, creator_member_id, idempotency_key, data, deleted FROM ledger_expenses",
    )
    .toArray();
  for (const row of rows) {
    if (row.deleted !== 0) {
      if (row.creator_member_id === otherId) {
        const key = nextUniqueKey(usedKeys, row.idempotency_key, row.id);
        sql.exec(
          "UPDATE ledger_expenses SET creator_member_id=?, idempotency_key=? WHERE id=?",
          keptId,
          key,
          row.id,
        );
      }
      continue;
    }
    const expense = expenseSchema.parse(JSON.parse(row.data) as unknown);
    const touchesOther =
      row.creator_member_id === otherId ||
      expense.creatorMemberId === otherId ||
      expense.payers.some((p) => p.memberId === otherId) ||
      expense.splits.some((s) => s.memberId === otherId);
    if (!touchesOther) {
      // A reactivated Member's own historical splits were absent from D1 personal_spending while former.
      if (reactivatedKept && expense.splits.some((s) => s.memberId === keptId)) {
        dirty.push(`expense:${row.id}`);
      }
      continue;
    }

    const mergedSplits = mergeSplits(expense.splitMethod, expense.splits, keptId, otherId);
    const next: Expense = {
      ...expense,
      creatorMemberId: expense.creatorMemberId === otherId ? keptId : expense.creatorMemberId,
      splitMethod: mergedSplits.splitMethod,
      payers: mergePayers(expense.payers, keptId, otherId),
      splits: mergedSplits.splits,
    };
    const creatorMemberId = row.creator_member_id === otherId ? keptId : row.creator_member_id;
    const idempotencyKey =
      row.creator_member_id === otherId
        ? nextUniqueKey(usedKeys, row.idempotency_key, row.id)
        : row.idempotency_key;
    sql.exec(
      "UPDATE ledger_expenses SET creator_member_id=?, idempotency_key=?, data=? WHERE id=?",
      creatorMemberId,
      idempotencyKey,
      JSON.stringify(next),
      row.id,
    );
    dirty.push(`expense:${row.id}`);
  }
  return dirty;
}

/**
 * Folds `otherUserId` into `keptUserId` within a single Group's ledger (ADR 0017).
 * When only `otherUserId` is seated, its Member row is repointed; when both are seated,
 * the kept Member absorbs `other`'s balance, payer/split lines, and history.
 */
export function mergeLedgerUser(
  sql: SqlStorage,
  keptUserId: string,
  otherUserId: string,
): MergeLedgerOutcome {
  const otherRows = sql
    .exec<MergeMemberRow>(
      "SELECT id, user_id, role, status, net_balance FROM ledger_members WHERE user_id=?",
      otherUserId,
    )
    .toArray();
  if (otherRows.length === 0) return { changed: false };
  const other = otherRows[0];
  if (other === undefined) return { changed: false };

  const keptRows = sql
    .exec<MergeMemberRow>(
      "SELECT id, user_id, role, status, net_balance FROM ledger_members WHERE user_id=?",
      keptUserId,
    )
    .toArray();
  if (keptRows.length === 0) {
    sql.exec("UPDATE ledger_members SET user_id=? WHERE user_id=?", keptUserId, otherUserId);
    return { changed: true, dirty: ["group"], leaving: otherUserId };
  }
  const kept = keptRows[0];
  if (kept === undefined) return { changed: false };

  const mergedRole: MemberRole =
    kept.role === "admin" || other.role === "admin" ? "admin" : "member";
  const mergedStatus: MemberStatus =
    kept.status === "active" || other.status === "active" ? "active" : kept.status;
  const reactivatedKept = kept.status !== "active" && mergedStatus === "active";

  sql.exec(
    "UPDATE ledger_members SET role=?, status=?, net_balance=? WHERE id=?",
    mergedRole,
    mergedStatus,
    kept.net_balance + other.net_balance,
    kept.id,
  );
  sql.exec(
    "UPDATE ledger_members SET created_by_member_id=? WHERE created_by_member_id=?",
    kept.id,
    other.id,
  );
  sql.exec("DELETE FROM ledger_members WHERE id=?", other.id);

  const dirty = mergeExpenses(sql, kept.id, other.id, reactivatedKept);
  mergeSettlements(sql, kept.id, other.id);
  dirty.push("group");
  return { changed: true, dirty, leaving: otherUserId };
}
