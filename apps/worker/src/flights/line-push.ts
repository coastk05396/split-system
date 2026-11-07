/** At most 2 active LINE Push watches per User keeps alerts inside the free monthly allowance. */
export const MAX_LINE_WATCHES = 2;
/** Global safety ceiling per calendar month, under the Official Account's free allowance. */
export const LINE_PUSH_MONTHLY_CAP = 150;

/** Calendar month in Taiwan time (UTC+8, no DST), the zone the Official Account serves. */
const month = (now: number) => new Date(now + 8 * 3_600_000).toISOString().slice(0, 7);

export async function linePushHasQuota(db: D1Database, now: number): Promise<boolean> {
  const row = await db
    .prepare("SELECT count FROM line_push_usage WHERE month=?")
    .bind(month(now))
    .first<{ count: number }>();
  return (row?.count ?? 0) < LINE_PUSH_MONTHLY_CAP;
}

/** Counts one push before it is sent; false once the month's cap is reached. */
export async function reserveLinePush(db: D1Database, now: number): Promise<boolean> {
  const reserved = await db
    .prepare(
      "INSERT INTO line_push_usage(month,count) VALUES(?,1) ON CONFLICT(month) DO UPDATE SET count=count+1 WHERE count<?",
    )
    .bind(month(now), LINE_PUSH_MONTHLY_CAP)
    .run();
  return reserved.meta.changes > 0;
}

/** Gives a reserved slot back when LINE did not accept the message. */
export async function releaseLinePush(db: D1Database, now: number): Promise<void> {
  await db
    .prepare("UPDATE line_push_usage SET count=count-1 WHERE month=? AND count>0")
    .bind(month(now))
    .run();
}

/** The LINE user id of a User's LINE Identity, or null when none is linked. */
export async function lineUserIdOf(db: D1Database, userId: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT provider_sub FROM identities WHERE user_id=? AND provider='line'")
    .bind(userId)
    .first<{ provider_sub: string }>();
  return row?.provider_sub ?? null;
}

/** The User a LINE sender is linked to, or null for a friend who never signed in. */
export async function userOfLineUser(db: D1Database, lineUserId: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT user_id FROM identities WHERE provider='line' AND provider_sub=?")
    .bind(lineUserId)
    .first<{ user_id: string }>();
  return row?.user_id ?? null;
}
