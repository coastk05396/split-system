import { partyOf, type FlightCabin, FLIGHT_CABINS, type FlightSearchIntent } from "@split/shared";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n/messages.js";

export interface Party {
  adults: number;
  children: number;
  infants: number;
  cabin: FlightCabin;
  oneWay: boolean;
}

export const MAX_PARTY = 9;

export const toParty = (intent: FlightSearchIntent): Party => {
  const { adults, children, infants, cabin, oneWay } = partyOf(intent);
  return { adults, children, infants, cabin, oneWay };
};

/** "2 adults, 1 child, 1 infant" in the current language; absent groups are left out. */
export function whoText(adults: number, children: number, infants = 0): string {
  return [
    adults === 1 ? t("flight.adultOne") : t("flight.adultCount", { n: adults }),
    children === 0
      ? ""
      : children === 1
        ? t("flight.childOne")
        : t("flight.childCount", { n: children }),
    infants === 0
      ? ""
      : infants === 1
        ? t("flight.infantOne")
        : t("flight.infantCount", { n: infants }),
  ]
    .filter(Boolean)
    .join(", ");
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
  hideLabel = false,
  name,
  options,
  value,
  onChange,
}: {
  label: string;
  /** The legend stays for assistive tech only (the pills say it all). */
  hideLabel?: boolean;
  name: string;
  options: { value: T; text: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="grid min-w-0 gap-2">
      <legend className={hideLabel ? "sr-only" : "mb-2 text-sm font-bold"}>{label}</legend>
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

/** Round trip or one way, outside the sheet: it decides whether the calendar picks a range. */
export function TripToggle({
  oneWay,
  onChange,
}: {
  oneWay: boolean;
  onChange: (oneWay: boolean) => void;
}) {
  return (
    <div className="sm:col-span-2">
      <Choices
        label={t("flight.tripType")}
        hideLabel
        name="tripType"
        value={oneWay ? "one-way" : "round-trip"}
        options={[
          { value: "round-trip", text: t("flight.roundTrip") },
          { value: "one-way", text: t("flight.oneWay") },
        ]}
        onChange={(trip) => {
          onChange(trip === "one-way");
        }}
      />
    </div>
  );
}

const FOCUSABLE = "button:not(:disabled), input:not(:disabled)";

/**
 * Adults, children, infants and cabin in a full-screen dialog (focus moves in and is trapped,
 * Escape or Done closes). Infants never exceed adults and everyone together is at most nine; the
 * infant note says why the shown price leaves them out.
 */
function PartySheet({
  value,
  onChange,
  onClose,
}: {
  value: Party;
  onChange: (patch: Partial<Party>) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, []);
  const full = value.adults + value.children + value.infants >= MAX_PARTY;
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const [first, last] = [items[0], items.at(-1)];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
  return createPortal(
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={t("flight.party")}
      onKeyDown={keyDown}
      className="party-sheet fixed inset-0 z-[70] overflow-y-auto overscroll-contain bg-sprout-50 px-[18px] pt-[max(3rem,env(safe-area-inset-top))] pb-6 text-sprout-900"
    >
      <div className="mx-auto grid max-w-md gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-black">{t("flight.party")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="press-pill min-h-11 rounded-full bg-travel-action px-5 text-sm font-bold text-white hover:bg-travel-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sprout-900"
          >
            {t("flight.partyDone")}
          </button>
        </div>
        <div className="grid gap-4 py-2">
          <Stepper
            label={t("flight.adults")}
            value={value.adults}
            min={Math.max(1, value.infants)}
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
          <Stepper
            label={t("flight.infants")}
            value={value.infants}
            min={0}
            canAdd={!full && value.infants < value.adults}
            more={t("flight.infantsMore")}
            less={t("flight.infantsLess")}
            onChange={(infants) => {
              onChange({ infants });
            }}
          />
          {full && <p className="text-xs font-medium text-ink-muted">{t("flight.partyMax")}</p>}
          {!full && value.infants >= value.adults && (
            <p className="text-xs font-medium text-ink-muted">{t("flight.infantLimit")}</p>
          )}
          {value.infants > 0 && (
            <p className="text-xs font-bold text-ink-muted">{t("flight.infantNote")}</p>
          )}
        </div>
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
    </div>,
    document.body,
  );
}

/** A summary row of the current party and cabin; tapping it opens the sheet and Done returns here. */
export function PartyPanel({
  value,
  onChange,
}: {
  value: Party;
  onChange: (patch: Partial<Party>) => void;
}) {
  const [open, setOpen] = useState(false);
  const row = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    row.current?.focus();
  };
  return (
    <div className="grid gap-3 sm:col-span-2">
      <button
        ref={row}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen(true);
        }}
        className="press-pill flex min-h-12 w-full min-w-0 items-center justify-between gap-3 rounded-2xl border border-sprout-200 bg-white px-4 py-2 text-left hover:bg-sprout-100 focus-visible:outline-2 focus-visible:outline-sprout-700"
      >
        <span className="grid min-w-0 gap-0.5">
          <span className="text-xs font-bold text-ink-muted">{t("flight.party")}</span>
          <span className="text-sm font-bold break-words">
            {t("flight.partySummary", {
              who: whoText(value.adults, value.children, value.infants),
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
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      {open && <PartySheet value={value} onChange={onChange} onClose={close} />}
    </div>
  );
}
