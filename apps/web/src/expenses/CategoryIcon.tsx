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
import { categoryInfo } from "./categories.js";

const ICONS: Readonly<Record<ReturnType<typeof categoryInfo>["icon"], LucideIcon>> = {
  food: Utensils,
  transport: Car,
  lodging: BedDouble,
  shopping: ShoppingBag,
  fun: Ticket,
  medical: Pill,
  other: Sparkles,
};

export function categoryTone(category: string): { badge: string; chip: string } {
  const { badge, chip } = categoryInfo(category);
  return { badge, chip };
}
export function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const Icon = ICONS[categoryInfo(category).icon];
  return <Icon aria-hidden="true" className={className ?? "size-5"} />;
}
