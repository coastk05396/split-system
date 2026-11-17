# Split

A group expense-splitting app for everyday gatherings and trips, used mainly through LINE and Chrome.

## Language

**小芽**:
The product name ("小芽" in zh-TW, "Sprout" in English) and its sprout mascot, who speaks in a friendly voice in notifications and empty states across both daily cheap flights and group expense splitting.
_Avoid_: 小芽分帳, Sprout Split, 一起分, Bot (when meaning the mascot)

**Group**:
A set of people who share expenses.
_Avoid_: Room, team, party

**Group avatar**:
The visual glyph representing a Group, displaying its first character or emoji on a deterministic pastel palette with spring motion feedback.
_Avoid_: Group icon, group logo

**Member stack**:
The overlapping pictures of a Group's first four Members on a Group card, with the number of everyone else in a "+N" chip. It gives way to the Balance beside it, which is never squeezed.
_Avoid_: Avatar row, member faces

**Running Tab**:
A Group with no itinerary, used for ongoing everyday splitting.
_Avoid_: Casual group, daily group

**Trip**:
A Group with the travel module on: dated itinerary stops, and an optional default Expense currency for travel spending.
_Avoid_: Journey, tour

**Stop**:
One planned place or activity on one day of a Trip, with a time range, category, text location and note; an Expense may link to it.
_Avoid_: Itinerary item, activity, waypoint

**Daily Flights**:
The curated daily board (`每日航班` / `/flights`) of verified cheap flights departing Taiwan, accessible both signed in and signed out, updated daily and linked to Trip.com for booking.
_Avoid_: Flight Radar, Price Watch, Trip module

**City Card**:
One collapsed row on the Daily Flights board per destination city, summarising that city's cheapest fare and expandable to its fares.
_Avoid_: Fare card, destination tile

**Route**:
One origin airport × destination airport × trip type (round trip or one way) combination on the Daily Flights board; a Route may carry several fares on different dates, and board coverage is counted in destination cities (one City Card each), not airports.
_Avoid_: Flight line, itinerary

**Curated Destination**:
An airport in the hand-maintained catalog (~80–90 major travel airports across Asia, Europe, North America, Oceania, and the Middle East) with verified localized city names, country flags, and IANA timezones; unlisted minor airports are filtered out.
_Avoid_: Open airport list, destination whitelist, global airport dump

**Flight Region**:
One of the destination areas in the Daily Flights filter: `日本`, `韓國`, `中港澳`, `東南亞`, `歐洲`, `美加`, `紐澳`, `中東`. Exactly one can be chosen, or none for all; each shows its fare count. There are no top-level tabs, and no separate country or city filter.
_Avoid_: Continent tab, region pill, sub-region, region tab

**Baseline**:
The typical price of a Route for one departure month and one stop class (direct or connecting), against which a fare is compared.
_Avoid_: Market price, normal price, reference price

**Good Deal**:
A fare at least 15% below its Baseline. Only Good Deals reach the Daily Flights board: a country or city with none that day shows nothing rather than being padded with ordinary fares.
_Avoid_: Cheap fare (cheap is an absolute price, a Good Deal is relative to the Baseline), Steal (that is a Deal Signal tier)

**Deal Signal**:
How far a verified fare sits below its Baseline: domain tier is `steal` (discount >= 30%), `below_market` (discount >= 15%), or `normal`; the discount is shown only at 15% or more (a solid pill from 50%, plain text from 15%); smaller discounts and `normal` fares show nothing. Shown to users as `省 X%` / `Save X%`.
_Avoid_: Strong Buy, Price Score, Price drop / 降幅 (it is not a change versus an earlier price)

**Ghost Fare**:
A stale, mismatched, or unavailable candidate fare (`幽靈票`) discarded by Stage 2 verification (`FlightSource.verifyCandidate`) when no matching fresh itinerary exists or the re-checked price rises by more than 20% AND NT$800 above discovery; always dropped before display.
_Avoid_: Phantom ticket, cache hit

**User**:
One real person, who may sign in through more than one Identity.
_Avoid_: Account, member (when meaning the person outside a Group)

**Identity**:
One way a User proves who they are, such as a Google sign-in or a LINE sign-in.
_Avoid_: Login, provider account

**Session**:
One browser or device being signed in as a User, remembering which Identity it signed in with. Signing in elsewhere, by LINE or Google, never changes it, so both can be signed in at once.
_Avoid_: Login (that is an Identity), account

**Linked account**:
An Identity attached to a User; Settings lists LINE and Google and shows which are linked. Only a Google one carries an email, shown on the Profile card.
_Avoid_: Binding, connection

**Profile source**:
The User's first Identity; its name and picture are the ones shown everywhere, and only its sign-in refreshes them.
_Avoid_: Main account, primary login

**Profile card**:
The card at the top of Settings: the Profile source's name and picture (as in Groups), a tag for how this Session signed in (LINE or Google), and, in a Google Session, the Google email as a small line.
_Avoid_: Header, avatar row

**Link code**:
A short-lived, single-use code a signed-in User gets inside LINE so that a Google sign-in in an outside browser joins that same User instead of creating a new one.
_Avoid_: Pairing code, invite code (an Invite brings someone into a Group)

**Google errand**:
One trip to Google and back, to sign in, to link Google to the signed-in User, or to use a Link code. Inside LINE, which Google refuses, it begins by opening the phone's outside browser.
_Avoid_: Google flow, OAuth redirect, Google login (that is the Identity)

**Member**:
A User's place inside one Group.
_Avoid_: Participant, attendee

**Expense**:
One payment made by one or more Members on behalf of the Group, split among Members.
_Avoid_: Bill, transaction, spending

**Split method**:
The rule that divides an Expense among Members: equal, exact amount, or shares.
_Avoid_: Split type, division mode, percentage split

**Share**:
A whole-number weight (1 to 99) that sets one Member's portion of an Expense under the shares Split method.
_Avoid_: Portion, point

**Personal spending**:
The sum of a User's own Expense allocations in Groups they currently belong to; it excludes amounts paid on behalf of other Members and Settlement payments.
_Avoid_: Amount paid, total Group spending

**Expense currency**:
The currency an Expense was actually paid in, chosen per Expense.
_Avoid_: Local currency, foreign currency

**Settlement currency**:
The one currency a Group uses to total debts and settle up, chosen when the Group is created and fixed once its first Expense exists.
_Avoid_: Base currency, home currency

**Preferred currency**:
The one currency a User picks in settings; the Home total is shown in it, and a new Group starts with it as its Settlement currency.
_Avoid_: Display currency, default currency

**Home total**:
The User's pending Balances from every Group as one amount in the Preferred currency, other currencies converted at the latest reference rate; a reading aid that is never settled.
_Avoid_: Net worth, grand total

**Language**:
The language a User picks in settings; the whole app is drawn in it. Data the server keeps in Chinese (categories, the labels of deleted or removed Members) is translated when shown, never rewritten.
_Avoid_: Locale, translation

**Exchange rate**:
The reference rate, saved with an Expense, that converts its Expense currency into the Settlement currency.
_Avoid_: FX rate, conversion rate

**Settlement**:
One payment from one Member to another that shifts Balances toward zero once the payer, the receiver, or an Admin confirms it; it can be partial, and can be undone.
_Avoid_: Payoff, clearing, transfer

**Balance**:
What a Member is owed (positive) or owes (negative) in a Group, in the Settlement currency, after all Expenses and Settlements.
_Avoid_: Net, debt total

**Payment plan**:
The suggested set of Settlements that would bring every Balance to zero, computed on the device and never trusted by the server.
_Avoid_: Settlement plan, debt graph

**Invite**:
A time-limited, unguessable link that lets a signed-in person join a Group. Members can share it through LINE, as a QR Code, or by copying the link.
_Avoid_: Invitation code, share link

**LINE chat**:
A conversation in LINE, including a group chat, where a Member can share an Invite, an Expense, or the Group's Payment plan. Sharing there does not link the LINE chat to a Group.
_Avoid_: Group (when referring to the LINE conversation)

**Admin**:
A Member who manages a Group: its Invite, its Members and its deletion. A Group always has at least one.
_Avoid_: Owner, host, moderator

**Former Member**:
A person who left or was removed from a Group at a zero balance, kept by name in the Group's past Expenses.
_Avoid_: Ex-member, deleted user

**Rich Menu**:
The fixed six-button menu at the bottom of the 小芽 LINE chat that opens the app's main screens.
_Avoid_: Bot menu, quick menu

**Nickname**:
The name a Member chooses to be shown by in one Group, defaulting to their LINE or Google name.
_Avoid_: Alias, display name (when meaning the per-Group name)

**Placeholder Member**:
A Member profile created before the person has joined, with no account, that can be claimed later through an Invite. It starts with a numbered name that any Member can change or remove until it is claimed.
_Avoid_: Virtual member, guest, dummy
