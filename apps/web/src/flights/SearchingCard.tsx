import { t } from "../i18n/messages.js";
import { prefersReducedMotion } from "../shell/motion.js";
import { airportName } from "./AirportPicker.js";

const ARC = "M16 66 Q155 -22 294 66";

/**
 * What the Travel page shows while a search runs: a flight arc drawing itself between the two
 * airports with a plane flying along it, the words 搜尋航班 as a wave of brightness, and status
 * lines that take turns. Reduced motion shows the same card standing still.
 */
export function SearchingCard({ origin, destination }: { origin: string; destination: string }) {
  const still = prefersReducedMotion();
  return (
    <div className="sc" data-motion={still ? "reduced" : "full"}>
      <svg viewBox="0 0 310 84" fill="none" aria-hidden="true" className="sc-arc">
        <path
          d={ARC}
          stroke="#cfe6d6"
          strokeWidth="2"
          strokeDasharray="3 5"
          strokeLinecap="round"
        />
        <path
          className="sc-draw"
          d={ARC}
          pathLength="100"
          stroke="#2e9d71"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <circle className="sc-rp" cx="16" cy="66" r="5" fill="#2e9d71" />
        <circle
          className="sc-rp"
          cx="294"
          cy="66"
          r="5"
          fill="#2e9d71"
          style={{ animationDelay: ".95s" }}
        />
        <circle cx="16" cy="66" r="4.5" fill="#245b41" />
        <circle cx="294" cy="66" r="4.5" fill="#245b41" />
        <g transform={still ? "translate(16 66)" : undefined}>
          <path d="M-9 -8L11 0L-9 8L-4 0Z" fill="#245b41" />
          {!still && (
            <animateMotion
              dur="1.9s"
              repeatCount="indefinite"
              path={ARC}
              rotate="auto"
              calcMode="spline"
              keyTimes="0;1"
              keySplines=".4 0 .2 1"
            />
          )}
        </g>
      </svg>
      <div className="sc-ends" aria-hidden="true">
        <span>
          {origin} {airportName(origin)}
        </span>
        <span>
          {destination} {airportName(destination)}
        </span>
      </div>
      <p role="status" className="sc-title">
        <span className="sr-only">{t("flight.searching")}</span>
        <span aria-hidden="true">
          {Array.from(t("flight.search")).map((ch, i) => (
            <span
              key={`${String(i)}-${ch}`}
              className="sc-ch"
              style={{ animationDelay: `${String(i * 140)}ms` }}
            >
              {ch}
            </span>
          ))}
          <i className="sc-dot" />
          <i className="sc-dot" style={{ animationDelay: ".2s" }} />
          <i className="sc-dot" style={{ animationDelay: ".4s" }} />
        </span>
      </p>
      <p className="sc-steps" aria-hidden="true">
        {(["searchStep1", "searchStep2", "searchStep3"] as const).map((id, i) => (
          <span key={id} style={{ animationDelay: `${String(i * 2.6)}s` }}>
            {t(`flight.${id}`)}
          </span>
        ))}
      </p>
      <div className="sc-bar" aria-hidden="true">
        <i />
      </div>
    </div>
  );
}
