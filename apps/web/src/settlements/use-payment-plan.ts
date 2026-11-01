import { type Balance, type PaymentPlan, type PaymentPlanReply, planPayments } from "@split/shared";
import { useEffect, useState } from "react";
import { startPlanWorker } from "./plan-worker.js";

export type PlanState =
  { status: "computing" } | { status: "ready"; plan: PaymentPlan } | { status: "failed" };

const computeInitial = (b: readonly Balance[] | undefined): PlanState => {
  if (!b) return { status: "computing" };
  const nonZero = b.filter((x) => x.amountMinor !== 0);
  if (nonZero.length <= 15) {
    const res = planPayments(b);
    return res.ok ? { status: "ready", plan: res.value } : { status: "failed" };
  }
  return { status: "computing" };
};

/**
 * The Payment plan for these Balances:
 * - Small groups (<= 15 non-zero members) are computed synchronously on the main thread for
 *   instant frame-0 rendering.
 * - Larger groups delegate to a Web Worker (SPEC §3.4) to prevent UI thread blocking.
 *
 * Every device gets the same plan for the same Balances: the tie-breaks are fixed in `@split/shared`.
 * A new list of Balances (after any write) recomputes; an answer for an older list is dropped.
 */
export function usePaymentPlan(balances: readonly Balance[] | undefined): PlanState {
  const [state, setState] = useState<PlanState>(() => computeInitial(balances));
  const key = balances === undefined ? null : JSON.stringify(balances);

  useEffect(() => {
    if (key === null || balances === undefined) return;
    const nonZero = balances.filter((x) => x.amountMinor !== 0);
    if (nonZero.length <= 15) {
      const res = planPayments(balances);
      setState(res.ok ? { status: "ready", plan: res.value } : { status: "failed" });
      return;
    }

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
