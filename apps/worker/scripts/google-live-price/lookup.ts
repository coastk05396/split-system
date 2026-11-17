import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { LiveLookup, LiveResult } from "../../src/flights/live-price.ts";

const ADAPTER = join(dirname(fileURLToPath(import.meta.url)), "adapter.py");

const resultsSchema = z.array(
  z.object({
    id: z.string(),
    reason: z.enum(["no_result", "error", "blocked"]).nullable(),
    blockedReason: z.string().optional(),
    errorReason: z.string().optional(),
    itineraries: z.array(
      z.object({
        priceTwd: z.number(),
        airlines: z.array(z.string()),
        transfers: z.number(),
        outboundDep: z.string().nullish(),
        outboundArr: z.string().nullish(),
      }),
    ),
  }),
);

/** Runs the Python Google adapter for one batch; `python` defaults to `python3`. */
export function pythonLiveLookup(python = "python3"): LiveLookup {
  return (batch, { allowRetry }) =>
    new Promise<LiveResult[]>((resolve, reject) => {
      const child = execFile(
        python,
        ["-I", ADAPTER],
        { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
        (error, stdout) => {
          if (error) {
            reject(new Error(`google adapter failed: ${error.message.split("\n")[0]}`));
            return;
          }
          try {
            resolve(resultsSchema.parse(JSON.parse(stdout)));
          } catch {
            reject(new Error("google adapter returned invalid JSON"));
          }
        },
      );
      child.stdin?.end(
        JSON.stringify(
          batch.map((c) => ({
            id: c.id,
            origin: c.origin,
            dest: c.dest,
            tripType: c.tripType,
            outDate: c.outDate,
            inDate: c.inDate,
            allowRetry,
          })),
        ),
      );
    });
}
