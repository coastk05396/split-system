# No guessed money on screen

Member changes (add a Placeholder Member, rename it, set a role) show on screen the moment they are made and are put back if the server refuses them. Saving an Expense never does: the screen may move on at once, but no amount it changes appears until the server has answered.

We did this because a Balance after an Expense is the server's answer to a currency conversion and a Split method, and the browser can only guess it. A wrong guess flashing on a money screen, even for a second, is worse than a short wait.

Recording or undoing a confirmed Settlement is the exception (SPEC W-4). It moves exactly two Balances by exactly its amount, already in the Settlement currency, with no conversion and no Split method, so the browser's figure is the one the server will give, not a guess. Those two Balances move at once. If the server refuses, only that one shift is taken back on whatever the screen shows by then, never an older snapshot, so another payment that finished in the meantime is kept. If the server's own answer has already replaced the figures, they are left alone. Either way the Balances are re-read afterwards.

The cost is that saving an Expense is not sped up this way. Any later speed-up for it, such as moving to the next screen straight away, must not put an amount on screen before the server has answered. Deleting a Member or an Expense stays unguessed too, since the server can refuse it (for instance while a Balance is not zero), and a row that vanishes and comes back reads as a bug.

Member changes made in quick succession are each taken back on their own if refused, and the Group is re-read only after the last one finishes, so one refusal cannot erase a later edit.
