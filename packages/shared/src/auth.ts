import { z } from "zod";

/** Sign-in, session and account shapes shared by the Worker and the SPA. */

export const PROVIDERS = ["google", "line"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const providerSchema = z.enum(PROVIDERS);

/** Access tokens live for one hour; refresh tokens for 30 days, renewed at each rotation. */
export const ACCESS_TOKEN_TTL_SECONDS = 3600;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 3600;

/** Shown in place of a deleted User's name on the Member rows they leave behind. */
export const DELETED_USER_NAME = "已刪除的使用者";

/** `POST /auth/google`, `/auth/line` and `/auth/link/:provider`. */
export const idTokenRequestSchema = z.object({ idToken: z.string().min(1).max(8192) });
export type IdTokenRequest = z.infer<typeof idTokenRequestSchema>;

/** Dev-only `POST /auth/test-sign-in`, present only when the test flag is set. */
export const testSignInRequestSchema = z.object({
  provider: providerSchema,
  sub: z.string().min(1).max(255),
  displayName: z.string().trim().min(1).max(50),
});
export type TestSignInRequest = z.infer<typeof testSignInRequestSchema>;

export const meSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  pictureUrl: z.string().nullable(),
  identities: z.array(z.object({ provider: providerSchema })),
});
export type Me = z.infer<typeof meSchema>;

/** Sign-in and refresh answer; the refresh token travels only in the httpOnly cookie. */
export const sessionResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.literal(ACCESS_TOKEN_TTL_SECONDS),
  user: meSchema,
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
