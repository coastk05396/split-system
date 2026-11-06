# Project guide

## Layout

- `apps/web` (React UI), `apps/worker` (Hono API on Cloudflare), `packages/shared` (code both use). pnpm workspace; run commands from the repository root.

## Run and check

- Start the local app with `pnpm dev`. Open the web UI at `http://localhost:5173`.
- Run `pnpm e2e` only for full-flow or critical UI/sync changes, and not while `pnpm dev` is running; they use the same local ports.

## Tests

- Work test-first (`tdd` skill) for new logic and bug fixes: confirm the seams with the user, then one failing test (see it fail for the right reason) → smallest change to pass → repeat.
- No new test needed for: deleting dead code, pure refactors, docs/comments, styling-only changes. Existing tests must still pass.

## Git, CI and deploys

- Never push to `main` without the user's approval: a push to `main` deploys production.
- Opening a pull request into `main` runs CI. That is allowed.
- A docs-only change needs no CI run: put `[skip ci]` in its commit message.
- One piece of work, one pull request: when it spans several branches (parallel workers, stacked refactors), combine them on one branch and open a single PR. GitHub only looks at the newest commit for `[skip ci]`, so when the PR holds code, keep `[skip ci]` off its newest commit.

## Staging

- Domain: `https://split-stag.rickchen.si` (Cloudflare tunnel `split-stag` to the local `pnpm dev`; Vite `allowedHosts` must list it).
- Google's authorized redirect URI there is `/google-return` on that domain.

## Spec and review

- Record user-visible behaviour and rules in `docs/SPEC.md` in the same change, so code review has a written spec to check against.
- Code review is done by a different agent in a fresh context, read-only (no file edits, no git writes), never by the author. The author fixes findings and never signs off on their own change.
- Review arguments: `origin/main docs/SPEC.md`, plus `.scratch/<feature>/spec.md` and its tickets when the work has one. `/code-review` stops at the first spec it is given, so pass both paths.

## Agent skills

### Issue tracker

Local markdown under the gitignored `.scratch/<feature>/`: a working spec plus one file per ticket. User-visible rules still go in `docs/SPEC.md`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), kept in each ticket's `status:`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the root. See `docs/agents/domain.md`.
