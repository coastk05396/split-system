# User-level Preferred currency

Tickets 11 and 17 removed any user-level default currency: every currency lived on the Group. We add one back, the Preferred currency, picked in settings. It sets the currency the Home screen shows its total in (see 0002), and pre-fills the Settlement currency of a new Group. It never changes an existing Group.

We did this because a person with TWD and USD Groups wants to see their own currency at a glance, and re-picking it on every new Group is friction.

The create-Group form no longer asks for a default Expense currency. The add-Expense form starts in the currency of the Group's latest Expense (the Settlement currency when there is none), so a run of dollars abroad needs no switching, and the person can change it per Expense. `groups.default_expense_currency` stays in the schema, always equal to the Settlement currency, so no migration drops it.
