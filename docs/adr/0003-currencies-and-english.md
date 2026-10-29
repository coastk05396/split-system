# More currencies and an English interface

SPEC v1 shipped TWD and USD and a zh-TW-only interface, and listed Japanese and Thai as out of scope. We now ship JPY and THB as currencies and English as a second interface language, because the owner travels and wants to split trip costs in yen and baht and to hand the app to friends who do not read Chinese.

**Currencies.** A currency is one entry in `CURRENCIES` (minor-unit decimals and symbol); the pickers, the Home total and the daily rate refresh follow it. The database restricts each currency column with a CHECK, which SQLite cannot widen without rebuilding the table, and rebuilding `users`, `groups` or `expenses` on D1 cascades deletes into their children. Nothing had been deployed, so the unreleased migrations were edited in place instead of adding a rebuild. Adding a currency after a release needs a rebuild migration written with that in mind. Rates below 1 (1 JPY is about 0.0065 USD) show up to six decimals, so a typed rate is not rounded away.

**Language.** English is a second catalog of the same type as zh-TW (`en.ts`), so a missing translation fails the type check. The language is a User setting stored on the account, so every device agrees; before sign-in the device's last or browser language is used. Changing it redraws the whole app. Data the server stores in Chinese (expense and stop categories, the labels for deleted users and removed members) is not migrated; it is drawn in the current language at display time.

**Still Chinese on purpose.** The LINE Bot replies and the rich menu (one image shared by every user), and the privacy policy and terms: a legal text needs the owner's own translation, so English mode shows the Chinese text under a notice that the Chinese version applies.
