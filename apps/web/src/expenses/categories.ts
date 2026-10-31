import { type MessageId, t } from "../i18n/messages.js";

type IconName = "food" | "transport" | "lodging" | "shopping" | "fun" | "medical" | "other";
type Category = { label?: MessageId; icon: IconName; emoji: string; badge: string; chip: string };
const defaultTone = {
  badge: "bg-sprout-100 text-sprout-700",
  chip: "has-[:checked]:border-sprout-500 has-[:checked]:bg-sprout-100 has-[:checked]:text-ink",
};
const entries: Readonly<Record<string, Category>> = {
  餐飲: {
    label: "category.food",
    icon: "food",
    emoji: "🍽️",
    badge: "bg-peach text-orange-800",
    chip: "has-[:checked]:border-orange-400 has-[:checked]:bg-peach/75 has-[:checked]:text-orange-950",
  },
  交通: {
    label: "category.transport",
    icon: "transport",
    emoji: "🚗",
    badge: "bg-sky-100 text-sky-700",
    chip: "has-[:checked]:border-sky-400 has-[:checked]:bg-sky-100/85 has-[:checked]:text-sky-950",
  },
  住宿: {
    label: "category.lodging",
    icon: "lodging",
    emoji: "🛏️",
    badge: "bg-violet-100 text-violet-700",
    chip: "has-[:checked]:border-violet-400 has-[:checked]:bg-violet-100/85 has-[:checked]:text-violet-950",
  },
  購物: {
    label: "category.shopping",
    icon: "shopping",
    emoji: "🛍️",
    badge: "bg-rose-100 text-rose-700",
    chip: "has-[:checked]:border-rose-400 has-[:checked]:bg-rose-100/85 has-[:checked]:text-rose-950",
  },
  娛樂: {
    label: "category.fun",
    icon: "fun",
    emoji: "🎟️",
    badge: "bg-amber-100 text-amber-800",
    chip: "has-[:checked]:border-amber-400 has-[:checked]:bg-amber-100/85 has-[:checked]:text-amber-950",
  },
  門票: {
    icon: "fun",
    emoji: "🎟️",
    badge: "bg-amber-100 text-amber-800",
    chip: "has-[:checked]:border-amber-400 has-[:checked]:bg-amber-100/85 has-[:checked]:text-amber-950",
  },
  醫療: { label: "category.medical", icon: "medical", emoji: "💊", ...defaultTone },
  其他: { label: "category.other", icon: "other", emoji: "✨", ...defaultTone },
};
const fallback: Category = { icon: "other", emoji: "✨", ...defaultTone };
export const CATEGORIES = ["餐飲", "交通", "住宿", "購物", "娛樂", "醫療", "其他"] as const;
export const DEFAULT_CATEGORY = "其他";

/** Preserves unknown stored categories; only known category labels are translated. */
export function categoryInfo(stored: string): Category {
  return Object.hasOwn(entries, stored) ? (entries[stored] ?? fallback) : fallback;
}
export function categoryLabel(stored: string): string {
  const id = categoryInfo(stored).label;
  return id === undefined ? stored : t(id);
}
