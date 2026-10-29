import {
  BedDouble,
  Car,
  type LucideIcon,
  Pill,
  ShoppingBag,
  Sparkles,
  Ticket,
  Utensils,
} from "lucide-react";

/** One icon per Expense category; free text typed elsewhere still shows, with the generic one. */
const ICONS: Readonly<Record<string, LucideIcon>> = {
  餐飲: Utensils,
  交通: Car,
  住宿: BedDouble,
  購物: ShoppingBag,
  娛樂: Ticket,
  門票: Ticket,
  醫療: Pill,
  其他: Sparkles,
};

/**
 * Semantic pastel surface + icon tone for each category so expense lists, receipts, and chips
 * carry immediate visual distinction at a glance.
 */
const TONES: Readonly<Record<string, { badge: string; chip: string }>> = {
  餐飲: {
    badge: "bg-peach text-orange-800",
    chip: "has-[:checked]:border-orange-400 has-[:checked]:bg-peach/75 has-[:checked]:text-orange-950",
  },
  交通: {
    badge: "bg-sky-100 text-sky-700",
    chip: "has-[:checked]:border-sky-400 has-[:checked]:bg-sky-100/85 has-[:checked]:text-sky-950",
  },
  住宿: {
    badge: "bg-violet-100 text-violet-700",
    chip: "has-[:checked]:border-violet-400 has-[:checked]:bg-violet-100/85 has-[:checked]:text-violet-950",
  },
  門票: {
    badge: "bg-amber-100 text-amber-800",
    chip: "has-[:checked]:border-amber-400 has-[:checked]:bg-amber-100/85 has-[:checked]:text-amber-950",
  },
  娛樂: {
    badge: "bg-amber-100 text-amber-800",
    chip: "has-[:checked]:border-amber-400 has-[:checked]:bg-amber-100/85 has-[:checked]:text-amber-950",
  },
  購物: {
    badge: "bg-rose-100 text-rose-700",
    chip: "has-[:checked]:border-rose-400 has-[:checked]:bg-rose-100/85 has-[:checked]:text-rose-950",
  },
  其他: {
    badge: "bg-sprout-100 text-sprout-700",
    chip: "has-[:checked]:border-sprout-500 has-[:checked]:bg-sprout-100 has-[:checked]:text-ink",
  },
};

const DEFAULT_TONE = {
  badge: "bg-sprout-100 text-sprout-700",
  chip: "has-[:checked]:border-sprout-500 has-[:checked]:bg-sprout-100 has-[:checked]:text-ink",
};

export function categoryTone(category: string): { badge: string; chip: string } {
  return TONES[category] ?? DEFAULT_TONE;
}

export function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const Icon = ICONS[category] ?? Sparkles;
  return <Icon aria-hidden="true" className={className ?? "size-5"} />;
}
