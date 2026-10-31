# A Group's data lives in its own Durable Object

Each Group's Members, Expenses, Settlements and Balances are held by one Durable Object, the Group ledger, which is the only writer and the source of truth for that Group. D1 keeps only what spans Groups: Users, Identities, Invites, Exchange rates, the list of which Groups a User belongs to, and a per-Member summary the ledger pushes after each write, which feeds the Home total and Personal spending.

We did this because one writer per Group serialises concurrent edits and gives a single place to tell every other Member's screen that something changed, over a WebSocket that carries only a signal, never an amount. A Balance still reaches the screen only as the server's answer to a read (ADR 0004).

The cost is that the Home total and Personal spending trail a Group's own screen by a few seconds, because the summary is pushed after the write and retried if it fails. That lag is the design, not a defect. Considered and rejected: writing to D1 first and having the Durable Object only broadcast, which keeps two sources of truth and the cross-store failures that come with them.

Existing data was not migrated; production Groups, Members, Expenses, Settlements and sign-ins were cleared when this landed.
