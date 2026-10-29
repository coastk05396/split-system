import { z } from "zod";
import {
  localDateSchema,
  localTimeSchema,
  MAX_CATEGORY_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
  MAX_NOTES_LENGTH,
} from "./schemas.js";

/** Trip Stops (SPEC §4 table 11, §5.1; decisions 13, 15). `stopInputSchema` lives in schemas.ts. */

/** Stops one Trip day may hold (decision 15). */
export const MAX_STOPS_PER_DAY = 50;

/** A Stop's day lies inside the Trip's dates; an unset Trip date leaves that side open. */
export function stopDayInTrip(day: string, start: string | null, end: string | null): boolean {
  return (start === null || day >= start) && (end === null || day <= end);
}

/** A Stop's time range runs forward; either end may be unset. */
export function stopTimesValid(start: string | null, end: string | null): boolean {
  return start === null || end === null || start <= end;
}

/**
 * `PATCH /groups/:id/stops/:sid` (with `If-Match: <updatedAt>`). Absent fields stay; null
 * clears an optional field. The time range is checked against the stored one by the Worker.
 */
export const stopPatchSchema = z
  .object({
    dayDate: localDateSchema,
    startTime: localTimeSchema.nullable(),
    endTime: localTimeSchema.nullable(),
    title: z.string().trim().min(1).max(MAX_NAME_LENGTH),
    category: z.string().trim().min(1).max(MAX_CATEGORY_LENGTH),
    locationName: z.string().trim().max(MAX_DESCRIPTION_LENGTH).nullable(),
    notes: z.string().max(MAX_NOTES_LENGTH).nullable(),
  })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "PATCH_EMPTY");
export type StopPatch = z.infer<typeof stopPatchSchema>;

/** `GET /groups/:id/stops?day=YYYY-MM-DD`: without `day`, every Stop of the Trip. */
export const stopListQuerySchema = z.object({ day: localDateSchema.optional() });

export const stopSchema = z.object({
  id: z.string(),
  dayDate: z.string(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  title: z.string(),
  category: z.string(),
  /** Free text; the SPA builds the "在地圖開啟" Google Maps link from it. */
  locationName: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Stop = z.infer<typeof stopSchema>;
