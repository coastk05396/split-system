import {
  MAX_STOPS_PER_DAY,
  type Stop,
  stopDayInTrip,
  type StopInput,
  type StopPatch,
  stopSchema,
  stopTimesValid,
} from "@split/shared";
import { ApiError, invalid } from "./errors.js";
import { assertIfMatch } from "./request-guards.js";

export type StopOperation =
  | { action: "list"; actorId: string; day?: string | undefined }
  | { action: "create"; actorId: string; input: StopInput; now: number }
  | {
      action: "patch";
      actorId: string;
      id: string;
      input: StopPatch;
      expected: number;
      now: number;
    }
  | { action: "delete"; actorId: string; id: string };

type StopRow = { data: string };
type Trip = { is_trip: number; trip_start_date: string | null; trip_end_date: string | null };

export function stopOperation(
  sql: SqlStorage,
  op: StopOperation,
): { value: unknown; changed: boolean; deletedId?: string } {
  const actor = sql
    .exec<{ status: string }>("SELECT status FROM ledger_members WHERE id=?", op.actorId)
    .toArray()[0];
  if (actor?.status !== "active") throw new ApiError("FORBIDDEN");
  const get = (id: string): Stop => {
    const row = sql.exec<StopRow>("SELECT data FROM ledger_stops WHERE id=?", id).toArray()[0];
    if (row === undefined) throw new ApiError("NOT_FOUND");
    return stopSchema.parse(JSON.parse(row.data) as unknown);
  };
  if (op.action === "list") {
    const rows = sql
      .exec<StopRow>(
        `SELECT data FROM ledger_stops WHERE (? IS NULL OR json_extract(data,'$.dayDate')=?)
      ORDER BY json_extract(data,'$.dayDate'), json_extract(data,'$.startTime') IS NULL,
      json_extract(data,'$.startTime'), json_extract(data,'$.createdAt'), rowid`,
        op.day ?? null,
        op.day ?? null,
      )
      .toArray();
    return {
      value: rows.map((row) => stopSchema.parse(JSON.parse(row.data) as unknown)),
      changed: false,
    };
  }
  if (op.action === "delete") {
    get(op.id);
    sql.exec("DELETE FROM ledger_stops WHERE id=?", op.id);
    return { value: null, changed: true, deletedId: op.id };
  }
  const previous = op.action === "patch" ? get(op.id) : null;
  if (op.action === "patch" && previous !== null) assertIfMatch(op.expected, previous);
  const day = op.input.dayDate ?? previous?.dayDate;
  if (day === undefined) throw new ApiError("VALIDATION_FAILED");
  const trip = sql
    .exec<Trip>("SELECT is_trip,trip_start_date,trip_end_date FROM ledger_group WHERE deleted=0")
    .toArray()[0];
  if (trip === undefined) throw new ApiError("NOT_FOUND");
  if (!trip.is_trip) throw new ApiError("TRIP_MODULE_OFF");
  if (!stopDayInTrip(day, trip.trip_start_date, trip.trip_end_date))
    throw invalid("dayDate", "STOP_DAY_OUTSIDE_TRIP");
  // A create lands on `day`, and so does a patch that changes the day; an edit that stays put does not.
  if (day !== previous?.dayDate) {
    const count = sql
      .exec<{ n: number }>(
        "SELECT count(*) n FROM ledger_stops WHERE json_extract(data,'$.dayDate')=?",
        day,
      )
      .one().n;
    if (count >= MAX_STOPS_PER_DAY) throw new ApiError("STOP_LIMIT_REACHED");
  }
  if (op.action === "create") {
    const stop: Stop = {
      id: crypto.randomUUID(),
      dayDate: day,
      startTime: op.input.startTime ?? null,
      endTime: op.input.endTime ?? null,
      title: op.input.title,
      category: op.input.category,
      locationName: op.input.locationName ?? null,
      notes: op.input.notes ?? null,
      createdAt: op.now,
      updatedAt: op.now,
    };
    sql.exec("INSERT INTO ledger_stops(id,data) VALUES (?,?)", stop.id, JSON.stringify(stop));
    return { value: stop, changed: true };
  }
  if (previous === null) throw new ApiError("NOT_FOUND");
  const next = stopSchema.parse({
    ...previous,
    ...op.input,
    updatedAt: Math.max(op.now, previous.updatedAt + 1),
  });
  if (!stopTimesValid(next.startTime, next.endTime)) throw invalid("endTime", "STOP_TIME_INVALID");
  sql.exec("UPDATE ledger_stops SET data=? WHERE id=?", JSON.stringify(next), op.id);
  return { value: next, changed: true };
}
