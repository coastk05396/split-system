import { z } from "zod";
import { LANGUAGES } from "./labels.js";
import { currencyCodeSchema } from "./schemas.js";

/** Sign-in, session and account shapes shared by the Worker and the SPA. */

export const PROVIDERS = ["google", "line"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const providerSchema = z.enum(PROVIDERS);

/** Access tokens live for one hour; refresh tokens for 30 days, renewed at each rotation. */
export const ACCESS_TOKEN_TTL_SECONDS = 3600;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 3600;

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

export const languageSchema = z.enum(LANGUAGES);

export const meSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  pictureUrl: z.string().nullable(),
  /** Shown first on Home and pre-filled as a new Group's Settlement currency. */
  preferredCurrency: currencyCodeSchema,
  /** The language the whole app shows in, kept with the account so every device agrees. */
  language: languageSchema,
  identities: z.array(z.object({ provider: providerSchema })),
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
