import type { ErrorBody, ErrorCode } from "@split/worker";

export type { ErrorCode };

/** An API call that answered with the shared error body (or could not be read as one). */
export class ApiFailure extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, status: number) {
    super(code);
    this.name = "ApiFailure";
    this.code = code;
    this.status = status;
  }
}

function isErrorBody(value: unknown): value is ErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const { error } = value;
  return (
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
  );
}

/** Reads a failed response into an ApiFailure; anything unreadable counts as INTERNAL. */
export async function toApiFailure(res: Response): Promise<ApiFailure> {
  const body: unknown = await res.json().catch(() => null);
  return new ApiFailure(isErrorBody(body) ? body.error.code : "INTERNAL", res.status);
}
