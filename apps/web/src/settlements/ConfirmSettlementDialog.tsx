import * as Dialog from "@radix-ui/react-dialog";
import { type CurrencyCode, formatAmount, parseAmount } from "@split/shared";
import { ArrowRight, HandCoins } from "lucide-react";
import { type SubmitEvent, useState } from "react";
import { minorToText } from "../expenses/money.js";
import { card, failureMessage, input, primaryButton, secondaryButton } from "../groups/ui.js";
import { t } from "../i18n/messages.js";

export interface ConfirmTarget {
  payerName: string;
  receiverName: string;
  /** The planned or recorded amount, offered first. */
  suggested: number;
  /** What the payer still owes this receiver; a partial payment is 1 up to this. */
  max: number;
}

/**
 * Screen 18 as amended (decision 12): the receiver (or an Admin) confirms a payment, and may
 * lower the amount to what was actually received; the rest stays a debt.
 */
export function ConfirmSettlementDialog({
  trigger,
  target,
  currency,
  submit,
}: {
  trigger: string;
  target: ConfirmTarget;
  currency: CurrencyCode;
  /** Sends the confirmed amount; resolves once saved, rejects with the API failure. */
  submit: (amount: number) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setFormKey((key) => key + 1);
        setOpen(next);
      }}
    >
      <Dialog.Trigger className="rounded-full bg-sprout-500 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-sprout-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sprout-600">
        {trigger}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="settlement-dialog-overlay fixed inset-0 z-20 bg-ink/40" />
        <Dialog.Content className="settlement-dialog-content fixed inset-x-4 top-1/2 z-30 mx-auto flex max-w-md -translate-y-1/2 flex-col gap-4 rounded-3xl bg-white p-6 text-ink">
          <ConfirmForm
            key={formKey}
            target={target}
            currency={currency}
            submit={submit}
            onDone={() => {
              setOpen(false);
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ConfirmForm({
  target,
  currency,
  submit,
  onDone,
}: {
  target: ConfirmTarget;
  currency: CurrencyCode;
  submit: (amount: number) => Promise<unknown>;
  onDone: () => void;
}) {
  const [text, setText] = useState(minorToText(target.suggested, currency));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const parsed = parseAmount(text.trim(), currency);
  const amount = parsed.ok ? parsed.value : null;
  const valid = amount !== null && amount >= 1 && amount <= target.max;

  const onSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setFailure(null);
    submit(amount).then(onDone, (error: unknown) => {
      setFailure(error);
      setBusy(false);
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <span className="mx-auto flex size-20 items-center justify-center rounded-full bg-peach text-sprout-600">
        <HandCoins aria-hidden="true" className="size-9" />
      </span>
      <Dialog.Title className="text-center text-xl font-bold">
        {t("settle.confirm.title")}
      </Dialog.Title>
      <Dialog.Description className="text-center text-sm text-ink-muted">
        {t("settle.confirm.body")}
      </Dialog.Description>
      <div className={`${card} grid grid-cols-[1fr_auto_1fr] items-center gap-2 p-4`}>
        <span className="flex flex-col">
          <span className="text-xs text-ink-muted">{t("settle.payer")}</span>
          <span className="truncate font-bold">{target.payerName}</span>
        </span>
        <ArrowRight aria-hidden="true" className="size-5 text-sprout-500" />
        <span className="flex flex-col">
          <span className="text-xs text-ink-muted">{t("settle.receiver")}</span>
          <span className="truncate font-bold">{target.receiverName}</span>
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="confirm-settlement-amount" className="text-sm font-bold">
          {t("settle.confirm.amount", { currency })}
        </label>
        <input
          id="confirm-settlement-amount"
          inputMode="decimal"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
          aria-invalid={!valid}
          className={`${input} text-xl font-bold`}
        />
        <span className={`text-sm ${valid ? "text-ink-muted" : "text-red-700"}`}>
          {t("settle.confirm.max", { amount: formatAmount(target.max, currency) })}
        </span>
      </div>
      {failure !== null && (
        <p role="alert" className="text-red-700">
          {failureMessage(failure)}
        </p>
      )}
      <button type="submit" disabled={!valid || busy} className={`${primaryButton} py-3`}>
        {t("settle.confirm.submit")}
      </button>
      <Dialog.Close type="button" className={`${secondaryButton} py-3`}>
        {t("settle.confirm.wait")}
      </Dialog.Close>
    </form>
  );
}
