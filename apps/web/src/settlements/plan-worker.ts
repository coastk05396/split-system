import PaymentPlanWorker from "@split/shared/payment-plan.worker?worker";

/**
 * Starts the Payment plan Web Worker (SPEC §3.4), so the exact search never blocks the page.
 * Tests replace this module with an in-thread stand-in (test/setup.ts); jsdom has no Worker.
 */
export function startPlanWorker(): Worker {
  return new PaymentPlanWorker();
}
