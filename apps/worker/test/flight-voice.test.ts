import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { productionDeps, type AppDeps } from "../src/deps.js";
import type { FlightSpeech } from "../src/flights/voice.js";
import { bearer, clock, signIn, uniqueSub } from "./auth-harness.js";

const URL = "https://split.test/api/v1/flights/voice";
const audio = (bytes = 2_000) => new Uint8Array(bytes).fill(7);

async function speak(
  body: BodyInit | null,
  headers: Record<string, string>,
  deps: Partial<AppDeps> = {},
  token?: string,
  bindings: object = env,
) {
  const app = createApp({ ...productionDeps, now: () => clock.now, ...deps });
  const user = token ? { accessToken: token } : await signIn("google", uniqueSub("voice"));
  return app.request(
    URL,
    { method: "POST", headers: { ...bearer(user.accessToken), ...headers }, body },
    bindings,
  );
}
const hears = (text: string, seen: { bytes?: number; type?: string }[] = []): FlightSpeech => ({
  transcribe: (recording) => {
    seen.push({ bytes: recording.audio.byteLength, type: recording.contentType });
    return Promise.resolve(text);
  },
});

it("hands the recording to speech-to-text and answers with the words", async () => {
  const seen: { bytes?: number; type?: string }[] = [];
  const response = await speak(
    audio(),
    { "Content-Type": "audio/webm;codecs=opus" },
    { flightSpeech: hears("  去沖繩 十二月  ", seen) },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ text: "去沖繩 十二月" });
  expect(seen).toEqual([{ bytes: 2_000, type: "audio/webm;codecs=opus" }]);
});

it("answers empty text when nothing was heard", async () => {
  const response = await speak(
    audio(),
    { "Content-Type": "audio/mp4" },
    { flightSpeech: hears("") },
  );
  expect(await response.json()).toEqual({ text: "" });
});

it("refuses anything that is not audio, empty, or over 1 MB, without calling the provider", async () => {
  let calls = 0;
  const deps = {
    flightSpeech: {
      transcribe: () => {
        calls++;
        return Promise.resolve("x");
      },
    },
  };
  const user = await signIn("google", uniqueSub("voice-bad"));
  for (const [body, type] of [
    [audio(), "application/json"],
    [audio(), "text/plain"],
    [new Uint8Array(0), "audio/webm"],
    [audio(1_048_577), "audio/webm"],
  ] as const) {
    const response = await speak(body, { "Content-Type": type }, deps, user.accessToken);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  }
  expect(calls).toBe(0);
});

it("stops reading a chunked upload that passes 1 MB, without a Content-Length", async () => {
  const chunk = new Uint8Array(400_000);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(chunk);
    },
  });
  const response = await speak(
    body,
    { "Content-Type": "audio/webm" },
    { flightSpeech: hears("x") },
  );
  expect(response.status).toBe(400);
});

it("needs a signed-in User", async () => {
  const app = createApp({ ...productionDeps, now: () => clock.now, flightSpeech: hears("x") });
  const response = await app.request(
    URL,
    { method: "POST", headers: { "Content-Type": "audio/webm" }, body: audio() },
    env,
  );
  expect(response.status).toBe(401);
});

it("allows six recordings a minute per User, then answers 429 with Retry-After", async () => {
  const user = await signIn("google", uniqueSub("voice-rate"));
  const deps = { flightSpeech: hears("ok") };
  for (let i = 0; i < 6; i++) {
    const response = await speak(audio(), { "Content-Type": "audio/webm" }, deps, user.accessToken);
    expect(response.status).toBe(200);
  }
  const blocked = await speak(audio(), { "Content-Type": "audio/webm" }, deps, user.accessToken);
  expect(blocked.status).toBe(429);
  expect(blocked.headers.get("Retry-After")).not.toBeNull();
});

it("answers 503 SERVICE_UNAVAILABLE when speech-to-text fails, and never echoes audio or words", async () => {
  const response = await speak(
    audio(),
    { "Content-Type": "audio/webm" },
    { flightSpeech: { transcribe: () => Promise.reject(new Error("secret words 去沖繩")) } },
  );
  expect(response.status).toBe(503);
  const text = await response.text();
  expect(JSON.parse(text)).toEqual({ error: { code: "SERVICE_UNAVAILABLE" } });
  expect(text).not.toContain("secret");
});

it("sends Groq Whisper the recording and a language hint, and returns its text", async () => {
  const { createFlightSpeech } = await import("../src/flights/voice.js");
  const calls: { url: string; auth: string | null; form: FormData }[] = [];
  const speech = createFlightSpeech((input, init) => {
    calls.push({
      url: input instanceof Request ? input.url : String(input),
      auth: new Headers(init?.headers).get("Authorization"),
      form: init?.body as FormData,
    });
    return Promise.resolve(Response.json({ text: "去沖繩" }));
  });
  const text = await speech.transcribe(
    { audio: audio().buffer, contentType: "audio/webm;codecs=opus", language: "zh-TW" },
    { ...env, GROQ_API_KEY: "test-key" },
  );
  expect(text).toBe("去沖繩");
  expect(calls[0]?.url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
  expect(calls[0]?.auth).toBe("Bearer test-key");
  expect(calls[0]?.form.get("model")).toBe("whisper-large-v3-turbo");
  expect(calls[0]?.form.get("language")).toBe("zh");
  expect(calls[0]?.form.get("prompt")).toBe("以下是繁體中文的句子。");
  expect(calls[0]?.form.get("response_format")).toBe("json");
  expect((calls[0]?.form.get("file") as File).size).toBe(2_000);
  expect((calls[0]?.form.get("file") as File).name).toBe("voice.webm");
});

it("fails without a Groq key, so the web shows its retry message", async () => {
  const { createFlightSpeech } = await import("../src/flights/voice.js");
  const speech = createFlightSpeech(() => Promise.reject(new Error("not called")));
  await expect(
    speech.transcribe(
      { audio: audio().buffer, contentType: "audio/webm", language: "en" },
      { ...env, GROQ_API_KEY: "" },
    ),
  ).rejects.toThrow();
});
