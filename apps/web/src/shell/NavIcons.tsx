import type { SVGProps } from "react";

export interface NavIconProps extends SVGProps<SVGSVGElement> {
  active?: boolean;
  strokeWidth?: number;
}

/**
 * Cute Home Icon: A round-roof cottage with round arch door and a cozy chimney.
 */
export function CuteHomeIcon({
  active = false,
  strokeWidth = active ? 2.4 : 1.9,
  className = "size-5",
  ...props
}: NavIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* Chimney with soft cap */}
      <path
        d="M16 6.5V4a1 1 0 0 1 1-1h.5a1 1 0 0 1 1 1v4"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.2 : 0}
      />
      {/* Cottage Roof with soft curved eaves */}
      <path
        d="M3.5 11.2c0-1.2.6-2.3 1.6-2.9L10.8 4c.7-.4 1.7-.4 2.4 0l5.7 4.3c1 .6 1.6 1.7 1.6 2.9"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.24 : 0}
      />
      {/* Cottage Walls */}
      <path
        d="M5.5 11v7.2a2.8 2.8 0 0 0 2.8 2.8h7.4a2.8 2.8 0 0 0 2.8-2.8V11"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.16 : 0}
      />
      {/* Round Arch Door */}
      <path
        d="M9.5 21v-4.5a2.5 2.5 0 0 1 5 0V21"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.36 : 0}
      />
    </svg>
  );
}

/**
 * Cute Groups Icon: Chubby dual avatars with soft round cheeks and friendly shoulders.
 */
export function CuteTripPlaneNavIcon({
  active = false,
  strokeWidth = active ? 2.2 : 1.8,
  className = "size-5.5",
  ...props
}: NavIconProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} {...props}>
      <defs>
        <linearGradient id="nav-cloud-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor={active ? "#bae6fd" : "#e0f2fe"} />
        </linearGradient>
        <linearGradient id="nav-plane-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor={active ? "#dcfce7" : "#f0fdf4"} />
        </linearGradient>
      </defs>
      {/* Soft fluffy cloud floating beneath */}
      <path
        d="M7 26a4 4 0 0 1-1-7.8 5 5 0 0 1 9.5-1.7 4 4 0 0 1 6.5 3.5 4 4 0 0 1-2 7H7z"
        fill="url(#nav-cloud-grad)"
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
          fill="url(#nav-plane-grad)"
          stroke="#2e9d71"
          strokeWidth={strokeWidth}
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
          fill="#86efac"
          stroke="#2e9d71"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

/**
 * Cute Groups Icon: Chubby dual avatars with soft round cheeks and friendly shoulders.
 */
export function CuteGroupsIcon({
  active = false,
  strokeWidth = active ? 2.4 : 1.9,
  className = "size-5",
  ...props
}: NavIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* Left primary friend head */}
      <circle
        cx="8.5"
        cy="8.5"
        r="3.6"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.24 : 0}
      />
      {/* Left friend curved shoulders */}
      <path
        d="M2.5 19.5c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.18 : 0}
      />
      {/* Right secondary friend peeking beside */}
      <circle
        cx="16"
        cy="9.5"
        r="3.1"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.2 : 0}
      />
      {/* Right friend curved shoulders */}
      <path
        d="M14.5 16.5c1-.8 2.2-1.3 3.5-1.3 2.8 0 4.5 1.8 4.5 4.3"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.15 : 0}
      />
    </svg>
  );
}

/**
 * Cute Stats Icon: Round-capped sprouting columns/bars with a tiny sprouting leaf.
 */
export function CuteStatsIcon({
  active = false,
  strokeWidth = active ? 2.4 : 1.9,
  className = "size-5",
  ...props
}: NavIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* Bar 1 (Left - gentle low pill) */}
      <rect
        x="3.5"
        y="12"
        width="4.5"
        height="8.5"
        rx="2.25"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.22 : 0}
      />
      {/* Bar 2 (Middle - sprouting tall pill) */}
      <rect
        x="9.75"
        y="5.5"
        width="4.5"
        height="15"
        rx="2.25"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.32 : 0}
      />
      {/* Tiny sprout leaf blossoming from middle bar */}
      <path
        d="M12 5.5c.8-2.2 3-2.5 3.2-.8s-1.8 2.2-3.2.8z"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.5 : 0}
      />
      {/* Bar 3 (Right - medium pill) */}
      <rect
        x="16"
        y="8.5"
        width="4.5"
        height="12"
        rx="2.25"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.22 : 0}
      />
    </svg>
  );
}

/**
 * Cute Settings Icon: 6-petal flower cog (daisy gear) with soft rounded curves.
 */
export function CuteSettingsIcon({
  active = false,
  strokeWidth = active ? 2.4 : 1.9,
  className = "size-5",
  ...props
}: NavIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* 6-petal rounded flower cog outline */}
      <path
        d="M12 2.2a2 2 0 0 1 1.7 1l.6 1.1a1 1 0 0 0 1.2.5l1.2-.4a2 2 0 0 1 2.4 1.4l.3 1.2a1 1 0 0 0 .9.8l1.2.2a2 2 0 0 1 1.7 2.2l-.1 1.3a1 1 0 0 0 .5 1.1l1 .7a2 2 0 0 1 0 2.8l-1 .7a1 1 0 0 0-.5 1.1l.1 1.3a2 2 0 0 1-1.7 2.2l-1.2.2a1 1 0 0 0-.9.8l-.3 1.2a2 2 0 0 1-2.4 1.4l-1.2-.4a1 1 0 0 0-1.2.5l-.6 1.1a2 2 0 0 1-3.4 0l-.6-1.1a1 1 0 0 0-1.2-.5l-1.2.4a2 2 0 0 1-2.4-1.4l-.3-1.2a1 1 0 0 0-.9-.8l-1.2-.2a2 2 0 0 1-1.7-2.2l.1-1.3a1 1 0 0 0-.5-1.1l-1-.7a2 2 0 0 1 0-2.8l1-.7a1 1 0 0 0 .5-1.1l-.1-1.3a2 2 0 0 1 1.7-2.2l1.2-.2a1 1 0 0 0 .9-.8l.3-1.2a2 2 0 0 1 2.4-1.4l1.2.4a1 1 0 0 0 1.2-.5l.6-1.1a2 2 0 0 1 1.7-1z"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.22 : 0}
      />
      {/* Soft center circle */}
      <circle
        cx="12"
        cy="12"
        r="3.2"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.38 : 0}
      />
    </svg>
  );
}
