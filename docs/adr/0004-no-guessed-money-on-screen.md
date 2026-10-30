# No guessed money on screen

Member changes (add a Placeholder Member, rename it, set a role) show on screen the moment they are made and are put back if the server refuses them. A change that moves a Balance, saving an Expense or recording a Settlement, never does: the screen may move on at once, but no amount appears until the server has answered.

We did this because a Balance is the server's answer to a currency conversion and a Split method, and the browser can only guess it. A wrong guess flashing on a money screen, even for a second, is worse than a short wait.

The cost is that those two actions feel slower than member changes; we answer with an immediate move to the next screen and a placeholder in place of the amount, not with a guess. Deleting a Member or an Expense stays unguessed too, since the server can refuse it (for instance while a Balance is not zero), and a row that vanishes and comes back reads as a bug.
