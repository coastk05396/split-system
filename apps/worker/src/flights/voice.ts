import type { Bindings } from "../env.js";

/** One 語音搜尋 recording. It lives in memory for one request: never stored, never logged. */
export interface SpeechRecording {
  audio: ArrayBuffer;
  contentType: string;
  language: "en" | "zh-TW";
}

/** Speech-to-text behind 語音搜尋; tests pass a fake, like the other provider seams. */
export interface FlightSpeech {
  transcribe(recording: SpeechRecording, env: Bindings): Promise<string>;
}

/** About 15 s at the web's 32 kbit/s is 60 KB; this ceiling is far above that and far below Groq's limit. */
export const MAX_VOICE_BYTES = 1_048_576;

/** Groq Whisper; throws when there is no key or Groq fails, which the route turns into 503. */
export function createFlightSpeech(fetchImpl: typeof fetch = fetch): FlightSpeech {
  return {
    async transcribe({ audio, contentType, language }, env) {
      if (!env.GROQ_API_KEY) throw new Error("speech provider not configured");
      const form = new FormData();
      form.set("file", new File([audio], "voice", { type: contentType }));
      form.set("model", "whisper-large-v3-turbo");
      form.set("language", language === "en" ? "en" : "zh");
      form.set("response_format", "json");
      form.set("temperature", "0");
      const response = await fetchImpl("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
        body: form,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("speech provider unavailable");
      const body = await response.json<{ text?: unknown }>();
      return typeof body.text === "string" ? body.text : "";
    },
  };
}

export const productionFlightSpeech = createFlightSpeech();
