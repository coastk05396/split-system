import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { voidMutationsInFlight } from "./void-mutations.js";

/** A write that has reached the network and waits for its answer. */
async function start(client: QueryClient, onSuccess: () => void) {
  let finish: (value: string) => void = () => undefined;
  let sent: () => void = () => undefined;
  const reached = new Promise<void>((resolve) => {
    sent = resolve;
  });
  const observer = new MutationObserver(client, {
    mutationFn: () =>
      new Promise<string>((resolve) => {
        finish = resolve;
        sent();
      }),
    onSuccess,
  });
  const done = observer.mutate();
  await reached;
  return {
    done,
    finish: (value: string) => {
      finish(value);
    },
  };
}

describe("voidMutationsInFlight", () => {
  it("keeps a write asked before sign-out from running its callbacks after it", async () => {
    const client = new QueryClient();
    const onSuccess = vi.fn();
    const write = await start(client, onSuccess);

    voidMutationsInFlight(client);
    write.finish("late answer");

    await expect(write.done).resolves.toBe("late answer");
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("leaves a write asked afterwards alone", async () => {
    const client = new QueryClient();
    voidMutationsInFlight(client);
    const onSuccess = vi.fn();
    const write = await start(client, onSuccess);

    write.finish("answer");
    await write.done;

    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});
