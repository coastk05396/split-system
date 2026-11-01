import type { SVGProps } from "react";

/**
 * Cute Quick Receipt Icon: Chubby mini receipt notepad with scalloped wavy bottom edge
 * and a cute sprout golden seal stamp.
 */
export function CuteQuickReceiptIcon({
  className = "size-8",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} {...props}>
      <defs>
        <linearGradient id="quick-receipt-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#fff6f0" />
        </linearGradient>
      </defs>
      {/* Soft warm shadow */}
      <path
        d="M6 5.5A2.5 2.5 0 0 1 8.5 3h15A2.5 2.5 0 0 1 26 5.5v22l-2.5-1.5-2.5 1.5-2.5-1.5-2.5 1.5-2.5-1.5-2.5 1.5-2.5-1.5L6 27.5V5.5z"
        fill="#fed7aa"
        opacity="0.45"
        transform="translate(1, 1)"
      />
      {/* Receipt body with scalloped bottom edge */}
      <path
        d="M6 5.5A2.5 2.5 0 0 1 8.5 3h15A2.5 2.5 0 0 1 26 5.5v22l-2.5-1.5-2.5 1.5-2.5-1.5-2.5 1.5-2.5-1.5-2.5 1.5-2.5-1.5L6 27.5V5.5z"
        fill="url(#quick-receipt-bg)"
        stroke="#2e9d71"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* Header solid accent line */}
      <path d="M10 8h12" stroke="#2e9d71" strokeWidth="2" strokeLinecap="round" />
      {/* Dotted / dashed item lines */}
      <path d="M10 12.5h8" stroke="#5fcf9f" strokeWidth="2" strokeLinecap="round" />
      <path d="M10 16.5h6" stroke="#5fcf9f" strokeWidth="2" strokeLinecap="round" />
      {/* Round sprout golden stamp on bottom right */}
      <g transform="translate(17.5, 17.5)">
        <circle cx="4.5" cy="4.5" r="4.5" fill="#fef08a" stroke="#eab308" strokeWidth="1.2" />
        <path
          d="M4.5 6.8V4.5M4.5 4.5c-.8-1-2-.8-1.8.3.1 1 1.8 1 1.8-.3zm0 0c.8-1 2-.8 1.8.3-.1 1-1.8 1-1.8-.3z"
          fill="#16a34a"
          stroke="#16a34a"
          strokeWidth="0.8"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

/**
 * Cute Trip Plane Icon: Chubby cartoon airplane climbing towards adventure with soft fluffy clouds.
 */
export function CuteTripPlaneIcon({
  className = "size-8",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} {...props}>
      <defs>
        <linearGradient id="cloud-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#e0f2fe" />
        </linearGradient>
        <linearGradient id="plane-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#f0fdf4" />
        </linearGradient>
      </defs>
      {/* Soft fluffy cloud floating beneath */}
      <path
        d="M7 26a4 4 0 0 1-1-7.8 5 5 0 0 1 9.5-1.7 4 4 0 0 1 6.5 3.5 4 4 0 0 1-2 7H7z"
        fill="url(#cloud-grad)"
        stroke="#7dd3fc"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Mini cloud fluff accent */}
      <path
        d="M23 26a2.5 2.5 0 0 0 2-4 3 3 0 0 0-4.5-1"
        stroke="#bae6fd"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      {/* Chubby cartoon airplane flying up-right */}
      <g transform="translate(10, 4) rotate(16)">
        {/* Back wing */}
        <path
          d="M4 11l-3 4h4l2-4"
          fill="#86efac"
          stroke="#2e9d71"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        {/* Chubby fuselage */}
        <rect
          x="2"
          y="6.5"
          width="13"
          height="7.5"
          rx="3.75"
          fill="url(#plane-grad)"
          stroke="#2e9d71"
          strokeWidth="1.8"
        />
        {/* Round cockpit window */}
        <ellipse
          cx="12"
          cy="10.25"
          rx="2"
          ry="1.8"
          fill="#38bdf8"
          stroke="#0284c7"
          strokeWidth="1"
        />
        {/* Main wing */}
        <path
          d="M6 10l-2 5a1 1 0 0 0 1 1.2h4.5a1 1 0 0 0 .9-.6l2.1-5.6"
          fill="#4ade80"
          stroke="#2e9d71"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        {/* Tail fin */}
        <path
          d="M3 6.5l-1.5-3a.8.8 0 0 1 .7-1.2h2.2c.4 0 .7.3.8.6l1 3.6"
          fill="#4ade80"
          stroke="#2e9d71"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        {/* Eye-catching window shine */}
        <circle cx="12.6" cy="9.6" r="0.6" fill="#ffffff" />
      </g>
    </svg>
  );
}
