# Issue tracker: Local Markdown

Specs and tickets for this repo live as markdown files in `.scratch/`, which is gitignored: they stay on this machine and never go into a PR. Past examples: `.scratch/v1-build/`, `.scratch/group-ledger/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Tickets are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never a single combined tickets file
- Each ticket starts with YAML frontmatter:

  ```yaml
  ---
  title: <ticket title>
  status: ready-for-agent # a triage role from triage-labels.md, or `closed` when done
  blocked_by: [] # ticket numbers, e.g. [01, 03]
  ---
  ```

- A ticket is unblocked when every ticket in its `blocked_by` is `closed`
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the ticket number directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md` (the Notes / Decisions-so-far / Fog body).
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `type:` frontmatter field records the ticket type (`research`/`prototype`/`grilling`/`task`); `status:` records `claimed`/`resolved`.
- **Blocking**: `blocked_by` in the frontmatter. A ticket is unblocked when every ticket it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.
