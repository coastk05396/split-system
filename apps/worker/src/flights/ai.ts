import { z } from "zod";
import {
  FLIGHT_THEMES,
  airportCodeSchema,
  currencyCodeSchema,
  defaultFlightIntent,
  anchorFlightDates,
  flightSearchIntentSchema,
  localDateSchema,
  type FlightSearchDefaults,
  type FlightSearchIntent,
} from "@split/shared";
import type { Bindings } from "../env.js";
import { ApiError } from "../errors.js";

export interface FlightAI {
  parsePrompt(
    prompt: string,
    defaults: FlightSearchDefaults,
    env: Bindings,
    now: number,
  ): Promise<FlightSearchIntent>;
}
const extractedIntentSchema = z
  .object({
    origin: airportCodeSchema.nullable(),
    destination: airportCodeSchema.nullable(),
    departureDate: localDateSchema.nullable(),
    returnDate: localDateSchema.nullable(),
    currency: currencyCodeSchema.nullable(),
    budget: z.number().int().positive().max(99_999_999).nullable(),
    excludeRedEye: z.boolean().nullable(),
    directOnly: z.boolean().nullable(),
    theme: z.enum(FLIGHT_THEMES).nullable(),
    timing: z.enum(["next_weekend", "next_month_weekend"]).nullable(),
    durationDays: z.union([z.literal(3), z.literal(4)]).nullable(),
  })
  .strict();
const groqReply = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});
const aiReply = z.object({ response: z.union([z.string(), extractedIntentSchema]) });

export function createFlightAI(fetchImpl: typeof fetch = fetch): FlightAI {
  return {
    async parsePrompt(prompt, defaults, env, now) {
      const schema = z.toJSONSchema(extractedIntentSchema);
      const messages = [
        {
          role: "system",
          content: `Extract flight search intent only as JSON with every field of this schema: ${JSON.stringify(schema)}. Unknown fields must be null. Today in Taiwan: ${new Date(now + 8 * 3600000).toISOString().slice(0, 10)}. Defaults: ${JSON.stringify(defaults)}. Budget uses integer currency minor units (USD/THB ×100; TWD/JPY ×1). Never generate fares or deals. Fuzzy timing must use timing enum, not invented exact dates. warm_island means warm island, food_city means food city, solo means solo breather.`,
        },
        { role: "user", content: prompt },
      ];
      let extracted: z.infer<typeof extractedIntentSchema> | undefined;
      if (env.GROQ_API_KEY) {
        try {
          const response = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${env.GROQ_API_KEY}`,
            },
            // GPT-OSS supports constrained decoding; the same schema is validated again at the boundary.
            body: JSON.stringify({
              model: "openai/gpt-oss-120b",
              reasoning_effort: "low",
              max_completion_tokens: 1200,
              temperature: 0,
              messages,
              response_format: {
                type: "json_schema",
                json_schema: { name: "flight_search_intent", strict: true, schema },
              },
            }),
            signal: AbortSignal.timeout(6000),
          });
          if (!response.ok) throw new Error("intent provider unavailable");
          const content = groqReply.parse(await response.json()).choices[0]?.message.content;
          extracted = extractedIntentSchema.parse(JSON.parse(content ?? "{}"));
        } catch {
          /* Workers AI is the bounded fallback for unavailable or invalid primary output. */
        }
      }
      if (!extracted && env.AI) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const result: unknown = await Promise.race([
            env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
              messages,
              response_format: { type: "json_object" },
            }),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                reject(new Error("intent timeout"));
              }, 6000);
            }),
          ]);
          const response = aiReply.parse(result).response;
          extracted = extractedIntentSchema.parse(
            typeof response === "string" ? JSON.parse(response) : response,
          );
        } catch {
          /* Invalid outputs never reach flight discovery. */
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
      if (!extracted) throw new ApiError("VALIDATION_FAILED");
      if (!extracted.destination && !extracted.theme && !defaults.destination && !defaults.theme)
        throw new ApiError("VALIDATION_FAILED");
      const { timing, durationDays, ...fields } = extracted;
      const values = Object.fromEntries(
        Object.entries(fields).filter(([, value]) => value !== null),
      );
      const dates = timing ? anchorFlightDates(timing, durationDays ?? 4, now) : {};
      const intent = flightSearchIntentSchema.safeParse({
        ...defaultFlightIntent(now, defaults.currency ?? "TWD"),
        ...defaults,
        ...values,
        ...dates,
        ...(extracted.destination && !extracted.theme ? { theme: undefined } : {}),
      });
      if (!intent.success) throw new ApiError("VALIDATION_FAILED");
      return intent.data;
    },
  };
}
export const productionFlightAI = createFlightAI();
