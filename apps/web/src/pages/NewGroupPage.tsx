import { CURRENCY_CODES, type CurrencyCode } from "@split/shared";
import { ArrowRight } from "lucide-react";
import { type SubmitEvent, useId, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../auth/AuthProvider.js";
import { useCreateGroup } from "../groups/api.js";
import {
  failureMessage,
  GROUP_PALETTES,
  GroupAvatar,
  input,
  primaryButton,
  Progress,
  useLeaveBlock,
  ScreenHeader,
} from "../groups/ui.js";
import { type MessageId, t } from "../i18n/messages.js";
import { SproutMascot } from "../shell/SproutMascot.js";

function isCurrency(value: string): value is CurrencyCode {
  return (CURRENCY_CODES as readonly string[]).includes(value);
}

/**
 * Screen 6 as amended: name and the Settlement currency (fixed after the first Expense),
 * which starts at the User's Preferred currency. Then on to Members and Invite.
 */
export function NewGroupPage() {
  const navigate = useNavigate();
  const create = useCreateGroup();
  const leave = useLeaveBlock(create.isPending);
  const { state } = useAuth();
  const [name, setName] = useState("");
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [diceRolling, setDiceRolling] = useState(false);
  const [settlementCurrency, setSettlementCurrency] = useState<CurrencyCode>(
    state.status === "signedIn" ? state.user.preferredCurrency : "TWD",
  );

  function rollPalette() {
    setPaletteIndex((prev) => (prev + 1) % GROUP_PALETTES.length);
    setDiceRolling(true);
    setTimeout(() => {
      setDiceRolling(false);
    }, 400);
  }

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    create.mutate(
      { name: name.trim(), isTrip: false, settlementCurrency },
      {
        onSuccess: (group) => {
          leave();
          void navigate(`/groups/${group.id}/members`, { replace: true, state: { created: true } });
        },
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-4">
      {create.isPending && (
        <Progress
          message={t("create.progress")}
          onLeave={() => {
            leave();
            void navigate("/groups");
          }}
        />
      )}
      <ScreenHeader title={t("create.title")} back="/groups" compact={true} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="group-name-input" className="font-bold">
          {t("create.name")}
        </label>
        <div className="flex items-center gap-3">
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={rollPalette}
              aria-label="隨機換色"
              title="隨機換色"
              className="group flex items-center justify-center rounded-2xl p-0.5 focus-visible:outline-2 focus-visible:outline-sprout-600"
            >
              <GroupAvatar
                name={name}
                paletteIndex={paletteIndex}
                className="size-12 rounded-2xl text-lg shadow-2xs transition-[scale] duration-300 ease-(--ease-spring) group-hover:scale-105 group-active:scale-95"
                interactive={false}
              />
            </button>
            <button
              type="button"
              onClick={rollPalette}
              aria-label="隨機換色"
              title="隨機換色"
              className={`absolute -bottom-1 -right-1 flex size-5.5 items-center justify-center rounded-full border border-sprout-200 bg-white text-xs shadow-xs transition-transform duration-300 ease-(--ease-spring) hover:scale-115 active:scale-90 ${
                diceRolling ? "rotate-[360deg] scale-110" : ""
              }`}
            >
              <span aria-hidden="true">🎲</span>
            </button>
          </div>
          <input
            id="group-name-input"
            value={name}
            maxLength={60}
            placeholder={t("create.namePlaceholder")}
            onChange={(e) => {
              setName(e.target.value);
            }}
            className={`${input} flex-1`}
          />
        </div>
      </div>
      <CurrencySelect
        label="create.settlementCurrency"
        hint={t("create.settlementHint")}
        value={settlementCurrency}
        onChange={setSettlementCurrency}
      />
      <div className="surface-card flex flex-col items-center gap-2 rounded-3xl border border-sprout-200/80 bg-gradient-to-b from-sprout-100/90 to-sprout-50/70 p-5 text-center shadow-2xs">
        <SproutMascot className="-mb-1 size-14" mood="happy" />
        <p className="font-bold text-ink">{t("create.invite.title")}</p>
        <p className="max-w-xs text-xs text-ink-muted">{t("create.invite.body")}</p>
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
