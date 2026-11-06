import { z } from "zod";
import { MAX_MEMBER_PREVIEW } from "./labels.js";
import {
  currencyCodeSchema,
  daysBetween,
  idSchema,
  localDateSchema,
  MAX_NAME_LENGTH,
  MAX_NOTES_LENGTH,
  tripDatesValid,
  tripLength,
} from "./schemas.js";

/** Groups, Members, Invites and Placeholder Members (SPEC §5, decisions 10, 13, 31). */

export { daysBetween, MAX_MEMBER_PREVIEW, tripDatesValid, tripLength };

/** Active Groups one User may belong to; placeholders do not count (decisions 15, 31). */
export const MAX_GROUPS_PER_USER = 20;
/** An Invite link stays valid this long after it is made or regenerated. */
export const INVITE_TTL_MS = 12 * 3600 * 1000;

export const MEMBER_ROLES = ["admin", "member"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
export const MEMBER_STATUSES = ["active", "former", "placeholder"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

/**
 * Who may remove or leave as `target`: the Member themselves, an Admin, or any Member removing
 * an unclaimed Placeholder Member. Former Members cannot be removed again.
 */
export function canRemoveMember(
  actor: { id: string; role: MemberRole },
  target: { id: string; status: MemberStatus },
): boolean {
  return (
    target.status !== "former" &&
    (target.id === actor.id || actor.role === "admin" || target.status === "placeholder")
  );
}

/** Only an unclaimed Placeholder Member's typed name may be edited in the Group. */
export function canEditPlaceholderName(target: { status: MemberStatus }): boolean {
  return target.status === "placeholder";
}

/** An Admin may promote or demote another active Member. */
export function canChangeMemberRole(
  actor: { id: string; role: MemberRole },
  target: { id: string; status: MemberStatus },
): boolean {
  return actor.role === "admin" && actor.id !== target.id && target.status === "active";
}

/** True when `targetId` is the Group's only active Admin. */
export function isLastAdmin(
  members: ReadonlyArray<{ id: string; role: MemberRole; status: MemberStatus }>,
  targetId: string,
): boolean {
  const target = members.find((m) => m.id === targetId);
  if (target?.status !== "active" || target.role !== "admin") return false;
  return !members.some((m) => m.id !== targetId && m.status === "active" && m.role === "admin");
}

/** The lowest numbered default Placeholder Member name ("成員1", "成員2", …) not yet in `existingNames`. */
export function nextPlaceholderName(existingNames: Iterable<string>): string {
  const taken = new Set(existingNames);
  let number = 1;
  while (taken.has(`成員${String(number)}`)) number += 1;
  return `成員${String(number)}`;
}

/**
 * How a removed or leaving Member is persisted:
 * - `"delete"`: an unclaimed Placeholder Member with no Expense history is deleted outright.
 * - `"former_placeholder"`: a Placeholder Member with Expense history becomes a Former Member (`已移除的成員`).
 * - `"former_member"`: a seated Member becomes a Former Member with their own name kept.
 */
export function memberRemovalDisposition(
  target: { status: MemberStatus },
  hasExpenseHistory: boolean,
): "delete" | "former_placeholder" | "former_member" {
  if (target.status === "placeholder") {
    return hasExpenseHistory ? "former_placeholder" : "delete";
  }
  return "former_member";
}

const nameSchema = z.string().trim().min(1).max(MAX_NAME_LENGTH);

/**
 * `PATCH /groups/:id` (Admin only, with `If-Match: <updatedAt>`). Absent fields stay; null
 * clears a Trip field. Trip dates are checked against the stored ones by the Worker.
 */
export const groupPatchSchema = z
  .object({
    name: nameSchema,
    settlementCurrency: currencyCodeSchema,
    isTrip: z.boolean(),
    tripDestination: nameSchema.nullable(),
    tripStartDate: localDateSchema.nullable(),
    tripEndDate: localDateSchema.nullable(),
    tripNotes: z.string().max(MAX_NOTES_LENGTH).nullable(),
  })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "PATCH_EMPTY");
export type GroupPatch = z.infer<typeof groupPatchSchema>;

/** A Group as one of its Members sees it, with that Member's own place in it. */
export const groupSchema = z.object({
  id: z.string(),
  name: z.string(),
  settlementCurrency: currencyCodeSchema,
  isTrip: z.boolean(),
  tripDestination: z.string().nullable(),
  tripStartDate: z.string().nullable(),
  tripEndDate: z.string().nullable(),
  tripNotes: z.string().nullable(),
  /** True once the Group has an Expense: the Settlement currency can no longer change. */
  settlementCurrencyLocked: z.boolean(),
  /** Active Members plus Placeholder Members, the count the 30-Member cap applies to. */
  memberCount: z.number().int(),
  /** The first few seated Members, for the overlapping avatars on a Group's card. */
  memberPreview: z.array(z.object({ name: z.string(), pictureUrl: z.string().nullable() })),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  me: z.object({
    memberId: z.string(),
    role: z.enum(MEMBER_ROLES),
    balance: z.number().int(),
  }),
});
export type Group = z.infer<typeof groupSchema>;

export const memberSchema = z.object({
  id: z.string(),
  /** Null for a Placeholder Member and for a Former Member whose account was deleted. */
  userId: z.string().nullable(),
  /** The User's LINE or Google name, else the Placeholder Member's typed name. */
  displayName: z.string(),
  pictureUrl: z.string().nullable(),
  role: z.enum(MEMBER_ROLES),
  status: z.enum(MEMBER_STATUSES),
  /** In the Group's Settlement currency. */
  balance: z.number().int(),
  isMe: z.boolean(),
});
export type Member = z.infer<typeof memberSchema>;

/** `PATCH /groups/:id/members/:mid`: an Admin sets the role, or a Member renames a Placeholder Member. */
export const memberPatchSchema = z
  .object({ role: z.enum(MEMBER_ROLES).optional(), placeholderName: nameSchema.optional() })
  .partial()
  .strict()
  .refine(
    (patch) => (patch.role === undefined) !== (patch.placeholderName === undefined),
    "PATCH_INVALID",
  );
export type MemberPatch = z.infer<typeof memberPatchSchema>;

/** `POST /groups/:id/members`: any Member adds a Placeholder Member by name. */
export const placeholderInputSchema = z.object({ name: nameSchema });
export type PlaceholderInput = z.infer<typeof placeholderInputSchema>;

/** `POST /invites/:token/claim`: join by taking over one Placeholder Member. */
export const claimInputSchema = z.object({ memberId: idSchema });
export type ClaimInput = z.infer<typeof claimInputSchema>;

/** The Group's one live Invite link. */
export const inviteSchema = z.object({ token: z.string(), expiresAt: z.number().int() });
export type Invite = z.infer<typeof inviteSchema>;

/** `GET /invites/:token`: what the join screen shows before the person joins. */
export const invitePreviewSchema = z.object({
  groupId: z.string(),
  groupName: z.string(),
  settlementCurrency: currencyCodeSchema,
  memberCount: z.number().int(),
  expiresAt: z.number().int(),
  /** True when the signed-in person is already a Member: the app just opens the Group. */
  isMember: z.boolean(),
  /** Unclaimed Placeholder Members the person may say they are ("你是這些人之一嗎？"). */
  placeholders: z.array(
    z.object({
      memberId: z.string(),
      name: z.string(),
      /** Who typed the name: the notice rule for data not given by the person. */
      addedBy: z.string().nullable(),
      balance: z.number().int(),
      expenseCount: z.number().int(),
    }),
  ),
});
export type InvitePreview = z.infer<typeof invitePreviewSchema>;

/** Join and claim answer: the Group to open and the person's Member row in it. */
export const joinResultSchema = z.object({ groupId: z.string(), memberId: z.string() });
export type JoinResult = z.infer<typeof joinResultSchema>;
