import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { bearer, call, clock, json, signIn, uniqueSub } from "./auth-harness.js";
import { createGroup } from "./groups-harness.js";

function failedCreates(mode: "response" | "throw") {
  return new Proxy(env.GROUP_LEDGER, {
    get(namespace, property) {
      if (property === "get")
        return (id: DurableObjectId) => {
          const stub = namespace.get(id);
          return new Proxy(stub, {
            get(target, key) {
              if (key === "fetch")
                return (input: RequestInfo | URL, init?: RequestInit) => {
                  const url = input instanceof Request ? input.url : input.toString();
                  if (new URL(url).pathname === "/create") {
                    if (mode === "throw") throw new Error("injected create failure");
                    return Promise.resolve(new Response(null, { status: 503 }));
                  }
                  return target.fetch(input, init);
                };
              const value: unknown = Reflect.get(target, key, target);
              return typeof value === "function" ? (value.bind(target) as unknown) : value;
            },
          });
        };
      const value: unknown = Reflect.get(namespace, property, namespace);
      return typeof value === "function" ? (value.bind(namespace) as unknown) : value;
    },
  });
}

it.each(["response", "throw"] as const)(
  "a ledger create %s failure releases the reservation and preserves the 20-group allowance",
  async (mode) => {
    const sub = uniqueSub("create failure");
    let user = await signIn("google", sub, "Create failure");
    const response = await call(
      "/groups",
      json({ name: "Failed group" }, bearer(user.accessToken)),
      {
        GROUP_LEDGER: failedCreates(mode),
      },
    );
    expect(response.status).toBe(500);
    expect(
      await env.DB.prepare(
        "SELECT group_id FROM group_reservations WHERE user_id=? AND status='pending'",
      )
        .bind(user.userId)
        .all(),
    ).toMatchObject({ results: [] });
    for (let i = 0; i < 20; i++) {
      if (i % 5 === 0) {
        clock.now += 3_600_000;
        user = await signIn("google", sub, "Create failure");
      }
      await createGroup(user);
    }
    expect(
      await env.DB.prepare("SELECT count(*) AS n FROM group_reservations WHERE user_id=?")
        .bind(user.userId)
        .first(),
    ).toEqual({ n: 20 });
  },
  20_000,
);
