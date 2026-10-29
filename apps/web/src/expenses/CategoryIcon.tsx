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
  醫療: Pill,
  其他: Sparkles,
};

export function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const Icon = ICONS[category] ?? Sparkles;
  return <Icon aria-hidden="true" className={className ?? "size-5"} />;
}
