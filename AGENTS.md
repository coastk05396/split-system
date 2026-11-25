# Project guide

## Layout

- `apps/web` (React UI), `apps/worker` (Hono API on Cloudflare), `packages/shared` (code both use). pnpm workspace; run commands from the repository root.

## Run and check

- Start the local app with `pnpm dev`. Open the web UI at `http://localhost:5173`.
- Before opening a PR that changes `apps/` or `packages/`, run `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm e2e` and open it only when all four are green; on later commits to an open PR, green CI stands in for them. Lint is left to the pre-commit hook and CI. A docs-only change needs none of them.
- Only one `pnpm dev` or `pnpm e2e` runs at a time on this machine, across all worktrees: both bind port 8787 (e2e also 8788).

## Tests

- Work test-first (`tdd` skill) for new logic and bug fixes: confirm the seams with the user, then one failing test (see it fail for the right reason) → smallest change to pass → repeat.
- No new test needed for: deleting dead code, pure refactors, docs/comments, styling-only changes. Existing tests must still pass.

## Git, CI and deploys

- Never push to `main` without the user's approval: a push to `main` deploys production.
- One piece of work, one pull request: when it spans several branches (parallel workers, stacked refactors), combine them on one branch and open a single PR.

## Staging

- Domain: `https://split-stag.rickchen.si` (Cloudflare tunnel `split-stag` to the local `pnpm dev`; Vite `allowedHosts` must list it).
- Google's authorized redirect URI there is `/google-return` on that domain.

## Spec and review

- Record user-visible behaviour and rules in `docs/SPEC.md` in the same change, so code review has a written spec to check against.
- Another agent reviews in a fresh context, read-only (no file edits, no git writes); it runs `pnpm typecheck` and the changed packages' tests and reports a failure as a finding. The author fixes findings and never signs off on their own change.
- Review arguments: `origin/main docs/SPEC.md`. The reviewer also applies `CODING_STANDARDS.md`.

## Agent skills

- Issue tracker: GitHub issues on `coastk05396/split-system` via the `gh` CLI. See `docs/agents/issue-tracker.md`.
- Triage labels: see `docs/agents/triage-labels.md`.
- Domain docs: single-context, `GLOSSARY.md` and `docs/adr/` at the root. See `docs/agents/domain.md`.
