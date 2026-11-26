import { z } from "zod";
import { LANGUAGES } from "./labels.js";
import { currencyCodeSchema } from "./schemas.js";

/** Sign-in, session and account shapes shared by the Worker and the SPA. */

export const PROVIDERS = ["google", "line"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const providerSchema = z.enum(PROVIDERS);

/** Access tokens live for one hour; rotating refresh tokens are bounded by the 15-day session cap. */
export const ACCESS_TOKEN_TTL_SECONDS = 3600;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 3600;
/** A session ends this long after sign-in however often it rotates, so a stolen token cannot live on. */
export const SESSION_MAX_AGE_SECONDS = 15 * 24 * 3600;

/** `POST /auth/google`, `/auth/line` and `/auth/link/:provider`. */
export const idTokenRequestSchema = z.object({ idToken: z.string().min(1).max(8192) });
export type IdTokenRequest = z.infer<typeof idTokenRequestSchema>;

/** `POST /auth/link-code/redeem`: the one-time code plus the Google ID token. */
export const redeemLinkCodeRequestSchema = z.object({
  code: z.string().min(1).max(128),
  idToken: z.string().min(1).max(8192),
});

/** How long a link code lives. */
export const LINK_CODE_TTL_MS = 5 * 60 * 1000;

/** How long a pending Merge confirmation stays valid. */
export const MERGE_PENDING_TTL_MS = 10 * 60 * 1000;

export const mergePathSchema = z.enum(["linkCode", "settings"]);
export type MergePath = z.infer<typeof mergePathSchema>;

export const mergeGroupPreviewSchema = z.object({
  id: z.string(),
  name: z.string(),
  shared: z.boolean(),
  merging: z.boolean().optional(),
});
export type MergeGroupPreview = z.infer<typeof mergeGroupPreviewSchema>;

export const mergeUserPreviewSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  pictureUrl: z.string().nullable(),
  providers: z.array(providerSchema),
  profileProvider: providerSchema,
  groupCount: z.number().int().nonnegative(),
  groups: z.array(mergeGroupPreviewSchema),
});
export type MergeUserPreview = z.infer<typeof mergeUserPreviewSchema>;

export const mergePreviewSchema = z.object({
  mergeId: z.string(),
  path: mergePathSchema,
  expiresAt: z.number(),
  kept: mergeUserPreviewSchema,
  other: mergeUserPreviewSchema,
});
export type MergePreview = z.infer<typeof mergePreviewSchema>;

export const confirmMergeRequestSchema = z.object({
  mergeId: z.string().min(1).max(128),
});
export type ConfirmMergeRequest = z.infer<typeof confirmMergeRequestSchema>;

export const confirmMergeResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.literal(ACCESS_TOKEN_TTL_SECONDS),
  user: z.lazy(() => meSchema),
  mergingGroupIds: z.array(z.string()).optional(),
});
export type ConfirmMergeResponse = z.infer<typeof confirmMergeResponseSchema>;

/** Dev-only `POST /auth/test-sign-in`, present only when the test flag is set. */
export const testSignInRequestSchema = z.object({
  provider: providerSchema,
  sub: z.string().min(1).max(255),
  displayName: z.string().trim().min(1).max(50),
});
export type TestSignInRequest = z.infer<typeof testSignInRequestSchema>;

export const languageSchema = z.enum(LANGUAGES);

export const meSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  pictureUrl: z.string().nullable(),
  /** Shown first on Home and pre-filled as a new Group's Settlement currency. */
  preferredCurrency: currencyCodeSchema,
  /** The language the whole app shows in, kept with the account so every device agrees. */
  language: languageSchema,
  identities: z.array(z.object({ provider: providerSchema, email: z.string().nullable() })),
  /** The provider of the latest sign-in; the profile card shows that one. */
  signedInWith: providerSchema,
});
export type Me = z.infer<typeof meSchema>;

/** `PATCH /me`: the settings a User can change themselves. */
export const mePatchSchema = z
  .object({ preferredCurrency: currencyCodeSchema, language: languageSchema })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "PATCH_EMPTY");
export type MePatch = z.infer<typeof mePatchSchema>;

/** Sign-in and refresh answer; the refresh token travels only in the httpOnly cookie. */
export const sessionResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.literal(ACCESS_TOKEN_TTL_SECONDS),
  user: meSchema,
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const redeemLinkCodeResponseSchema = sessionResponseSchema.extend({
  mergeNeeded: z.literal(true).optional(),
  merge: mergePreviewSchema.optional(),
});
export type RedeemLinkCodeResponse = z.infer<typeof redeemLinkCodeResponseSchema>;

export const linkMergeResponseSchema = z.object({
  mergeNeeded: z.literal(true),
  merge: mergePreviewSchema,
});
export type LinkMergeResponse = z.infer<typeof linkMergeResponseSchema>;
