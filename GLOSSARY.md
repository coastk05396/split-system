# Split

A group expense-splitting app for everyday gatherings and trips, used mainly through LINE and Chrome.

## Language

**小芽**:
The product's name (in full, 小芽分帳) and its sprout mascot, who speaks in a friendly voice in notifications and empty states.
_Avoid_: 一起分, Bot (when meaning the mascot)

**Group**:
A set of people who share expenses; the one concept behind both a running tab and a trip.
_Avoid_: Room, team, party

**Running Tab**:
A Group with no itinerary, used for ongoing everyday splitting.
_Avoid_: Casual group, daily group

**Trip**:
A Group with the travel module on: dated itinerary stops, and an optional default Expense currency for travel spending.
_Avoid_: Journey, tour

**Stop**:
One planned place or activity on one day of a Trip, with a time range, category, text location and note; an Expense may link to it.
_Avoid_: Itinerary item, activity, waypoint

**User**:
One real person, who may sign in through more than one Identity.
_Avoid_: Account, member (when meaning the person outside a Group)

**Identity**:
One way a User proves who they are, such as a Google sign-in or a LINE sign-in.
_Avoid_: Login, provider account

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
One payment from one Member to another that shifts Balances toward zero once the receiver (or an Admin) confirms it; it starts pending if the payer records it, can be partial, and can be undone.
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
A conversation in LINE that can receive an Invite, including a group chat. Sending an Invite there does not link the LINE chat to a Group.
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
A numbered Member profile created before the person has joined, with no account, that can be claimed later through an Invite.
_Avoid_: Virtual member, guest, dummy
