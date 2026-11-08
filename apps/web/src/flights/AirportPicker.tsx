import { FLIGHT_DESTINATIONS, FLIGHT_ORIGINS } from "@split/shared";
import { useId, useState, type KeyboardEvent } from "react";
import { input } from "../groups/ui.js";
import { getLocale, t } from "../i18n/messages.js";

interface Airport {
  code: string;
  en: string;
  zhTW: string;
}

const AIRPORTS: readonly Airport[] = [...FLIGHT_ORIGINS, ...FLIGHT_DESTINATIONS].map((a) => ({
  code: a.airport,
  en: a.en,
  zhTW: a.zhTW,
}));
const CODE = /^[A-Za-z]{3}$/;
const RECENT_KEY = "split.flightRecentAirports";

export const POPULAR_ORIGINS: readonly string[] = FLIGHT_ORIGINS.map((a) => a.airport);
export const POPULAR_DESTINATIONS: readonly string[] = ["NRT", "KIX", "OKA", "ICN", "BKK", "HKG"];

function find(code: string): Airport {
  return AIRPORTS.find((a) => a.code === code) ?? { code, en: code, zhTW: code };
}

/** The airport's name in the current language; an unknown airport is its own code. */
export function airportName(code: string): string {
  const airport = find(code);
  return getLocale() === "en" ? airport.en : airport.zhTW;
}

function label(code: string): string {
  const airport = AIRPORTS.find((a) => a.code === code);
  if (!airport) return code;
  return `${getLocale() === "en" ? airport.en : airport.zhTW} (${code})`;
}

function match(query: string): Airport[] {
  const q = query.trim().toLowerCase();
  const fields = (a: Airport) => [a.code.toLowerCase(), a.en.toLowerCase(), a.zhTW.toLowerCase()];
  return AIRPORTS.filter((a) => fields(a).some((f) => f.includes(q))).sort(
    (a, b) =>
      Number(!fields(a).some((f) => f.startsWith(q))) -
      Number(!fields(b).some((f) => f.startsWith(q))),
  );
}

/** Airports this browser searched most recently for one field, newest first; holds codes only. */
function readRecent(field: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(`${RECENT_KEY}.${field}`) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((c): c is string => typeof c === "string" && /^[A-Z]{3}$/.test(c)).slice(0, 4)
      : [];
  } catch {
    return [];
  }
}

export function rememberAirports(fields: Readonly<Record<string, string>>): void {
  try {
    for (const [field, code] of Object.entries(fields)) {
      const next = [...new Set([code, ...readRecent(field)])].slice(0, 4);
      localStorage.setItem(`${RECENT_KEY}.${field}`, JSON.stringify(next));
    }
  } catch {
    // Storage can be blocked; recents are a convenience only.
  }
}

/**
 * An accessible combobox over the airport catalog. The field shows the chosen airport's name; a
 * well-formed three-letter code is accepted even when the catalog does not list it.
 */
export function AirportPicker({
  name,
  text,
  value,
  popular,
  className = "",
  onChange,
}: {
  name: string;
  text: string;
  value: string;
  popular: readonly string[];
  /** Grid placement inside the form. */
  className?: string;
  onChange: (code: string) => void;
}) {
  const id = useId();
  // `forValue` ties typed text to the value it produced, so a swap or new search shows the label.
  const [typed, setTyped] = useState<{ text: string; forValue: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const query = typed?.forValue === value ? typed.text : null;
  const shown = query ?? label(value);

  const recent = readRecent(name);
  const groups =
    query === null || query.trim() === ""
      ? [
          { heading: "flight.airportRecent" as const, codes: recent },
          {
            heading: "flight.airportPopular" as const,
            codes: popular.filter((c) => !recent.includes(c)),
          },
        ].filter((g) => g.codes.length > 0)
      : [{ heading: null, codes: match(query).map((a) => a.code) }];
  const options = groups.flatMap((g) => g.codes);

  function pick(code: string) {
    onChange(code);
    setTyped(null);
    setOpen(false);
    setActive(-1);
  }
  /** A typed, well-formed code waiting for Enter or blur (a catalog code commits as it is typed). */
  const pendingCode = query !== null && CODE.test(query) ? query.toUpperCase() : null;
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      const down = event.key === "ArrowDown";
      const last = options.length - 1;
      setActive((i) => (down ? (i >= last ? 0 : i + 1) : i <= 0 ? last : i - 1));
    } else if (event.key === "Enter" && open && options[active] !== undefined) {
      event.preventDefault();
      pick(options[active]);
    } else if (event.key === "Enter" && pendingCode !== null && pendingCode !== value) {
      event.preventDefault();
      pick(pendingCode);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className={`relative min-w-0 ${className}`}>
      <label className="grid gap-1 text-sm font-bold">
        {text}
        <input
          className={input}
          name={name}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={label(value)}
          value={shown}
          onFocus={() => {
            setTyped({ text: "", forValue: value });
            setOpen(true);
            setActive(-1);
          }}
          onClick={() => {
            setOpen(true);
          }}
          onBlur={() => {
            if (pendingCode !== null) onChange(pendingCode);
            setTyped(null);
            setOpen(false);
          }}
          onKeyDown={keyDown}
          onChange={(event) => {
            const next = event.target.value;
            const listed = CODE.test(next) && AIRPORTS.some((a) => a.code === next.toUpperCase());
            setTyped({ text: next, forValue: listed ? next.toUpperCase() : value });
            if (listed) onChange(next.toUpperCase());
            setOpen(true);
            setActive(-1);
          }}
        />
      </label>
      {open && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label={t("flight.airportSuggestions")}
          className="absolute inset-x-0 top-full z-20 mt-2 max-h-72 overflow-auto rounded-2xl border border-sprout-200 bg-white p-2 shadow-lg"
        >
          {options.length === 0 && (
            <li role="presentation" className="p-3 text-sm font-normal text-ink-muted">
              {t("flight.airportNone")}
            </li>
          )}
          {groups.map((group) => (
            <li key={group.heading ?? "matches"} role="presentation">
              {group.heading && (
                <p className="px-3 pt-2 pb-1 text-xs font-bold tracking-wide text-ink-muted">
                  {t(group.heading)}
                </p>
              )}
              <ul role="presentation">
                {group.codes.map((code) => {
                  const index = options.indexOf(code);
                  const airport = find(code);
                  return (
                    <li
                      key={code}
                      id={`${id}-${index}`}
                      role="option"
                      aria-selected={index === active}
                      onMouseDown={(event) => {
                        event.preventDefault();
                      }}
                      onClick={() => {
                        pick(code);
                      }}
                      className={`grid min-h-11 cursor-pointer grid-cols-[3rem_1fr] items-center gap-2 rounded-xl px-3 py-2 text-sm font-normal ${index === active ? "bg-sprout-100" : "hover:bg-sprout-50"}`}
                    >
                      <b className="text-sprout-700">{code}</b>
                      <span>
                        {airport.zhTW}
                        <small className="block text-ink-muted">{airport.en}</small>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
