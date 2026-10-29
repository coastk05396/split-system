import {
  MAX_STOPS_PER_DAY,
  type Stop,
  type StopInput,
  type StopPatch,
  stopDayInTrip,
  stopTimesValid,
} from "@split/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { groups, stops } from "../db/schema.js";
import { ApiError, invalid } from "../errors.js";
import type { MemberRow } from "../groups/membership.js";
import { assertIfMatch } from "../request-guards.js";

type StopRow = typeof stops.$inferSelect;

function toStop(row: StopRow): Stop {
  return {
    id: row.id,
    dayDate: row.dayDate,
    startTime: row.startTime,
    endTime: row.endTime,
    title: row.title,
    category: row.category,
    locationName: row.locationName,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadTrip(db: Db, groupId: string) {
  const [trip] = await db
    .select({
      isTrip: groups.isTrip,
      start: groups.tripStartDate,
      end: groups.tripEndDate,
    })
    .from(groups)
    .where(eq(groups.id, groupId));
  if (trip === undefined) throw new ApiError("NOT_FOUND");
  return trip;
}

/** Stops can be added or edited only while the Group's trip module is on, inside its dates. */
async function assertPlannable(db: Db, groupId: string, day: string): Promise<void> {
  const trip = await loadTrip(db, groupId);
  if (!trip.isTrip) throw new ApiError("TRIP_MODULE_OFF");
  if (!stopDayInTrip(day, trip.start, trip.end)) throw invalid("dayDate", "STOP_DAY_OUTSIDE_TRIP");
}

/**
 * A Trip's Stops ordered by day, then start time; Stops with no time go last in the order
 * added (decision 13). A Group whose trip module is off keeps its Stops and still lists them.
 */
export async function listStops(db: Db, me: MemberRow, day: string | undefined): Promise<Stop[]> {
  const rows = await db
    .select()
    .from(stops)
    .where(
      and(eq(stops.groupId, me.groupId), day === undefined ? undefined : eq(stops.dayDate, day)),
    )
    .orderBy(
      asc(stops.dayDate),
      sql`${stops.startTime} IS NULL`,
      asc(stops.startTime),
      asc(stops.createdAt),
      sql`rowid`,
    );
  return rows.map(toStop);
}

async function loadStop(db: Db, groupId: string, stopId: string): Promise<StopRow> {
  const [row] = await db
    .select()
    .from(stops)
    .where(and(eq(stops.id, stopId), eq(stops.groupId, groupId)));
  if (row === undefined) throw new ApiError("NOT_FOUND");
  return row;
}

/** Any Member adds a Stop. The trip switch and the per-day cap are re-checked in the INSERT. */
export async function createStop(
  db: Db,
  me: MemberRow,
  input: StopInput,
  now: number,
): Promise<Stop> {
  await assertPlannable(db, me.groupId, input.dayDate);
  const id = crypto.randomUUID();
  const inserted = await db.run(sql`
    INSERT INTO stops (id, group_id, day_date, start_time, end_time, title, category, location_name, notes, created_at, updated_at)
    SELECT ${id}, ${me.groupId}, ${input.dayDate}, ${input.startTime ?? null}, ${input.endTime ?? null},
      ${input.title}, ${input.category}, ${input.locationName ?? null}, ${input.notes ?? null}, ${now}, ${now}
    WHERE EXISTS (SELECT 1 FROM groups g WHERE g.id = ${me.groupId} AND g.is_trip = 1)
      AND (SELECT count(*) FROM stops d WHERE d.group_id = ${me.groupId} AND d.day_date = ${input.dayDate}) < ${MAX_STOPS_PER_DAY}`);
  if (inserted.meta.changes === 0) {
    const trip = await loadTrip(db, me.groupId);
    throw new ApiError(trip.isTrip ? "STOP_LIMIT_REACHED" : "TRIP_MODULE_OFF");
  }
  return toStop(await loadStop(db, me.groupId, id));
}

/** Any Member edits a Stop under `If-Match`; absent fields stay, null clears. */
export async function patchStop(
  db: Db,
  me: MemberRow,
  stopId: string,
  patch: StopPatch,
  expectedUpdatedAt: number,
  now: number,
): Promise<Stop> {
  const current = await loadStop(db, me.groupId, stopId);
  assertIfMatch(expectedUpdatedAt, toStop(current));
  const startTime = patch.startTime === undefined ? current.startTime : patch.startTime;
  const endTime = patch.endTime === undefined ? current.endTime : patch.endTime;
  if (!stopTimesValid(startTime, endTime)) throw invalid("endTime", "STOP_TIME_INVALID");
  await assertPlannable(db, me.groupId, patch.dayDate ?? current.dayDate);

  const updated = await db
    .update(stops)
    .set({ ...patch, updatedAt: Math.max(now, current.updatedAt + 1) })
    .where(
      and(
        eq(stops.id, stopId),
        eq(stops.updatedAt, expectedUpdatedAt),
        sql`EXISTS (SELECT 1 FROM groups g WHERE g.id = ${me.groupId} AND g.is_trip = 1)`,
      ),
    )
    .returning({ id: stops.id });
  if (updated.length === 0) {
    const trip = await loadTrip(db, me.groupId);
    if (!trip.isTrip) throw new ApiError("TRIP_MODULE_OFF");
    throw new ApiError("EDIT_CONFLICT", {
      current: toStop(await loadStop(db, me.groupId, stopId)),
    });
  }
  return toStop(await loadStop(db, me.groupId, stopId));
}

/**
 * Any Member deletes a Stop, also while the trip module is off. Its Expenses stay and lose
 * only the link: `expenses.stop_id` is `ON DELETE SET NULL` (decision 13).
 */
export async function deleteStop(db: Db, me: MemberRow, stopId: string): Promise<void> {
  const deleted = await db
    .delete(stops)
    .where(and(eq(stops.id, stopId), eq(stops.groupId, me.groupId)))
    .returning({ id: stops.id });
  if (deleted.length === 0) throw new ApiError("NOT_FOUND");
}
