# Issue tracker: Local Markdown

Specs and tickets for this repo live as markdown files in `.scratch/`, which is gitignored: they stay on this machine and never go into a PR. Past examples: `.scratch/v1-build/`, `.scratch/group-ledger/`. User-visible rules still go in the committed `docs/SPEC.md` (see `AGENTS.md`); a `.scratch` spec is the working plan for one feature.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Tickets are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never a single combined tickets file
- Each ticket starts with YAML frontmatter:

  ```yaml
  ---
  title: <ticket title>
  status: ready-for-agent # see "Status" below
  blocked_by: [] # file names of blocking tickets, e.g. [01-ledger-commit-step.md, 03-typed-client.md]
  ---
  ```

- `blocked_by` lists file names, never bare numbers (YAML reads `01` as the integer 1)
- A ticket is unblocked when every ticket in its `blocked_by` is `closed`
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## Status

One `status:` field for every ticket, with one finished state, `closed`:

- A feature ticket starts at a triage role from `triage-labels.md` (usually `ready-for-agent`) and ends at `closed`. For `wontfix`, note the reason under `## Comments`, then set `status: closed`.
- A wayfinder ticket starts at `open`, becomes `claimed` while someone works it, and ends at `closed`.

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the ticket number directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket. The first wayfinder effort (the v1 product) lives in the committed `docs/wayfinder/`; new efforts go in `.scratch/<effort>/` like every other ticket.

- **Map**: `.scratch/<effort>/map.md` (the Notes / Decisions-so-far / Fog body).
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `type:` frontmatter field records the ticket type (`research`/`prototype`/`grilling`/`task`); `status:` follows "Status" above (`open`, `claimed`, `closed`).
- **Blocking**: `blocked_by` in the frontmatter. A ticket is unblocked when every ticket it lists is `closed`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files with `status: open` that are unblocked; first by number wins.
- **Claim**: set `status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `status: closed`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.
