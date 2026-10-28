/**
 * True when a D1 write failed on a SQLite constraint, looking through Drizzle's
 * wrapping error. `target` narrows a UNIQUE failure to one column, such as
 * `expenses.idempotency_key`, so a create route can answer a repeat with the original row.
 */
export function isConstraintError(
  error: unknown,
  kind: "UNIQUE" | "CHECK",
  target?: string,
): boolean {
  const expected = `${kind} constraint failed${target === undefined ? "" : `: ${target}`}`;
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if (current.message.includes(expected)) return true;
  }
  return false;
}
