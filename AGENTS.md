# Project guide

## Layout

- `apps/web` (React UI), `apps/worker` (Hono API on Cloudflare), `packages/shared` (code both use). pnpm workspace; run commands from the repository root.

## Run and check

- Start the local app with `pnpm dev`. Open the web UI at `http://localhost:5173`.
- Before you finish a change run `pnpm typecheck`, `pnpm test` and `pnpm lint`. CI runs lint, and it is not part of the other two.
- Run `pnpm e2e` only for full-flow or critical UI/sync changes, and not while `pnpm dev` is running; they use the same local ports.
- Format the files you changed with `prettier --write <files>`. A pre-commit hook also formats staged files.

## Tests

- Work test-first (`tdd` skill) for new logic and bug fixes: confirm the seams with the user, then one failing test (see it fail for the right reason) → smallest change to pass → repeat.
- No new test needed for: deleting dead code, pure refactors, docs/comments, styling-only changes. Existing tests must still pass.

## Git, CI and deploys

- Never push to `main` without the user's approval: a push to `main` deploys production.
- Opening a pull request into `main` runs CI. That is allowed.
- A docs-only change needs no CI run: put `[skip ci]` in its commit message.

## Staging

- Domain: `https://split-stag.rickchen.si` (Cloudflare tunnel `split-stag` to the local `pnpm dev`; Vite `allowedHosts` must list it).
- Google's authorized redirect URI there is `https://split-stag.rickchen.si/google-return`.

## Spec and review

- Record user-visible behaviour and rules in `docs/SPEC.md` in the same change, so code review has a written spec to check against.- Code review is done by a different agent in a fresh context, read-only (no file edits, no git writes), never by the author. The author fixes findings and never signs off on their own change.
  - Claude Code: run `/code-review origin/main docs/SPEC.md`.
  - Codex: use the "Code Review" skill (type `$code-review` and pick it) with the same arguments, `origin/main docs/SPEC.md`.
  - Orca orchestration: name that skill in the task text.
  - Optional extras: `/ponytail:ponytail-review` (diff), `/ponytail:ponytail-audit` (whole repo).
