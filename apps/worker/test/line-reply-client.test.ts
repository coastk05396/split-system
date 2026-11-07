import { describe, expect, it } from "vitest";
import { createLineReplyClient, LinePushRejectedError } from "../src/line/reply-client.js";

const message = [{ type: "text" as const, text: "hi" }];
const RETRY_KEY = crypto.randomUUID();

function clientWith(respond: () => Promise<Response>) {
  const calls: RequestInit[] = [];
  const client = createLineReplyClient("token", (_url, init) => {
    if (init) calls.push(init);
    return respond();
  });
  return { client, calls };
}

describe("LINE push client", () => {
  it("sends the retry key and a timeout signal", async () => {
    const { client, calls } = clientWith(() => Promise.resolve(new Response("{}")));

    await client.push("U1", message, RETRY_KEY);

    expect(new Headers(calls[0]?.headers).get("X-Line-Retry-Key")).toBe(RETRY_KEY);
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([400, 403, 429])("reports %i as a definite rejection", async (status) => {
    const { client } = clientWith(() => Promise.resolve(new Response("{}", { status })));

    await expect(client.push("U1", message, RETRY_KEY)).rejects.toBeInstanceOf(
      LinePushRejectedError,
    );
  });

  it("treats 409 (retry key already accepted) as delivered", async () => {
    const { client } = clientWith(() => Promise.resolve(new Response("{}", { status: 409 })));

    await expect(client.push("U1", message, RETRY_KEY)).resolves.toBeUndefined();
  });

  it("does not call a 5xx or a network error a rejection", async () => {
    const server = clientWith(() => Promise.resolve(new Response("{}", { status: 503 })));
    const network = clientWith(() => Promise.reject(new TypeError("network")));

    for (const { client } of [server, network]) {
      const error: unknown = await client.push("U1", message, RETRY_KEY).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(LinePushRejectedError);
    }
  });
});
