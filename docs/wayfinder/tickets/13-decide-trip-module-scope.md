---
title: Decide the Trip module scope for v1
type: wayfinder:grilling
mode: HITL
status: closed
assignee: rick
parent: ../map.md
blocked_by: ["02-export-design-screens.md"]
---

## Question

Using the exported 旅行總覽, 旅行基本設定, 旅行每日行程規劃 and 新增行程站點 frames: which itinerary features ship in v1, how an itinerary stop relates to an Expense, and what stays out.

## Blocked by

- [Export design screens to docs/screens](02-export-design-screens.md)

## Resolution

- **What ships in v1:** Trip settings (destination as text, start and end date, notes), a day-by-day plan, and stops with a name, date, time range, category (景點, 餐飲, 購物 and so on), a location as text, and a note. Stops can be edited and deleted. A "在地圖開啟" button opens a free Google Maps link built from the location text. **Out of v1:** place search and map picker (a maps API is not free), routing, weather, bookings, photos, per-stop budgets, offline mode, itinerary export, comments.
- **Order of stops:** stops sort automatically by start time; stops with no time go last, in the order added. The drag handle is removed.
- **Stops and Expenses:** an Expense can optionally link to one stop (the 已附加開銷 chip) and a stop can have several Expenses. The link is set when adding an Expense ("附加到行程") or from the stop. Deleting a stop keeps its Expenses and removes only the link. An Expense never needs a stop.
- **Who can edit:** any Member can add, edit and delete stops; only admins change the Trip settings (destination and dates).
- **Trip switch, dates and currency:** an admin can turn the trip module on or off at any time (快速分帳 versus 旅行分帳); turning it off hides the itinerary and never deletes it. A trip is at most 31 days and stops can only be dated inside the trip's dates. A Group can have a default Expense currency (for example USD on a US trip), separate from the Settlement currency, changeable any time, only pre-selecting the currency on new Expenses.

Divergences from the designs, for **Reconcile the designs with the decisions**: the place picker on the add-stop screen (screen 27, 加入一站) becomes a free-text name and location with a map link; the drag handles on screen 26 (旅行每日行程規劃) go; screens 22, 26, 27 and 29 use a Tokyo trip with JPY 10,000, which v1 does not support (use a TWD trip such as 台南, or a USD trip); screen 29 (旅行基本設定) needs the on/off control for admins and the 31-day limit; the Group creation and settings screens need a default Expense currency next to the Settlement currency.
