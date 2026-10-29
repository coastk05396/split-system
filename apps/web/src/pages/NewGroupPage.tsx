import { CURRENCY_CODES, type CurrencyCode } from "@split/shared";
import { ArrowRight, Plane, ReceiptText, Users } from "lucide-react";
import { type SubmitEvent, type ReactNode, useId, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useCreateGroup } from "../groups/api.js";
import { failureMessage, input, primaryButton, ScreenHeader } from "../groups/ui.js";
import { type MessageId, t } from "../i18n/messages.js";

function isCurrency(value: string): value is CurrencyCode {
  return (CURRENCY_CODES as readonly string[]).includes(value);
}

/**
 * Screen 6 as amended: name, usage (Running Tab or Trip), the Settlement currency (fixed
 * after the first Expense) and a default Expense currency. Then on to the Invite.
 */
export function NewGroupPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const create = useCreateGroup();
  const [name, setName] = useState("");
  const [isTrip, setIsTrip] = useState(params.get("usage") === "trip");
  const [settlementCurrency, setSettlementCurrency] = useState<CurrencyCode>("TWD");
  const [defaultExpenseCurrency, setDefaultExpenseCurrency] = useState<CurrencyCode>("TWD");

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    create.mutate(
      { name: name.trim(), isTrip, settlementCurrency, defaultExpenseCurrency },
      { onSuccess: (group) => void navigate(`/groups/${group.id}/invite`, { replace: true }) },
    );
  }

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-6">
      <ScreenHeader title={t("create.title")} back="/groups" subtitle={t("create.subtitle")} />
      <label className="flex flex-col gap-2">
        <span className="font-bold">{t("create.name")}</span>
        <input
          value={name}
          maxLength={60}
          placeholder={t("create.namePlaceholder")}
          onChange={(e) => {
            setName(e.target.value);
          }}
          className={input}
        />
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-bold">{t("create.usage")}</legend>
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-sprout-150 p-1">
          <UsageOption
            label="usage.tab"
            icon={<ReceiptText aria-hidden="true" className="size-5" />}
            checked={!isTrip}
            onCheck={() => {
              setIsTrip(false);
            }}
          />
          <UsageOption
            label="usage.trip"
            icon={<Plane aria-hidden="true" className="size-5" />}
            checked={isTrip}
            onCheck={() => {
              setIsTrip(true);
            }}
          />
        </div>
      </fieldset>
      <CurrencySelect
        label="create.settlementCurrency"
        hint={t("create.settlementHint")}
        value={settlementCurrency}
        onChange={setSettlementCurrency}
      />
      <CurrencySelect
        label="create.defaultExpenseCurrency"
        value={defaultExpenseCurrency}
        onChange={setDefaultExpenseCurrency}
      />
      <div className="flex flex-col items-center gap-2 rounded-3xl bg-sprout-150 p-6 text-center">
        <Users aria-hidden="true" className="size-10 text-sprout-500" />
        <p className="font-bold">{t("create.invite.title")}</p>
        <p className="text-sm text-ink-muted">{t("create.invite.body")}</p>
      </div>
      {create.isError && (
        <p role="alert" className="text-red-700">
          {failureMessage(create.error)}
        </p>
      )}
      <button
        type="submit"
        disabled={name.trim() === "" || create.isPending}
        className={`${primaryButton} justify-between`}
      >
        {t("create.submit")}
        <ArrowRight aria-hidden="true" className="size-5" />
      </button>
    </form>
  );
}

function UsageOption(props: {
  label: MessageId;
  icon: ReactNode;
  checked: boolean;
  onCheck: () => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl py-3 has-focus-visible:ring-2 has-focus-visible:ring-sprout-500 ${
        props.checked ? "bg-white font-bold text-ink shadow-sm" : "text-ink-muted"
      }`}
    >
      <input
        type="radio"
        name="usage"
        checked={props.checked}
        onChange={props.onCheck}
        className="sr-only"
      />
      {props.icon}
      {t(props.label)}
    </label>
  );
}

function CurrencySelect(props: {
  label: MessageId;
  hint?: string;
  value: CurrencyCode;
  onChange: (value: CurrencyCode) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-bold">
        {t(props.label)}
      </label>
      <select
        id={id}
        aria-describedby={props.hint === undefined ? undefined : `${id}-hint`}
        value={props.value}
        onChange={(e) => {
          if (isCurrency(e.target.value)) props.onChange(e.target.value);
        }}
        className={input}
      >
        {CURRENCY_CODES.map((code) => (
          <option key={code} value={code}>
            {t(`currency.${code}`)}
          </option>
        ))}
      </select>
      {props.hint !== undefined && (
        <span id={`${id}-hint`} className="text-sm text-ink-muted">
          {props.hint}
        </span>
      )}
    </div>
  );
}
