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
 * free text, so a category typed elsewhere still shows, with the generic icon.
 */
const CATEGORIES: { id: MessageId; icon: LucideIcon }[] = [
  { id: "stop.category.sight", icon: MapPin },
  { id: "stop.category.food", icon: Utensils },
  { id: "stop.category.shopping", icon: ShoppingBag },
  { id: "stop.category.transport", icon: TrainFront },
  { id: "stop.category.lodging", icon: BedDouble },
  { id: "stop.category.activity", icon: Ticket },
  { id: "stop.category.other", icon: Sparkles },
];

export const stopCategories: readonly string[] = CATEGORIES.map((c) => t(c.id));

export function categoryIcon(category: string): LucideIcon {
  return CATEGORIES.find((c) => t(c.id) === category)?.icon ?? Sparkles;
}
