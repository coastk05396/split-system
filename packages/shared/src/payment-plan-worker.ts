import { z } from "zod";
import { planPayments, type PaymentPlan, type PaymentPlanError } from "./payment-plan.js";
import { err, type Result } from "./result.js";
import { idSchema } from "./schemas.js";

const balancesMessageSchema = z.array(z.object({ memberId: idSchema, amountMinor: z.number() }));

export type PaymentPlanReply = Result<PaymentPlan, PaymentPlanError | "PAYMENT_PLAN_INPUT_INVALID">;

/** What the Payment plan Web Worker answers to one message: a list of Balances. */
export function handlePaymentPlanMessage(data: unknown): PaymentPlanReply {
  const parsed = balancesMessageSchema.safeParse(data);
  if (!parsed.success) return err("PAYMENT_PLAN_INPUT_INVALID");
  return planPayments(parsed.data);
}
