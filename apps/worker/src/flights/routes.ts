import { flightHighlights } from "./history.js";
import {
  currencyCodeSchema,
  flightAdviceRequestSchema,
  flightSearchRequestSchema,
  flightRecipes,
} from "@split/shared";
import { createDb } from "../db/client.js";
import { consumeRateLimit } from "../rate-limit.js";
import { adviseFlights } from "./advice.js";
import { Hono } from "hono";
import type { AppEnv } from "../api.js";
import { requireUser } from "../auth/require-user.js";
import type { AppDeps } from "../deps.js";
import { parseBody } from "../request-guards.js";
import { ApiError } from "../errors.js";
import { searchFlightRequest } from "./search.js";
import { MAX_VOICE_BYTES, productionFlightSpeech, readCapped } from "./voice.js";

export function flightRoutes(deps: AppDeps) {
  return (
    new Hono<AppEnv>()
      .get("/flights/highlights", requireUser(deps.now), async (c) => {
        const currency = currencyCodeSchema.safeParse(c.req.query("currency") ?? "TWD");
        if (!currency.success) throw new ApiError("VALIDATION_FAILED");
        return c.json(
          {
            highlights: await flightHighlights(c.env.DB, currency.data, deps.now()),
            recipes: flightRecipes(deps.now(), currency.data),
          },
          200,
        );
      })
      .post("/flights/search", requireUser(deps.now), async (c) => {
        const request = await parseBody(c, flightSearchRequestSchema);
        return c.json(await searchFlightRequest(c.env, deps, c.var.userId, request), 200);
      })
      // 語音搜尋: the recording is held in memory for this request only; it and the words are never stored or logged.
      .post("/flights/voice", requireUser(deps.now), async (c) => {
        const declared = Number(c.req.header("Content-Length") ?? 0);
        if (!/^audio\//i.test(c.req.header("Content-Type") ?? "") || declared > MAX_VOICE_BYTES) {
          throw new ApiError("VALIDATION_FAILED");
        }
        // Charged before the body is read, so oversized uploads cannot be repeated for free.
        await consumeRateLimit(createDb(c.env.DB), c.var.userId, "flights_voice", deps.now());
        const audio = await readCapped(c.req.raw.body, MAX_VOICE_BYTES);
        if (audio.byteLength === 0) throw new ApiError("VALIDATION_FAILED");
        const user = await c.env.DB.prepare("SELECT language FROM users WHERE id=?")
          .bind(c.var.userId)
          .first<{ language: string }>();
        try {
          const text = await (deps.flightSpeech ?? productionFlightSpeech).transcribe(
            {
              audio,
              contentType: c.req.header("Content-Type") ?? "audio/webm",
              language: user?.language === "en" ? "en" : "zh-TW",
            },
            c.env,
          );
          return c.json({ text: text.trim() }, 200);
        } catch {
          throw new ApiError("SERVICE_UNAVAILABLE");
        }
      })
      .post("/flights/advise", requireUser(deps.now), async (c) => {
        const request = await parseBody(c, flightAdviceRequestSchema);
        await consumeRateLimit(createDb(c.env.DB), c.var.userId, "flights_advise", deps.now());
        return c.json(await adviseFlights(c.env, deps, request), 200);
      })
  );
}
