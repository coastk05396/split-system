import type { SVGProps } from "react";

/**
 * Cute Quick Receipt Icon: Chubby mini receipt notepad with scalloped wavy bottom edge
 * and a cute sprout golden seal stamp.
 */
export function CuteQuickReceiptIcon({ className = "size-8", ...props }: SVGProps<SVGSVGElement>) {
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
 * Cute Trip Plane Icon: Rounded emerald-lined boarding pass & ascending plane emblem
 * matching CuteQuickReceiptIcon's warm white-mint palette and golden sprout seal.
 */
export function CuteTripPlaneIcon({ className = "size-8", ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} {...props}>
      <defs>
        <linearGradient id="sprout-ticket-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#e8f8ef" />
        </linearGradient>
      </defs>
      {/* Soft mint shadow matching CuteQuickReceiptIcon */}
      <rect
        x="4"
        y="7.5"
        width="23"
        height="17"
        rx="4"
        fill="#a7f3d0"
        opacity="0.55"
        transform="translate(1, 1.5)"
      />
      {/* Boarding pass body */}
      <rect
        x="4"
        y="7.5"
        width="23"
        height="17"
        rx="4"
        fill="url(#sprout-ticket-bg)"
        stroke="#2e9d71"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* Stub perforation accent */}
      <path
        d="M21 11v10"
        stroke="#5fcf9f"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeDasharray="2 2.4"
      />
      {/* Clean ascending plane silhouette on pass */}
      <path
        d="M17.2 12.2a1.1 1.1 0 0 0-1.4-.2l-2.3 1.4-4-.9a.7.7 0 0 0-.7.2l-.4.5a.5.5 0 0 0 .1.8l2.7 1.6-1.5 1.6-1.6-.3a.5.5 0 0 0-.5.2l-.3.3a.5.5 0 0 0 .1.7l1.6 1.1 1.1 1.6a.5.5 0 0 0 .7.1l.3-.3a.5.5 0 0 0 .2-.5l-.3-1.6 1.6-1.5 1.6 2.7a.5.5 0 0 0 .8.1l.5-.4a.7.7 0 0 0 .2-.7l-.9-4 1.4-2.3a1.1 1.1 0 0 0-.2-1.4z"
        fill="#5fcf9f"
        fillOpacity="0.45"
        stroke="#2e9d71"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Warm golden destination seal */}
      <circle cx="24" cy="12" r="2.1" fill="#fef08a" stroke="#eab308" strokeWidth="1.2" />
    </svg>
  );
}
