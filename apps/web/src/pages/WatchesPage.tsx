import { PriceWatchList } from "../flights/FlightPriceWatches.js";
import { SettingsLink } from "../flights/RouteCard.js";
import { t } from "../i18n/messages.js";

/** 追蹤: the Price Watch list in Travel mode (SPEC §6). */
export function WatchesPage() {
  return (
    <>
      <header className="mb-5 flex items-start justify-between gap-3 px-1">
        <h1 className="text-[28px] leading-[1.15] font-black">{t("flight.myWatches")}</h1>
        <SettingsLink />
      </header>
      <PriceWatchList />
    </>
  );
}
