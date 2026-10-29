# Home total converted to the Preferred currency

SPEC §6 said the Home balance is never summed across currencies, and the first version of 0001 rejected a converted total because it is not an amount anyone can settle. We reverse that for the Home screen only: the pending Balances of every Group are converted at today's reference rate into the Preferred currency and shown as one amount. The owner wants one number in their own currency at a glance, and a second, smaller currency beside it was noise.

The converted figure is a reading aid, not a debt. Group rows and the settle screen keep showing each Balance in its own Settlement currency, unconverted, because that is what gets paid. The Home figure carries no visible "about" mark; a hover or screen-reader note says which day's reference rate it uses.

If a reference rate cannot be fetched, Home does not guess: it shows the Preferred currency's amount with the other currencies' amounts beside it, so no pending amount disappears.

The cost is that two people with the same Groups can see slightly different Home figures on different days, since the rate moves; nothing stored changes.
