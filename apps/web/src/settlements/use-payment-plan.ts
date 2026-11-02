import { type Balance, type PaymentPlan, type PaymentPlanReply, planPayments } from "@split/shared";
import { useEffect, useMemo, useState } from "react";
import { startPlanWorker } from "./plan-worker.js";

export type PlanState =
  { status: "computing" } | { status: "ready"; plan: PaymentPlan } | { status: "failed" };

/** Small plans are available on the first render; larger plans run in a worker. */
export function usePaymentPlan(balances: readonly Balance[] | undefined): PlanState {
  const key = balances === undefined ? null : JSON.stringify(balances);
  const input = useMemo(() => {
    if (key === null) return null;
    const parsed = JSON.parse(key) as Balance[];
    if (parsed.filter((b) => b.amountMinor !== 0).length > 15) return { kind: "worker" as const };
    const result = planPayments(parsed);
    return {
      kind: "sync" as const,
      state: result.ok
        ? { status: "ready" as const, plan: result.value }
        : { status: "failed" as const },
    };
  }, [key]);
  const [workerResult, setWorkerResult] = useState<{ key: string; state: PlanState } | null>(null);

  useEffect(() => {
    if (key === null || input?.kind !== "worker") return;
    const worker = startPlanWorker();
    let live = true;
    worker.onmessage = (event: MessageEvent<PaymentPlanReply>) => {
      if (!live) return;
      const reply = event.data;
      setWorkerResult({
        key,
        state: reply.ok ? { status: "ready", plan: reply.value } : { status: "failed" },
      });
    };
    worker.onerror = () => {
      if (live) setWorkerResult({ key, state: { status: "failed" } });
    };
    worker.postMessage(JSON.parse(key) as Balance[]);
    return () => {
      live = false;
      worker.terminate();
    };
  }, [key, input]);

  if (input?.kind === "sync") return input.state;
  if (key !== null && input?.kind === "worker" && workerResult?.key === key)
    return workerResult.state;
  return { status: "computing" };
}
