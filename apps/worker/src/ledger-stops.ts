import {
  MAX_STOPS_PER_DAY,
  stopDayInTrip,
  stopInputSchema,
  stopPatchSchema,
  stopSchema,
  stopTimesValid,
  type Stop,
} from "@split/shared";
import { z } from "zod";
import { ApiError, invalid } from "./errors.js";
import { assertIfMatch } from "./request-guards.js";

const operationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), day: z.string().optional() }),
  z.object({ action: z.literal("create"), input: stopInputSchema, now: z.number().int() }),
  z.object({
    action: z.literal("patch"),
    id: z.string(),
    input: stopPatchSchema,
    expected: z.number().int(),
    now: z.number().int(),
  }),
  z.object({ action: z.literal("delete"), id: z.string() }),
]);

type StopRow = { data: string };
type Trip = { is_trip: number; trip_start_date: string | null; trip_end_date: string | null };

export function stopOperation(
  sql: SqlStorage,
  raw: unknown,
): { value: unknown; changed: boolean; deletedId?: string } {
  const parsed = operationSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError("VALIDATION_FAILED");
  const op = parsed.data;
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
  if (op.action === "create") {
    const count = sql
      .exec<{ n: number }>(
        "SELECT count(*) n FROM ledger_stops WHERE json_extract(data,'$.dayDate')=?",
        day,
      )
      .one().n;
    if (count >= MAX_STOPS_PER_DAY) throw new ApiError("STOP_LIMIT_REACHED");
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
