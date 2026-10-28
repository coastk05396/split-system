/**
 * Web Worker entry for the Payment plan, so the exact search never blocks the UI thread.
 * In Vite: `import PaymentPlanWorker from "@split/shared/payment-plan.worker?worker"`. Post a list
 * of Balances, receive a `PaymentPlanReply`.
 */
import { handlePaymentPlanMessage } from "./payment-plan-worker.js";

interface WorkerScope {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown): void;
}

const scope = globalThis as unknown as WorkerScope;
scope.onmessage = (event) => {
  scope.postMessage(handlePaymentPlanMessage(event.data));
};
