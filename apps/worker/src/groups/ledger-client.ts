import type { Bindings } from "../env.js";
import { ApiError, ERROR_STATUS, type ErrorCode } from "../errors.js";

export interface MemberOperation {
  action: "add" | "patch" | "remove" | "leave" | "join" | "claim";
  actorMemberId?: string;
  targetMemberId?: string;
  userId?: string;
  input?: object;
  now: number;
  names?: Record<string, string>;
  targetBalance?: number;
  currency?: string | null;
  hasHistory?: boolean;
}

export async function memberOperation(
  env: Bindings,
  groupId: string,
  operation: MemberOperation,
): Promise<{ memberId: string; rev: number }> {
  const id = env.GROUP_LEDGER.idFromName(groupId);
  const response = await env.GROUP_LEDGER.get(id).fetch("https://ledger.internal/member-op", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(operation),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    if (
      typeof result === "object" &&
      result !== null &&
      "error" in result &&
      typeof result.error === "string" &&
      Object.hasOwn(ERROR_STATUS, result.error)
    ) {
      throw new ApiError(
        result.error as ErrorCode,
        "details" in result ? result.details : undefined,
      );
    }
    throw new ApiError("INTERNAL");
  }
  if (
    typeof result !== "object" ||
    result === null ||
    !("memberId" in result) ||
    typeof result.memberId !== "string" ||
    !("rev" in result) ||
    typeof result.rev !== "number"
  )
    throw new ApiError("INTERNAL");
  return { memberId: result.memberId, rev: result.rev };
}
