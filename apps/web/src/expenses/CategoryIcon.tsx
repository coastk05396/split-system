import { type ReactNode } from "react";
import { categoryInfo } from "./categories.js";

// Rounded silhouettes share a quiet matte finish; highlights sit on the upper edges.
const PICTOGRAMS: Readonly<Record<ReturnType<typeof categoryInfo>["icon"], ReactNode>> = {
  food: (
    <>
      <path d="m11 8 17 5M12 5l17 5" stroke="#96745c" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M5 16h22c0 9-5 12-11 12S5 25 5 16Z" fill="#e6a585" />
      <ellipse cx="16" cy="16" rx="11" ry="3.5" fill="#ffe4b5" />
      <path
        d="M9 16c2-4 3 3 5 0s3 3 5 0 3 0 4 0"
        fill="none"
        stroke="#c29b56"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M7 20c2 4 5 5 8 5"
        fill="none"
        stroke="#fff1df"
        strokeWidth="0.5"
        strokeLinecap="round"
      />
      <ellipse cx="23" cy="13" rx="4" ry="2" fill="#87aa80" transform="rotate(-25 23 13)" />
    </>
  ),
  transport: (
    <>
      <rect x="5" y="5" width="22" height="22" rx="7" fill="#9cbfcd" />
      <rect x="8" y="9" width="16" height="9" rx="3" fill="#e8f4ed" />
      <path
        d="M16 10v7M9 6h13"
        stroke="#fff"
        strokeOpacity="0.8"
        strokeWidth="0.5"
        strokeLinecap="round"
      />
      <rect x="8" y="25" width="5" height="4" rx="2" fill="#607d78" />
      <rect x="20" y="25" width="5" height="4" rx="2" fill="#607d78" />
      <circle cx="10" cy="22" r="2" fill="#fff0c9" />
      <circle cx="22" cy="22" r="2" fill="#fff0c9" />
    </>
  ),
  lodging: (
    <>
      <path d="M5 9q11-5 22 0-3 7 0 15-11 5-22 0 3-7 0-15Z" fill="#bcb3d5" />
      <path d="M8 11q8-3 16 0-2 6 0 11-8 3-16 0 2-6 0-11Z" fill="#e4dded" />
      <path d="M9 11q7-2 13 0" stroke="#fff" strokeWidth="0.5" fill="none" strokeLinecap="round" />
      <path d="M8 12v9m16-9v9" stroke="#c6b9d8" strokeWidth="0.75" strokeDasharray="1 2" />
    </>
  ),
  shopping: (
    <>
      <path d="m7 11-2 14q0 3 4 3h14q4 0 4-3l-2-14Z" fill="#dcb6a7" />
      <path
        d="M11 12V9a5 5 0 0 1 10 0v3"
        stroke="#b38373"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
      />
      <path d="M10 20q5-8 12-4-3 9-12 4" fill="#8eac85" />
      <path d="m11 20 8-3M8 14 7 24" stroke="#fff3e6" strokeWidth="0.5" strokeLinecap="round" />
    </>
  ),
  fun: (
    <>
      <path
        d="M6 7h20q2 0 2 2v4a3 3 0 0 0 0 6v4q0 2-2 2H6q-2 0-2-2v-4a3 3 0 0 0 0-6V9q0-2 2-2Z"
        fill="#e8c78c"
      />
      <path
        d="M22 10v12"
        stroke="#b6945e"
        strokeWidth="1"
        strokeDasharray="1 3"
        strokeLinecap="round"
      />
      <path
        d="m13 11 1.7 3.2 3.5.6-2.5 2.5.5 3.5-3.2-1.6-3.2 1.6.5-3.5-2.5-2.5 3.5-.6Z"
        fill="#fff1cd"
      />
      <path d="M7 8h17" stroke="#fff7de" strokeWidth="0.5" strokeLinecap="round" />
    </>
  ),
  medical: (
    <>
      <g transform="rotate(35 16 16)">
        <rect x="9" y="3" width="14" height="26" rx="7" fill="#9ebba5" />
        <path d="M9 16h14v6a7 7 0 0 1-14 0Z" fill="#e5eddb" />
        <path
          d="M12 12V9q0-3 3-3"
          stroke="#f6fff0"
          strokeWidth="0.5"
          fill="none"
          strokeLinecap="round"
        />
      </g>
    </>
  ),
  other: (
    <>
      <rect x="5" y="7" width="22" height="21" rx="7" fill="#a4bca0" />
      <rect x="4" y="5" width="24" height="9" rx="4" fill="#cbdac0" />
      <path d="M8 6h15" stroke="#f9fff0" strokeWidth="0.5" strokeLinecap="round" />
      <rect x="12" y="17" width="8" height="5" rx="2" fill="#edf2df" />
    </>
  ),
};

export function categoryTone(category: string): { badge: string; chip: string } {
  const { badge, chip } = categoryInfo(category);
  return { badge, chip };
}
export function CategoryIcon({ category, className }: { category: string; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-category-icon={categoryInfo(category).icon}
      viewBox="0 0 32 32"
      className={className ?? "size-5"}
    >
      {PICTOGRAMS[categoryInfo(category).icon]}
    </svg>
  );
}
