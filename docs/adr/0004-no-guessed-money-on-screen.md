# No guessed money on screen

Member changes (add a Placeholder Member, rename it, set a role) show on screen the moment they are made and are put back if the server refuses them. A change that moves a Balance, saving an Expense or recording a Settlement, never does: the screen may move on at once, but no amount appears until the server has answered.

We did this because a Balance is the server's answer to a currency conversion and a Split method, and the browser can only guess it. A wrong guess flashing on a money screen, even for a second, is worse than a short wait.

The cost is that those two actions are not sped up this way. Any later speed-up for them, such as moving to the next screen straight away, must not put an amount on screen before the server has answered. Deleting a Member or an Expense stays unguessed too, since the server can refuse it (for instance while a Balance is not zero), and a row that vanishes and comes back reads as a bug.

Member changes made in quick succession are each taken back on their own if refused, and the Group is re-read only after the last one finishes, so one refusal cannot erase a later edit.
