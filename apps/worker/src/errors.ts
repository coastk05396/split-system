import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Stable API error codes and their HTTP status. The server sends no display text;
 * the SPA maps each code to its zh-TW message. Later tickets add their codes here.
 */
export const ERROR_STATUS = {
  VALIDATION_FAILED: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  IF_MATCH_REQUIRED: 400,
  UNAUTHORIZED: 401,
  ID_TOKEN_INVALID: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  EDIT_CONFLICT: 409,
  GROUP_FULL: 409,
  BALANCE_NOT_ZERO: 409,
  IDENTITY_LINKED_ELSEWHERE: 409,
  PROVIDER_ALREADY_LINKED: 409,
  LAST_IDENTITY: 409,
  LAST_ADMIN: 409,
  INVITE_EXPIRED: 422,
  EXPENSE_AMOUNT_INVALID: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
} as const satisfies Record<string, ContentfulStatusCode>;

export type ErrorCode = keyof typeof ERROR_STATUS;

/** The one error body every API failure uses. */
export interface ErrorBody {
  error: { code: ErrorCode; details?: unknown };
}

/** Thrown by handlers and helpers; the app's error handler turns it into an ErrorBody. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;
  /** Extra response headers, such as `Retry-After` on RATE_LIMITED. */
  readonly headers: Readonly<Record<string, string>>;

  constructor(code: ErrorCode, details?: unknown, headers: Record<string, string> = {}) {
    super(code);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
    this.headers = headers;
  }

  get status(): ContentfulStatusCode {
    return ERROR_STATUS[this.code];
  }

  toBody(): ErrorBody {
    return this.details === undefined
      ? { error: { code: this.code } }
      : { error: { code: this.code, details: this.details } };
  }
}
