import { DELETED_USER_NAME } from "@split/shared";
import { ApiError } from "./errors.js";

type AccountMember = {
  id: string;
  user_id: string | null;
  status: string;
  role: string;
  net_balance: number;
};

export function ensureFreezeTable(sql: SqlStorage): void {
  sql.exec(
    "CREATE TABLE IF NOT EXISTS account_freezes (user_id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)",
  );
}

export function isFrozen(sql: SqlStorage, userId: string, now: number): boolean {
  ensureFreezeTable(sql);
  return (
    sql
      .exec("SELECT user_id FROM account_freezes WHERE user_id = ? AND expires_at > ?", userId, now)
      .toArray().length > 0
  );
}

export function freezeAccount(sql: SqlStorage, userId: string, expires: number) {
  const exists =
    sql
      .exec("SELECT name FROM sqlite_master WHERE type='table' AND name='ledger_members'")
      .toArray().length > 0;
  if (!exists) return { member: false, balance: 0, lastAdmin: false };
  ensureFreezeTable(sql);
  sql.exec(
    "INSERT INTO account_freezes(user_id,expires_at) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET expires_at=excluded.expires_at WHERE account_freezes.expires_at <= excluded.expires_at",
    userId,
    expires,
  );
  const rows = sql
    .exec<AccountMember>(
      "SELECT id,user_id,status,role,net_balance FROM ledger_members WHERE status='active'",
    )
    .toArray();
  const member = rows.find((row) => row.user_id === userId);
  if (member === undefined) return { member: false, balance: 0, lastAdmin: false };
  const others = rows.filter((row) => row.id !== member.id);
  return {
    member: true,
    balance: member.net_balance,
    lastAdmin:
      member.role === "admin" && others.length > 0 && !others.some((row) => row.role === "admin"),
  };
}

export function finalizeAccount(
  sql: SqlStorage,
  userId: string,
  now: number,
  expires: number,
): boolean {
  if (
    sql
      .exec("SELECT name FROM sqlite_master WHERE type='table' AND name='ledger_members'")
      .toArray().length === 0
  )
    return false;
  const rows = sql
    .exec<AccountMember>(
      "SELECT id,user_id,status,role,net_balance FROM ledger_members WHERE status='active'",
    )
    .toArray();
  const member = rows.find((row) => row.user_id === userId);
  if (member === undefined) return false;
  const owned =
    sql
      .exec(
        "SELECT user_id FROM account_freezes WHERE user_id=? AND expires_at=? AND expires_at>?",
        userId,
        expires,
        now,
      )
      .toArray().length > 0;
  if (!owned || member.net_balance !== 0) throw new ApiError("FORBIDDEN");
  if (
    member.role === "admin" &&
    rows.length > 1 &&
    !rows.some((row) => row.id !== member.id && row.role === "admin")
  )
    throw new ApiError("LAST_ADMIN");
  if (rows.length === 1) sql.exec("UPDATE ledger_group SET deleted=1 WHERE deleted=0");
  else
    sql.exec(
      "UPDATE ledger_members SET status='former', user_id=NULL, nickname=? WHERE id=?",
      DELETED_USER_NAME,
      member.id,
    );
  sql.exec("UPDATE ledger_meta SET rev=rev+1");
  sql.exec(
    "INSERT INTO ledger_dirty(kind,rev) SELECT 'group',rev FROM ledger_meta WHERE true ON CONFLICT(kind) DO UPDATE SET rev=excluded.rev",
  );
  return true;
}

/** Capture authoritative balances while a deletion is being checked. */
export function frozenBalances(sql: SqlStorage, now: number): Map<string, number> {
  ensureFreezeTable(sql);
  const rows = sql
    .exec<{ id: string; net_balance: number }>(
      `SELECT m.id,m.net_balance FROM ledger_members m JOIN account_freezes f ON f.user_id=m.user_id
     WHERE m.status='active' AND f.expires_at>?`,
      now,
    )
    .toArray();
  return new Map(rows.map((row) => [row.id, row.net_balance]));
}

export function assertFrozenBalancesUnchanged(sql: SqlStorage, before: Map<string, number>): void {
  for (const [id, balance] of before) {
    const current = sql
      .exec<{ net_balance: number }>("SELECT net_balance FROM ledger_members WHERE id=?", id)
      .one();
    if (current.net_balance !== balance) throw new ApiError("FORBIDDEN");
  }
}
