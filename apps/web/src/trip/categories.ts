import {
  BedDouble,
  type LucideIcon,
  MapPin,
  ShoppingBag,
  Sparkles,
  Ticket,
  TrainFront,
  Utensils,
} from "lucide-react";
import { type MessageId, t } from "../i18n/messages.js";

/**
 * Stop categories (decision 13: 景點, 餐飲, 購物 and so on). A Stop stores the zh-TW label as
 * free text (so old data stays valid) and the app draws it in its own language; a category
 * typed elsewhere still shows as written, with the generic icon.
 */
const CATEGORIES: { stored: string; id: MessageId; icon: LucideIcon }[] = [
  { stored: "景點", id: "stop.category.sight", icon: MapPin },
  { stored: "餐飲", id: "stop.category.food", icon: Utensils },
  { stored: "購物", id: "stop.category.shopping", icon: ShoppingBag },
  { stored: "交通", id: "stop.category.transport", icon: TrainFront },
  { stored: "住宿", id: "stop.category.lodging", icon: BedDouble },
  { stored: "活動", id: "stop.category.activity", icon: Ticket },
  { stored: "其他", id: "stop.category.other", icon: Sparkles },
];

/** What a Stop stores for each category. */
export const stopCategories: readonly string[] = CATEGORIES.map((c) => c.stored);

export function stopCategoryLabel(stored: string): string {
  const found = CATEGORIES.find((c) => c.stored === stored);
  return found === undefined ? stored : t(found.id);
}

export function categoryIcon(category: string): LucideIcon {
  return CATEGORIES.find((c) => c.stored === category)?.icon ?? Sparkles;
}
