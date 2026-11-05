# No guessed money on screen

Member changes (add a Placeholder Member, rename it, set a role) show on screen the moment they are made and are put back if the server refuses them. Saving an Expense never moves a Balance or a total on screen before the server has answered: the screen may move on at once, and a saving row may show the amount that was typed, but no Balance or total it changes appears early.

We did this because a Balance after an Expense is the server's answer to a currency conversion and a Split method, and the browser can only guess it. A wrong guess flashing on a money screen, even for a second, is worse than a short wait.

Recording a Settlement, or undoing a confirmed one, is the exception (SPEC §6.1 and W-4). A Settlement moves exactly two Balances, the payer's and the receiver's, by exactly its amount, already in the Settlement currency, with no conversion and no Split method, so the browser's figure is the one the server will give, not a guess. Those two Balances move at once, and an undone Settlement is marked undone at once. If the server refuses, only that one change is taken back, on whatever the screen shows by then and never from an older snapshot, so another payment that finished in the meantime is kept; the undone row goes back to confirmed and an error shows. If the server's own answer has already replaced the figures, they are left alone. In every case the Balances are re-read afterwards.

Deleting an Expense hides its row at once (SPEC W-5), but Balances and totals wait for the server; if the server refuses, the row comes back with a message saying so. Deleting a Member stays unguessed, since the server can refuse it while that Member's Balance is not zero.

The cost is that saving an Expense is not sped up this way. Any later speed-up for it, such as moving to the next screen straight away, must not put a Balance or total on screen before the server has answered.

Member changes made in quick succession are each taken back on their own if refused, and the Group is re-read only after the last one finishes, so one refusal cannot erase a later edit.
