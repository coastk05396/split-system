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

// No colour transitions in Travel; the 44 px target is the .fr-hit pseudo-element around the mock-sized button.
const stepButton = "fr-hit";

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
    <div role="group" aria-label={label} className="fr-pr">
      <span className="min-w-0">{label}</span>
      <div className="fr-pax">
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
        <b aria-live="polite">{value}</b>
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
  variant,
  name,
  options,
  value,
  onChange,
}: {
  label: string;
  /** The legend stays for assistive tech only (the pills say it all). */
  hideLabel?: boolean;
  /** `seg` is the trip switch, `cabins` the two-by-two cabin grid. */
  variant: "seg" | "cabins";
  name: string;
  options: { value: T; text: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className={variant === "seg" ? "fr-opts" : "min-w-0"}>
      <legend className={hideLabel ? "sr-only" : "fr-lb"}>{label}</legend>
      <div className={variant === "seg" ? "fr-seg" : "fr-cabins"}>
        {options.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => {
                onChange(option.value);
              }}
              className="sr-only"
            />
            <span className={variant === "seg" ? "fr-hit" : undefined}>{option.text}</span>
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
    <div>
      <Choices
        label={t("flight.tripType")}
        hideLabel
        variant="seg"
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
/** Tab stops in DOM order: a radio group is one stop, its checked radio. */
const tabStops = (root: HTMLElement | null) =>
  Array.from(root?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
    (e) => !(e instanceof HTMLInputElement && e.type === "radio" && !e.checked),
  );

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
    tabStops(dialog.current)[0]?.focus();
  }, []);
  const full = value.adults + value.children + value.infants >= MAX_PARTY;
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const items = tabStops(dialog.current);
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
      className="party-sheet fr-sheet fixed inset-0 z-[70] overflow-y-auto overscroll-contain text-sprout-900"
    >
      <div className="mx-auto grid max-w-md gap-2">
        <div className="fr-shh">
          <h2 className="font-semibold">{t("flight.party")}</h2>
          <button type="button" onClick={onClose} className="fr-shx fr-hit">
            {t("flight.partyDone")}
          </button>
        </div>
        <div className="fr-paxes">
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
          variant="cabins"
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
    <div>
      <button
        ref={row}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen(true);
        }}
        className="fr-sumr fr-hit"
      >
        <span className="min-w-0">
          <small>{t("flight.party")}</small>
          <b className="break-words">
            {t("flight.partySummary", {
              who: whoText(value.adults, value.children, value.infants),
              cabin: cabinText(value.cabin),
              trip: tripText(value.oneWay),
            })}
          </b>
        </span>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      {open && <PartySheet value={value} onChange={onChange} onClose={close} />}
    </div>
  );
}
