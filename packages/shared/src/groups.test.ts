import { describe, expect, it } from "vitest";
import {
  canChangeMemberRole,
  canEditPlaceholderName,
  canRemoveMember,
  daysBetween,
  isLastAdmin,
  MAX_MEMBER_PREVIEW,
  memberRemovalDisposition,
  type MemberRole,
  type MemberStatus,
  nextPlaceholderName,
  tripDatesValid,
  tripLength,
} from "./groups.js";

describe("Trip day rules", () => {
  it("caps Member stack preview at 4", () => {
    expect(MAX_MEMBER_PREVIEW).toBe(4);
  });

  it("lists every calendar day between start and end inclusive, or empty when inverted", () => {
    expect(daysBetween("2026-06-13", "2026-06-13")).toEqual(["2026-06-13"]);
    expect(daysBetween("2026-06-29", "2026-07-02")).toEqual([
      "2026-06-29",
      "2026-06-30",
      "2026-07-01",
      "2026-07-02",
    ]);
    expect(daysBetween("2026-06-15", "2026-06-13")).toEqual([]);
  });

  it("counts inclusive Trip days and validates the 1..31 day range", () => {
    expect(tripLength("2026-07-01", "2026-07-01")).toBe(1);
    expect(tripLength("2026-07-01", "2026-07-31")).toBe(31);
    expect(tripLength("2026-07-01", "2026-08-01")).toBe(32);
    expect(tripDatesValid(null, "2026-07-31")).toBe(true);
    expect(tripDatesValid("2026-07-01", null)).toBe(true);
    expect(tripDatesValid("2026-07-01", "2026-07-31")).toBe(true);
    expect(tripDatesValid("2026-07-01", "2026-06-30")).toBe(false);
    expect(tripDatesValid("2026-07-01", "2026-08-01")).toBe(false);
  });
});

describe("Member and Placeholder Member rules", () => {
  it.each<{
    actor: { id: string; role: MemberRole };
    target: { id: string; status: MemberStatus };
    remove: boolean;
    editName: boolean;
    changeRole: boolean;
  }>([
    {
      actor: { id: "a", role: "admin" },
      target: { id: "a", status: "active" },
      remove: true,
      editName: false,
      changeRole: true,
    },
    {
      actor: { id: "a", role: "admin" },
      target: { id: "b", status: "active" },
      remove: true,
      editName: false,
      changeRole: true,
    },
    {
      actor: { id: "a", role: "admin" },
      target: { id: "p", status: "placeholder" },
      remove: true,
      editName: true,
      changeRole: false,
    },
    {
      actor: { id: "a", role: "admin" },
      target: { id: "f", status: "former" },
      remove: false,
      editName: false,
      changeRole: false,
    },
    {
      actor: { id: "m", role: "member" },
      target: { id: "m", status: "active" },
      remove: true,
      editName: false,
      changeRole: false,
    },
    {
      actor: { id: "m", role: "member" },
      target: { id: "b", status: "active" },
      remove: false,
      editName: false,
      changeRole: false,
    },
    {
      actor: { id: "m", role: "member" },
      target: { id: "p", status: "placeholder" },
      remove: true,
      editName: true,
      changeRole: false,
    },
    {
      actor: { id: "m", role: "member" },
      target: { id: "f", status: "former" },
      remove: false,
      editName: false,
      changeRole: false,
    },
  ])(
    "permissions for actor $actor.id ($actor.role) -> target $target.id ($target.status)",
    ({ actor, target, remove, editName, changeRole }) => {
      expect(canRemoveMember(actor, target)).toBe(remove);
      expect(canEditPlaceholderName(target)).toBe(editName);
      expect(canChangeMemberRole(actor, target)).toBe(changeRole);
      expect(canChangeMemberRole(actor, target, { allowSelf: false })).toBe(
        changeRole && actor.id !== target.id,
      );
    },
  );

  it("detects when an active Admin is the last Admin in the Group", () => {
    const soloAdmin = [
      { id: "a", role: "admin" as const, status: "active" as const },
      { id: "b", role: "member" as const, status: "active" as const },
      { id: "f", role: "admin" as const, status: "former" as const },
    ];
    expect(isLastAdmin(soloAdmin, "a")).toBe(true);
    expect(isLastAdmin(soloAdmin, "b")).toBe(false);
    expect(isLastAdmin(soloAdmin, "f")).toBe(false);

    const twoAdmins = [
      ...soloAdmin,
      { id: "c", role: "admin" as const, status: "active" as const },
    ];
    expect(isLastAdmin(twoAdmins, "a")).toBe(false);
    expect(isLastAdmin(twoAdmins, "c")).toBe(false);
  });

  it("picks the lowest unused numbered Placeholder Member name", () => {
    expect(nextPlaceholderName([])).toBe("成員1");
    expect(nextPlaceholderName(["小宇", "成員1", "成員3"])).toBe("成員2");
    expect(nextPlaceholderName(new Set(["成員1", "成員2"]))).toBe("成員3");
  });

  it("chooses delete vs Former Member disposition based on Placeholder status and Expense history", () => {
    expect(memberRemovalDisposition({ status: "placeholder" }, false)).toBe("delete");
    expect(memberRemovalDisposition({ status: "placeholder" }, true)).toBe("former_placeholder");
    expect(memberRemovalDisposition({ status: "active" }, false)).toBe("former_member");
    expect(memberRemovalDisposition({ status: "active" }, true)).toBe("former_member");
  });
});
