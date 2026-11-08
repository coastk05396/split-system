# Split

A group expense-splitting app for everyday gatherings and trips, used mainly through LINE and Chrome.

## Language

**小芽**:
The product's name (in full, 小芽分帳) and its sprout mascot, who speaks in a friendly voice in notifications and empty states.
_Avoid_: 一起分, Bot (when meaning the mascot)

**Group**:
A set of people who share expenses; the one concept behind both a running tab and a trip.
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

**Flight Radar**:
A standalone flight deal discovery experience, opened from the Travel tab or asked of 小芽 in a one-on-one LINE chat, separate from any Group's Trip.
_Avoid_: Trip (that is a Group with Stops), travel module

**Deal Signal**:
The buy-timing rating on a flight option—Strong Buy, Buy, or Hold—judged from how the live fare compares against historical norms and the User's budget. Strong Buy has one meaning everywhere (Flight Radar rows, LINE, Price Watch): the fare is a bargain by Google's own price level or by history, or it is a 熱門 fare in the cheapest third of its search. It is shown as the 強烈買 sticker.
_Avoid_: Price score, recommendation tier

**Price Watch**:
A standing alert a User sets on a route and date window so 小芽 wakes them once its fare reaches Strong Buy or drops below a target amount.
_Avoid_: Subscription, price tracker

**Travel mode**:
The state of the app while the URL is under `/travel`: the bottom nav and desktop sidebar swap to the travel buttons (分帳, 探索, 航班, 追蹤) and drop the expense-splitting ones. The URL is its only state, and 分帳 leaves it for 首頁.
_Avoid_: Travel tab, trip mode (Trip is the disabled Group feature)

**探索 (Explore page)**:
The landing at `/travel` with no search parameters: a destination hero showing today's lowest direct fare, Date Tiles for that route's nearby dates, a call to action that opens 航班 with the selected date already searched, and a 小芽 prompt card that hands a sentence to 航班's prompt search. Amber marks only 最低.
_Avoid_: Home, discover

**Entity Pill**:
One tappable filter chip in Flight Radar—such as destination vibe, dates, budget cap, or flight-time rule—parsed from a prompt or picked from buttons; together they summarise the current search, and tapping one opens the editing panel.
_Avoid_: Tag, search parameter

**Date Tile**:
One priced departure date of the current Flight Radar search, shown as a pressable tile with its cheapest fare, so the User can compare what each date costs and switch which date's fares are shown. The cheapest date (every one on a tie) is marked 最低; the date whose fares are listed is marked 已選.
_Avoid_: Price calendar, fare chart (it never covers dates the search did not price)

**熱門 (Top)**:
The small tag on a fare Google itself lists among its top flights. Flight Radar shows every fare in one list ordered by price, cheapest first; 熱門 only marks, never reorders.
_Avoid_: Recommended, featured

**Adaptive Next-Move Chip**:
One tappable follow-up under a finished Flight Radar search—such as leaving Thursday or allowing stops—chosen from the actual results and carrying a structured edit of the Entity Pills, so one tap re-runs the search without parsing a prompt.
_Avoid_: Suggestion, quick reply

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
