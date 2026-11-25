# Project guide

- pnpm workspace (`apps/web`, `apps/worker`, `packages/shared`); run commands from the repository root.
- Work test-first (`tdd` skill) for new logic and bug fixes: confirm the seams with the user, then one failing test (see it fail for the right reason) → smallest change to pass → repeat.

## Git and review

- Never push to `main` without the user's approval: a push to `main` deploys production.
- One piece of work, one pull request: combine parallel or stacked branches on one branch.
- Record user-visible behaviour and rules in `docs/SPEC.md` in the same change.
- Another agent reviews in a fresh context against `origin/main`, `docs/SPEC.md` and `CODING_STANDARDS.md`, read-only (no file edits, no git writes); it runs `pnpm typecheck` and the changed packages' tests and reports a failure as a finding. The author fixes findings and never signs off on their own change.

## Agent skills

- Issue tracker: GitHub issues on `coastk05396/split-system` via the `gh` CLI. See `docs/agents/issue-tracker.md`.
- Triage labels: see `docs/agents/triage-labels.md`.
- Domain docs: single-context, `GLOSSARY.md` and `docs/adr/` at the root. See `docs/agents/domain.md`.
- Staging, secrets and releases: `docs/RELEASE.md`.
