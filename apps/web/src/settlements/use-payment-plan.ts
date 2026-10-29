import type { Balance, PaymentPlan, PaymentPlanReply } from "@split/shared";
import { useEffect, useState } from "react";
import { startPlanWorker } from "./plan-worker.js";

export type PlanState =
  | { status: "computing" }
  | { status: "ready"; plan: PaymentPlan }
  | { status: "failed" };

/**
 * The Payment plan for these Balances, computed in a Web Worker (SPEC §3.4). Every device gets
 * the same plan for the same Balances: the tie-breaks are fixed in `@split/shared`. A new list
 * of Balances (after any write) asks again; an answer for an older list is dropped.
 */
export function usePaymentPlan(balances: readonly Balance[] | undefined): PlanState {
  const [state, setState] = useState<PlanState>({ status: "computing" });
  const key = balances === undefined ? null : JSON.stringify(balances);

  useEffect(() => {
    if (key === null) return;
    setState({ status: "computing" });
    const worker = startPlanWorker();
    let live = true;
    worker.onmessage = (event: MessageEvent<PaymentPlanReply>) => {
      if (!live) return;
      const reply = event.data;
      setState(reply.ok ? { status: "ready", plan: reply.value } : { status: "failed" });
    };
    worker.onerror = () => {
      if (live) setState({ status: "failed" });
    };
    worker.postMessage(JSON.parse(key) as Balance[]);
    return () => {
      live = false;
      worker.terminate();
    };
  }, [key]);

  return state;
}
