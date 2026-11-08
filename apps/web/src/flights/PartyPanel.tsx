import { partyOf, type FlightCabin, FLIGHT_CABINS, type FlightSearchIntent } from "@split/shared";
import { useId, useState } from "react";
import { t } from "../i18n/messages.js";

export interface Party {
  adults: number;
  children: number;
  cabin: FlightCabin;
  oneWay: boolean;
}

export const MAX_PARTY = 9;

export const toParty = (intent: FlightSearchIntent): Party => {
  const { adults, children, cabin, oneWay } = partyOf(intent);
  return { adults, children, cabin, oneWay };
};

/** "2 adults, 1 child" in the current language. */
export function whoText(adults: number, children: number): string {
  const adultText = adults === 1 ? t("flight.adultOne") : t("flight.adultCount", { n: adults });
  if (children === 0) return adultText;
  const childText = children === 1 ? t("flight.childOne") : t("flight.childCount", { n: children });
  return `${adultText}, ${childText}`;
}

export const cabinText = (cabin: FlightCabin) => t(`flight.cabin.${cabin}`);
export const tripText = (oneWay: boolean) => t(oneWay ? "flight.oneWay" : "flight.roundTrip");

// No colour transitions in Travel: press-pill carries only the press transform.
const stepButton =
  "press-pill grid size-11 shrink-0 place-items-center rounded-full border-[1.5px] border-sprout-700 bg-white text-xl leading-none font-bold text-sprout-900 hover:bg-sprout-100 focus-visible:outline-2 focus-visible:outline-sprout-700 disabled:cursor-not-allowed disabled:border-travel-disabled-ink disabled:bg-travel-disabled disabled:text-travel-disabled-ink";
const choice =
  "press-pill flex min-h-11 cursor-pointer items-center justify-center rounded-full border-[1.5px] border-sprout-700 bg-white px-3 text-center text-sm font-bold text-sprout-900 hover:bg-sprout-100 peer-checked:bg-travel-action peer-checked:text-white peer-checked:hover:bg-travel-action-hover peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-sprout-900";

function Stepper({
  label,
  value,
  min,
  canAdd,
  more,
  less,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  canAdd: boolean;
  more: string;
  less: string;
  onChange: (value: number) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center justify-between gap-3">
      <span className="min-w-0 text-sm font-bold">{label}</span>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          aria-label={less}
          disabled={value <= min}
          onClick={() => {
            onChange(value - 1);
          }}
          className={stepButton}
        >
          <span aria-hidden="true">−</span>
        </button>
        <span aria-live="polite" className="min-w-8 text-center text-lg font-black tabular-nums">
          {value}
        </span>
        <button
          type="button"
          aria-label={more}
          disabled={!canAdd}
          onClick={() => {
            onChange(value + 1);
          }}
          className={stepButton}
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>
    </div>
  );
}

function Choices<T extends string>({
  label,
  name,
  options,
  value,
  onChange,
}: {
  label: string;
  name: string;
  options: { value: T; text: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="grid min-w-0 gap-2">
      <legend className="mb-2 text-sm font-bold">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        {options.map((option) => (
          <label key={option.value} className="relative grid">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => {
                onChange(option.value);
              }}
              className="peer sr-only"
            />
            <span className={choice}>{option.text}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * One panel for adults, children, cabin and trip type, opened from a summary row that always shows
 * the current choice. Infants are not offered: the flight source prices them unreliably.
 */
export function PartyPanel({
  value,
  onChange,
}: {
  value: Party;
  onChange: (patch: Partial<Party>) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const full = value.adults + value.children >= MAX_PARTY;
  return (
    <div className="grid gap-3 sm:col-span-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpen((o) => !o);
        }}
        className="press-pill flex min-h-12 w-full min-w-0 items-center justify-between gap-3 rounded-2xl border border-sprout-200 bg-white px-4 py-2 text-left hover:bg-sprout-100 focus-visible:outline-2 focus-visible:outline-sprout-700"
      >
        <span className="grid min-w-0 gap-0.5">
          <span className="text-xs font-bold text-ink-muted">{t("flight.party")}</span>
          <span className="text-sm font-bold break-words">
            {t("flight.partySummary", {
              who: whoText(value.adults, value.children),
              cabin: cabinText(value.cabin),
              trip: tripText(value.oneWay),
            })}
          </span>
        </span>
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-5 shrink-0 fill-none stroke-sprout-900 stroke-[2.2] [stroke-linecap:round] [stroke-linejoin:round]"
        >
          <path d={open ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
        </svg>
      </button>
      {open && (
        <div id={id} className="grid gap-4 rounded-2xl border border-sprout-200 bg-sprout-50 p-4">
          <Choices
            label={t("flight.tripType")}
            name="tripType"
            value={value.oneWay ? "one-way" : "round-trip"}
            options={[
              { value: "round-trip", text: t("flight.roundTrip") },
              { value: "one-way", text: t("flight.oneWay") },
            ]}
            onChange={(trip) => {
              onChange({ oneWay: trip === "one-way" });
            }}
          />
          <Stepper
            label={t("flight.adults")}
            value={value.adults}
            min={1}
            canAdd={!full}
            more={t("flight.adultsMore")}
            less={t("flight.adultsLess")}
            onChange={(adults) => {
              onChange({ adults });
            }}
          />
          <Stepper
            label={t("flight.children")}
            value={value.children}
            min={0}
            canAdd={!full}
            more={t("flight.childrenMore")}
            less={t("flight.childrenLess")}
            onChange={(children) => {
              onChange({ children });
            }}
          />
          {full && <p className="text-xs font-medium text-ink-muted">{t("flight.partyMax")}</p>}
          <Choices
            label={t("flight.cabin")}
            name="cabin"
            value={value.cabin}
            options={FLIGHT_CABINS.map((cabin) => ({ value: cabin, text: cabinText(cabin) }))}
            onChange={(cabin) => {
              onChange({ cabin });
            }}
          />
        </div>
      )}
    </div>
  );
}
